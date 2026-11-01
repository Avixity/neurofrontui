-- Run once with the Supabase SQL editor or migration CLI as the database owner.
-- All application records are private. RPCs derive ownership from auth.uid().
begin;

create table if not exists public.nf_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 100),
  avatar_path text,
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 16384),
  active_baseline_id text,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  check (avatar_path is null or avatar_path ~ ('^' || id::text || '/[a-zA-Z0-9-]+\.(webp|png|jpg|jpeg)$'))
);
create table if not exists public.nf_baselines (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9._:-]{1,100}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 524288),
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create table if not exists public.nf_captures (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9._:-]{1,100}$'),
  baseline_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 1048576),
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, baseline_id) references public.nf_baselines(owner_id, id) on delete restrict
);
create table if not exists public.nf_threads (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9._:-]{1,100}$'),
  title text not null default '' check (length(title) <= 160),
  capture_id text,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, capture_id) references public.nf_captures(owner_id, id) on delete restrict
);
create table if not exists public.nf_messages (
  owner_id uuid not null,
  thread_id text not null,
  id text not null check (id ~ '^[a-zA-Z0-9._:-]{1,100}$'),
  ordinal integer not null check (ordinal >= 0 and ordinal < 500),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 1048576),
  capture_id text,
  primary key (owner_id, thread_id, id),
  unique (owner_id, thread_id, ordinal),
  foreign key (owner_id, thread_id) references public.nf_threads(owner_id, id) on delete cascade,
  foreign key (owner_id, capture_id) references public.nf_captures(owner_id, id) on delete restrict
);
alter table public.nf_profiles drop constraint if exists nf_profile_active_baseline;
alter table public.nf_profiles add constraint nf_profile_active_baseline foreign key (id, active_baseline_id) references public.nf_baselines(owner_id, id) on delete restrict;
create index if not exists nf_captures_completed on public.nf_captures (owner_id, (payload->>'completedAt') desc, id desc);
create index if not exists nf_threads_updated on public.nf_threads (owner_id, updated_at desc);

alter table public.nf_profiles enable row level security;
alter table public.nf_baselines enable row level security;
alter table public.nf_captures enable row level security;
alter table public.nf_threads enable row level security;
alter table public.nf_messages enable row level security;
revoke all on public.nf_profiles, public.nf_baselines, public.nf_captures, public.nf_threads, public.nf_messages from anon, authenticated;
grant select, delete on public.nf_profiles, public.nf_baselines, public.nf_captures, public.nf_threads, public.nf_messages to authenticated;
-- Direct INSERT/UPDATE is intentionally not granted. Only checked RPCs can write.
do $$
declare tbl text; own text;
begin
  foreach tbl in array array['nf_profiles','nf_baselines','nf_captures','nf_threads','nf_messages'] loop
    own := case when tbl = 'nf_profiles' then 'id' else 'owner_id' end;
    execute format('drop policy if exists nf_own_read on public.%I', tbl);
    execute format('drop policy if exists nf_own_delete on public.%I', tbl);
    execute format('create policy nf_own_read on public.%I for select to authenticated using ((select auth.uid()) = %I)', tbl, own);
    execute format('create policy nf_own_delete on public.%I for delete to authenticated using ((select auth.uid()) = %I)', tbl, own);
  end loop;
end $$;

create or replace function public.nf_valid_samples(p_samples jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_samples) = 'array' then
    jsonb_array_length(p_samples) between 1 and 10000 and not exists (
      select 1 from jsonb_array_elements(p_samples) as sample(value)
      where case when jsonb_typeof(value) = 'number' then abs(value::text::numeric) > 1000000000 else true end
    ) else false end
