-- Additive opt-in Adaptive storage. Run before deploying the new frontend.
begin;
create schema if not exists nf_adaptive_private;
revoke all on schema nf_adaptive_private from public, anon, authenticated;
grant usage on schema nf_adaptive_private to authenticated;

create table if not exists nf_adaptive_private.summaries (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  completed_at_ms bigint,
  duration_ms bigint,
  preset_ms integer,
  ended text,
  window_count integer,
  score integer,
  custom boolean,
  removed boolean not null default false,
  primary key (owner_id,id),
  check ((removed and completed_at_ms is null and duration_ms is null and preset_ms is null
                  and ended is null and window_count is null and score is null and custom is null)
      or (not removed and completed_at_ms is not null and duration_ms is not null and preset_ms is not null
                  and ended is not null and window_count is not null and score is not null and custom is not null
                  and completed_at_ms between 0 and 8639999999999999 and duration_ms between 15000 and 32212254719999
                  and window_count = duration_ms / 15000 and score between 0 and 100
                  and ((custom and preset_ms between 60000 and 3600000 and preset_ms % 60000 = 0)
                    or (not custom and preset_ms in (0,300000,600000)))
                  and ((ended = 'timer' and preset_ms > 0 and duration_ms = preset_ms)
                    or (ended = 'manual' and (preset_ms = 0 or duration_ms < preset_ms)))))
);
alter table nf_adaptive_private.summaries enable row level security;
revoke all on nf_adaptive_private.summaries from public, anon, authenticated;
create index if not exists nf_adaptive_recent on nf_adaptive_private.summaries (owner_id, completed_at_ms desc, id desc) where not removed;

create or replace function nf_adaptive_private.save_summary(
  p_id uuid,p_completed_at_ms bigint,p_duration_ms bigint,p_preset_ms integer,p_ended text,p_window_count integer,p_score integer,p_custom boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into nf_adaptive_private.summaries(owner_id,id,completed_at_ms,duration_ms,preset_ms,ended,window_count,score,custom)
    values(v_owner,p_id,p_completed_at_ms,p_duration_ms,p_preset_ms,p_ended,p_window_count,p_score,p_custom)
    on conflict(owner_id,id) do nothing;
end;
$$;

create or replace function nf_adaptive_private.list_summaries(p_before_ms bigint default null,p_before_id uuid default null)
returns table(id uuid, completed_at_ms bigint, duration_ms bigint, preset_ms integer, ended text, window_count integer, score integer, custom boolean)
language sql stable security definer set search_path = '' as $$
  select s.id,s.completed_at_ms,s.duration_ms,s.preset_ms,s.ended,s.window_count,s.score,s.custom
    from nf_adaptive_private.summaries s where s.owner_id=auth.uid() and not s.removed
      and ((p_before_ms is null and p_before_id is null) or (s.completed_at_ms,s.id) < (p_before_ms,p_before_id))
    order by s.completed_at_ms desc,s.id desc limit 51
$$;

create or replace function nf_adaptive_private.remove_summary(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into nf_adaptive_private.summaries(owner_id,id,removed) values(v_owner,p_id,true)
    on conflict(owner_id,id) do update set removed=true,completed_at_ms=null,duration_ms=null,
      preset_ms=null,ended=null,window_count=null,score=null,custom=null;
end;
$$;

create or replace function public.nf_save_adaptive_summary(
  p_id uuid,p_completed_at_ms bigint,p_duration_ms bigint,p_preset_ms integer,p_ended text,p_window_count integer,p_score integer,p_custom boolean
) returns void language sql security invoker set search_path = '' as $$
  select nf_adaptive_private.save_summary(p_id,p_completed_at_ms,p_duration_ms,p_preset_ms,p_ended,p_window_count,p_score,p_custom)
$$;
create or replace function public.nf_list_adaptive_summaries(p_before_ms bigint default null,p_before_id uuid default null)
returns table(id uuid, completed_at_ms bigint, duration_ms bigint, preset_ms integer, ended text, window_count integer, score integer, custom boolean)
language sql stable security invoker set search_path = '' as $$
  select * from nf_adaptive_private.list_summaries(p_before_ms,p_before_id)
$$;
create or replace function public.nf_remove_adaptive_summary(p_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select nf_adaptive_private.remove_summary(p_id)
$$;

revoke all on function nf_adaptive_private.save_summary(uuid,bigint,bigint,integer,text,integer,integer,boolean), nf_adaptive_private.list_summaries(bigint,uuid), nf_adaptive_private.remove_summary(uuid), public.nf_save_adaptive_summary(uuid,bigint,bigint,integer,text,integer,integer,boolean), public.nf_list_adaptive_summaries(bigint,uuid), public.nf_remove_adaptive_summary(uuid) from public, anon, authenticated;
grant execute on function nf_adaptive_private.save_summary(uuid,bigint,bigint,integer,text,integer,integer,boolean), nf_adaptive_private.list_summaries(bigint,uuid), nf_adaptive_private.remove_summary(uuid), public.nf_save_adaptive_summary(uuid,bigint,bigint,integer,text,integer,integer,boolean), public.nf_list_adaptive_summaries(bigint,uuid), public.nf_remove_adaptive_summary(uuid) to authenticated;
commit;
