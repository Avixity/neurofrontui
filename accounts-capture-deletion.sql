-- Apply after accounts-migration.sql. This migration does not delete any captures.
-- Capture deletion is available only through the authenticated, owner-scoped RPC.
begin;

create schema if not exists nf_private;
revoke all on schema nf_private from public, anon, authenticated;

create table if not exists public.nf_capture_deletions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9._:-]{1,100}$'),
  deleted_at timestamptz not null default now(),
  primary key (owner_id, id)
);
alter table public.nf_capture_deletions enable row level security;
revoke all on public.nf_capture_deletions from public, anon, authenticated;
grant select on public.nf_capture_deletions to authenticated;
drop policy if exists nf_own_read on public.nf_capture_deletions;
create policy nf_own_read on public.nf_capture_deletions for select to authenticated using ((select auth.uid())=owner_id);

-- Keep the existing snapshot validation unchanged behind private wrappers.
do $$
begin
  if to_regprocedure('nf_private.nf_save_capture(text,text,jsonb)') is null then
    alter function public.nf_save_capture(text,text,jsonb) set schema nf_private;
  end if;
  if to_regprocedure('nf_private.nf_save_thread(text,bigint,text,text,jsonb)') is null then
    alter function public.nf_save_thread(text,bigint,text,text,jsonb) set schema nf_private;
  end if;
end $$;
revoke all on function nf_private.nf_save_capture(text,text,jsonb), nf_private.nf_save_thread(text,bigint,text,text,jsonb) from public, anon, authenticated;

create or replace function public.nf_save_capture(p_id text, p_baseline_id text, p_payload jsonb) returns public.nf_captures
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_id !~ '^[a-zA-Z0-9._:-]{1,100}$' then raise exception 'Invalid capture ID' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('neurofront:capture-lifecycle:'||owner::text,0));
  if exists(select 1 from public.nf_capture_deletions where owner_id=owner and id=p_id) then
    raise exception 'Capture has been deleted' using errcode='P0002';
  end if;
  return nf_private.nf_save_capture(p_id,p_baseline_id,p_payload);
end $$;

create or replace function public.nf_save_thread(p_id text, p_expected_revision bigint, p_title text, p_capture_id text, p_messages jsonb) returns public.nf_threads
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); item jsonb; clean_messages jsonb := '[]'::jsonb; capture_ref text := p_capture_id; payload jsonb;
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_messages) is distinct from 'array' or jsonb_array_length(p_messages)>500 or octet_length(p_messages::text)>8388608 then raise exception 'Invalid conversation' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('neurofront:capture-lifecycle:'||owner::text,0));
  if exists(select 1 from public.nf_capture_deletions where owner_id=owner and id=capture_ref) then capture_ref := null; end if;
  for item in select value from jsonb_array_elements(p_messages) loop
    payload := item->'payload';
    if exists(select 1 from public.nf_capture_deletions where owner_id=owner and
      (id=payload->>'captureId' or id=payload->'capture'->>'id' or id=payload->'retryJob'->>'captureId' or id=payload->'retryJob'->'capture'->>'id')) then
      item := jsonb_set(item,'{payload}',payload-'captureId'-'capture'-'retryJob');
    end if;
    clean_messages := clean_messages || jsonb_build_array(item);
  end loop;
  return nf_private.nf_save_thread(p_id,p_expected_revision,p_title,capture_ref,clean_messages);
end $$;

create or replace function public.nf_delete_capture(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); deleted_when timestamptz; affected text[]; changed jsonb;
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_id !~ '^[a-zA-Z0-9._:-]{1,100}$' then raise exception 'Invalid capture ID' using errcode='22023'; end if;
  -- Every capture/thread write takes this same lock, including delayed retries.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('neurofront:capture-lifecycle:'||owner::text,0));
  insert into public.nf_capture_deletions(owner_id,id) values(owner,p_id) on conflict(owner_id,id) do nothing;
  select deleted_at into deleted_when from public.nf_capture_deletions where owner_id=owner and id=p_id;
  select coalesce(array_agg(t.id),'{}'::text[]) into affected from public.nf_threads t where t.owner_id=owner and
    (t.capture_id=p_id or exists(select 1 from public.nf_messages m where m.owner_id=owner and m.thread_id=t.id and
      (m.capture_id=p_id or m.payload->>'captureId'=p_id or m.payload->'capture'->>'id'=p_id or m.payload->'retryJob'->>'captureId'=p_id or m.payload->'retryJob'->'capture'->>'id'=p_id)));
  update public.nf_messages set capture_id=null,payload=payload-'captureId'-'capture'-'retryJob'
    where owner_id=owner and (capture_id=p_id or payload->>'captureId'=p_id or payload->'capture'->>'id'=p_id or
      payload->'retryJob'->>'captureId'=p_id or payload->'retryJob'->'capture'->>'id'=p_id);
  update public.nf_threads set capture_id=case when capture_id=p_id then null else capture_id end,
    revision=revision+1,updated_at=now() where owner_id=owner and id=any(affected);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) order by id),'[]'::jsonb) into changed
    from public.nf_threads where owner_id=owner and id=any(affected);
  delete from public.nf_captures where owner_id=owner and id=p_id;
  return jsonb_build_object('id',p_id,'deleted',true,'deleted_at',deleted_when,'affected_threads',changed);
end $$;

-- Direct DELETE would bypass tombstones and could permit stale uploads to return.
revoke delete on public.nf_captures from authenticated;
drop policy if exists nf_own_delete on public.nf_captures;
revoke all on function public.nf_save_capture(text,text,jsonb), public.nf_save_thread(text,bigint,text,text,jsonb), public.nf_delete_capture(text) from public, anon, authenticated;
grant execute on function public.nf_save_capture(text,text,jsonb), public.nf_save_thread(text,bigint,text,text,jsonb), public.nf_delete_capture(text) to authenticated;

create index if not exists nf_threads_capture on public.nf_threads(owner_id,capture_id) where capture_id is not null;
create index if not exists nf_messages_capture on public.nf_messages(owner_id,capture_id) where capture_id is not null;

commit;