$$;
create or replace function public.nf_valid_baseline(p_payload jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare key text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 524288 or
     p_payload->>'schemaVersion' is distinct from '1' or p_payload->>'unit' is distinct from 'uV' or
     coalesce(length(p_payload->>'calculationVersion'), 0) not between 1 and 100 or
     not public.nf_valid_samples(p_payload->'samples') or jsonb_typeof(p_payload->'features') is distinct from 'object' or
     coalesce((p_payload->>'sampleIntervalMs')::numeric, 0) not between 1 and 10000 or
     coalesce((p_payload->>'calibrationDurationMs')::numeric, 0) not between 1000 and 3600000 or
     coalesce(length(p_payload->>'deviceName'), 0) not between 1 and 100 or
     coalesce(length(p_payload->>'serviceUuid'), 0) not between 1 and 100 or
     coalesce(length(p_payload->>'characteristicUuid'), 0) not between 1 and 100 or
     (p_payload->>'createdAt')::timestamptz is null then return false; end if;
  foreach key in array array['mean','rms','stdDev','peakToPeak','derivativeMean'] loop
    if jsonb_typeof(p_payload->'features'->key) is distinct from 'number' or
       abs((p_payload->'features'->>key)::numeric) > 1000000000 or
       (key <> 'mean' and (p_payload->'features'->>key)::numeric < 0) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
create or replace function public.nf_save_baseline(p_id text, p_payload jsonb) returns public.nf_baselines
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); saved public.nf_baselines;
begin
  if owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_id is null or p_id !~ '^[a-zA-Z0-9._:-]{1,100}$' or not public.nf_valid_baseline(p_payload) then
    raise exception 'Invalid baseline' using errcode = '22023'; end if;
  insert into public.nf_baselines(owner_id,id,payload) values(owner,p_id,p_payload) on conflict (owner_id,id) do nothing;
  select * into saved from public.nf_baselines where owner_id=owner and id=p_id;
  if saved.payload is distinct from p_payload then raise exception 'Immutable baseline conflict' using errcode = '23505'; end if;
  return saved;
end $$;
create or replace function public.nf_save_capture(p_id text, p_baseline_id text, p_payload jsonb) returns public.nf_captures
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); saved public.nf_captures; reference jsonb; snap jsonb; key text; score numeric; expected_category text;
begin
  if owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select payload into reference from public.nf_baselines where owner_id=owner and id=p_baseline_id;
  if reference is null then raise exception 'Baseline not found' using errcode = '23503'; end if;
  if p_id is null or p_id !~ '^[a-zA-Z0-9._:-]{1,100}$' or jsonb_typeof(p_payload) is distinct from 'object' or
     octet_length(p_payload::text) > 1048576 or p_payload->>'id' is distinct from p_id or
     p_payload->>'schemaVersion' is distinct from '1' or p_payload->>'unit' is distinct from 'uV' or
     not public.nf_valid_samples(p_payload->'samples') or jsonb_typeof(p_payload->'summary') is distinct from 'object' or
     coalesce((p_payload->>'durationMs')::numeric, 0) not between 1000 and 3600000 or
     coalesce((p_payload->>'sampleIntervalMs')::numeric, 0) not between 1 and 10000 or
     (p_payload->>'startedAt')::timestamptz is null or (p_payload->>'completedAt')::timestamptz is null or
     (p_payload->>'completedAt')::timestamptz < (p_payload->>'startedAt')::timestamptz then
    raise exception 'Invalid capture' using errcode = '22023'; end if;
  if jsonb_typeof(p_payload->'stress'->'score') is distinct from 'number' then raise exception 'Invalid score' using errcode='22023'; end if;
  score := (p_payload->'stress'->>'score')::numeric;
  if score < 0 or score > 100 then raise exception 'Invalid score' using errcode='22023'; end if;
  expected_category := case when score < 35 then 'Relaxed' when score < 60 then 'Balanced' when score < 78 then 'Elevated' else 'High' end;
  if p_payload->'stress'->>'label' is distinct from expected_category then raise exception 'Invalid category' using errcode='22023'; end if;
  foreach key in array array['average','peak','minimum'] loop
    if jsonb_typeof(p_payload->'summary'->key) is distinct from 'number' or abs((p_payload->'summary'->>key)::numeric)>1000000000 then raise exception 'Invalid summary' using errcode='22023'; end if;
  end loop;
  if coalesce(p_payload->'summary'->>'activityLabel','') not in ('Stable','Moderate Activity','High Activity') or
     (p_payload->'summary'->>'minimum')::numeric > (p_payload->'summary'->>'average')::numeric or
     (p_payload->'summary'->>'average')::numeric > (p_payload->'summary'->>'peak')::numeric or
     coalesce((p_payload->>'axisMax')::numeric <= (p_payload->>'axisMin')::numeric, true) then raise exception 'Invalid summary' using errcode='22023'; end if;
  snap := p_payload->'baseline';
  if jsonb_typeof(snap) is distinct from 'object' or snap->'samples' is distinct from reference->'samples' or
     snap->>'createdAt' is distinct from reference->>'createdAt' or snap->>'unit' is distinct from reference->>'unit' or
     snap->>'calculationVersion' is distinct from reference->>'calculationVersion' or
     p_payload->>'calculationVersion' is distinct from reference->>'calculationVersion' or
     snap->'sampleIntervalMs' is distinct from reference->'sampleIntervalMs' or
     snap->'durationMs' is distinct from reference->'calibrationDurationMs' then
    raise exception 'Baseline snapshot mismatch' using errcode='23503'; end if;
  foreach key in array array['mean','rms','stdDev','peakToPeak','derivativeMean'] loop
    if snap->key is distinct from reference->'features'->key then raise exception 'Baseline features mismatch' using errcode='23503'; end if;
  end loop;
  insert into public.nf_captures(owner_id,id,baseline_id,payload) values(owner,p_id,p_baseline_id,p_payload) on conflict(owner_id,id) do nothing;
  select * into saved from public.nf_captures where owner_id=owner and id=p_id;
  if saved.payload is distinct from p_payload or saved.baseline_id is distinct from p_baseline_id then raise exception 'Immutable capture conflict' using errcode='23505'; end if;
  return saved;
end $$;
create or replace function public.nf_save_profile(p_expected_revision bigint, p_display_name text, p_avatar_path text, p_preferences jsonb, p_active_baseline_id text) returns public.nf_profiles
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); saved public.nf_profiles;
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_display_name is null or length(p_display_name)>100 or
     jsonb_typeof(p_preferences) is distinct from 'object' or octet_length(p_preferences::text)>16384 then raise exception 'Invalid profile' using errcode='22023'; end if;
  if p_avatar_path is not null and p_avatar_path !~ ('^'||owner::text||'/[a-zA-Z0-9-]+\.(webp|png|jpg|jpeg)$') then raise exception 'Invalid avatar path' using errcode='42501'; end if;
  if p_active_baseline_id is not null and not exists(select 1 from public.nf_baselines where owner_id=owner and id=p_active_baseline_id) then raise exception 'Baseline not found' using errcode='23503'; end if;
  insert into public.nf_profiles(id) values(owner) on conflict(id) do nothing;
  select * into saved from public.nf_profiles where id=owner for update;
  if saved.revision <> p_expected_revision then
    -- An identical retry after a lost network acknowledgement is idempotent.
    if saved.revision=p_expected_revision+1 and saved.display_name=p_display_name and saved.avatar_path is not distinct from p_avatar_path and saved.preferences=p_preferences and saved.active_baseline_id is not distinct from p_active_baseline_id then return saved; end if;
    raise exception 'Profile changed on another device' using errcode='40001';
  end if;
  update public.nf_profiles set display_name=p_display_name, avatar_path=p_avatar_path, preferences=p_preferences,
    active_baseline_id=p_active_baseline_id, revision=revision+1, updated_at=now() where id=owner returning * into saved;
  return saved;
end $$;
create or replace function public.nf_save_thread(p_id text, p_expected_revision bigint, p_title text, p_capture_id text, p_messages jsonb) returns public.nf_threads
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); saved public.nf_threads; item jsonb; linked text; snapshot jsonb; existing_messages jsonb;
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_id !~ '^[a-zA-Z0-9._:-]{1,100}$' or p_expected_revision is null or p_expected_revision<0 or
    p_title is null or length(p_title)>160 or jsonb_typeof(p_messages) is distinct from 'array' or jsonb_array_length(p_messages)>500 or octet_length(p_messages::text)>8388608 then raise exception 'Invalid conversation' using errcode='22023'; end if;
  if p_capture_id is not null and not exists(select 1 from public.nf_captures where owner_id=owner and id=p_capture_id) then raise exception 'Capture not found' using errcode='23503'; end if;
  for item in select value from jsonb_array_elements(p_messages) loop
    if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id','') !~ '^[a-zA-Z0-9._:-]{1,100}$' or
       coalesce(item->>'ordinal','') !~ '^[0-9]{1,3}$' or (item->>'ordinal')::integer>=500 or
       jsonb_typeof(item->'payload') is distinct from 'object' or octet_length((item->'payload')::text)>1048576 or
       coalesce(item->'payload'->>'role','') not in ('user','assistant') or
       coalesce(item->'payload'->>'status','') not in ('pending','completed','failed','stopped','cancelled') then raise exception 'Invalid message' using errcode='22023'; end if;
    linked := coalesce(item->'payload'->>'captureId', item->'payload'->'capture'->>'id');
    if item->'payload' ? 'capture' and item->'payload'->'capture' <> 'null'::jsonb and
       (jsonb_typeof(item->'payload'->'capture') is distinct from 'object' or linked is null) then raise exception 'Invalid message capture' using errcode='23503'; end if;
    if linked is not null then
      select payload into snapshot from public.nf_captures where owner_id=owner and id=linked;
      if snapshot is null or (item->'payload' ? 'capture' and item->'payload'->'capture' is distinct from snapshot) or
        (item->'payload' ? 'captureId' and item->'payload' ? 'capture' and item->'payload'->>'captureId' is distinct from item->'payload'->'capture'->>'id') then raise exception 'Capture not found or snapshot mismatch' using errcode='23503'; end if;
    end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_messages)) <> jsonb_array_length(p_messages) or
     (select count(distinct (value->>'ordinal')::integer) from jsonb_array_elements(p_messages)) <> jsonb_array_length(p_messages) then raise exception 'Duplicate message' using errcode='22023'; end if;
  insert into public.nf_threads(owner_id,id) values(owner,p_id) on conflict(owner_id,id) do nothing;
  select * into saved from public.nf_threads where owner_id=owner and id=p_id for update;
  if saved.revision <> p_expected_revision then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'ordinal',ordinal,'payload',payload) order by ordinal),'[]'::jsonb) into existing_messages from public.nf_messages where owner_id=owner and thread_id=p_id;
    if saved.revision=p_expected_revision+1 and saved.title=p_title and saved.capture_id is not distinct from p_capture_id and existing_messages=(select coalesce(jsonb_agg(value order by (value->>'ordinal')::integer),'[]'::jsonb) from jsonb_array_elements(p_messages)) then return saved; end if;
    raise exception 'Conversation changed on another device' using errcode='40001';
  end if;
  delete from public.nf_messages where owner_id=owner and thread_id=p_id;
  insert into public.nf_messages(owner_id,thread_id,id,ordinal,payload,capture_id)
    select owner,p_id,value->>'id',(value->>'ordinal')::integer,value->'payload',coalesce(value->'payload'->>'captureId',value->'payload'->'capture'->>'id') from jsonb_array_elements(p_messages);
  update public.nf_threads set title=p_title,capture_id=p_capture_id,revision=revision+1,updated_at=now() where owner_id=owner and id=p_id returning * into saved;
  return saved;
end $$;

revoke all on function public.nf_valid_samples(jsonb), public.nf_valid_baseline(jsonb), public.nf_save_baseline(text,jsonb), public.nf_save_capture(text,text,jsonb), public.nf_save_profile(bigint,text,text,jsonb,text), public.nf_save_thread(text,bigint,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.nf_save_baseline(text,jsonb), public.nf_save_capture(text,text,jsonb), public.nf_save_profile(bigint,text,text,jsonb,text), public.nf_save_thread(text,bigint,text,text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('nf-avatars','nf-avatars',false,2097152,array['image/webp','image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/webp','image/png','image/jpeg'];
drop policy if exists nf_avatar_read on storage.objects;
drop policy if exists nf_avatar_insert on storage.objects;
drop policy if exists nf_avatar_update on storage.objects;
drop policy if exists nf_avatar_delete on storage.objects;
create policy nf_avatar_read on storage.objects for select to authenticated using(bucket_id='nf-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy nf_avatar_insert on storage.objects for insert to authenticated with check(bucket_id='nf-avatars' and name ~ ('^'||(select auth.uid())::text||'/[a-zA-Z0-9-]+\.(webp|png|jpg|jpeg)$'));
create policy nf_avatar_update on storage.objects for update to authenticated using(bucket_id='nf-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='nf-avatars' and name ~ ('^'||(select auth.uid())::text||'/[a-zA-Z0-9-]+\.(webp|png|jpg|jpeg)$'));
create policy nf_avatar_delete on storage.objects for delete to authenticated using(bucket_id='nf-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

commit;
