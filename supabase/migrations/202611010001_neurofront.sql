begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 80),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 4096),
  active_baseline_id uuid,
  created_at timestamptz not null default now()
);

create table public.baselines (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, version), unique (id, user_id)
);
alter table public.profiles add constraint profiles_active_baseline_fkey
  foreign key (active_baseline_id) references public.baselines(id) on delete set null;

create table public.measurements (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  baseline_id uuid not null,
  baseline_snapshot jsonb not null,
  snapshot jsonb not null,
  notes text not null default '' check (length(notes) <= 4000),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (baseline_id, user_id) references public.baselines(id, user_id) on delete no action deferrable initially deferred
);

create table public.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id text not null check (resource_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);

create table public.conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 262144),
  updated_at timestamptz not null default now()
);

create table public.assistant_usage (
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  bucket text not null check (bucket in ('minute', 'day')),
  window_start timestamptz not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (subject_hash, bucket, window_start)
);
create table public.assistant_requests (
  request_id uuid primary key,
  subject_hash text not null,
  created_at timestamptz not null default now()
);

create index baselines_owner_created on public.baselines(user_id, created_at desc);
create index measurements_owner_created on public.measurements(user_id, created_at desc);
create index conversations_owner_updated on public.conversations(user_id, updated_at desc);
create index assistant_requests_expiry on public.assistant_requests(created_at);

alter table public.profiles enable row level security;
alter table public.baselines enable row level security;
alter table public.measurements enable row level security;
alter table public.bookmarks enable row level security;
alter table public.conversations enable row level security;
alter table public.assistant_usage enable row level security;
alter table public.assistant_requests enable row level security;

revoke all on public.profiles, public.baselines, public.measurements, public.bookmarks,
  public.conversations, public.assistant_usage, public.assistant_requests from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, delete on public.baselines, public.measurements to authenticated;
grant update(notes, tags) on public.measurements to authenticated;
grant select, insert, delete on public.bookmarks to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant all on public.profiles, public.baselines, public.measurements, public.bookmarks,
  public.conversations, public.assistant_usage, public.assistant_requests to service_role;

create policy profiles_read on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert on public.profiles for insert to authenticated with check (
  (select auth.uid()) = id and (active_baseline_id is null or exists (
    select 1 from public.baselines b where b.id = active_baseline_id and b.user_id = (select auth.uid())
  ))
);
create policy profiles_update on public.profiles for update to authenticated using ((select auth.uid()) = id) with check (
  (select auth.uid()) = id and (active_baseline_id is null or exists (
    select 1 from public.baselines b where b.id = active_baseline_id and b.user_id = (select auth.uid())
  ))
);
create policy profiles_delete on public.profiles for delete to authenticated using ((select auth.uid()) = id);
create policy baselines_read on public.baselines for select to authenticated using ((select auth.uid()) = user_id);
create policy baselines_delete on public.baselines for delete to authenticated using ((select auth.uid()) = user_id);
create policy measurements_read on public.measurements for select to authenticated using ((select auth.uid()) = user_id);
create policy measurements_update on public.measurements for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy measurements_delete on public.measurements for delete to authenticated using ((select auth.uid()) = user_id);
create policy bookmarks_read on public.bookmarks for select to authenticated using ((select auth.uid()) = user_id);
create policy bookmarks_insert on public.bookmarks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy bookmarks_delete on public.bookmarks for delete to authenticated using ((select auth.uid()) = user_id);
create policy conversations_read on public.conversations for select to authenticated using ((select auth.uid()) = user_id);
create policy conversations_insert on public.conversations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy conversations_update on public.conversations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy conversations_delete on public.conversations for delete to authenticated using ((select auth.uid()) = user_id);

create function public.valid_signal_snapshot(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare channel text; feature text; sample jsonb; previous_time numeric; count_primary integer;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 1048576
    or jsonb_typeof(p->'traces') is distinct from 'object'
    or jsonb_typeof(p->'features') is distinct from 'object'
    or jsonb_typeof(p->'quality') is distinct from 'object'
    or jsonb_typeof(p->'units') is distinct from 'object'
    or jsonb_typeof(p->'device') is distinct from 'object'
    or coalesce(p->'device'->>'source', '') not in ('bluetooth', 'simulated')
    or coalesce(p->'quality'->>'status', '') not in ('good', 'limited', 'poor')
    or length(coalesce(p->>'algorithmVersion', '')) not between 1 and 80
    or length(coalesce(p->>'acquisitionVersion', '')) not between 1 and 80
    or jsonb_typeof(p->'durationMs') is distinct from 'number'
    or (p->>'durationMs')::numeric not between 0 and 3600000
    or jsonb_typeof(p->'sampleCount') is distinct from 'number'
    or jsonb_typeof(p->'schemaVersion') is distinct from 'number'
    or (p->>'schemaVersion')::integer < 1 then return false; end if;
  perform (p->>'id')::uuid;
  if p->>'id' is null or p->>'createdAt' is null then return false; end if;
  perform (p->>'createdAt')::timestamptz;
  foreach channel in array array['primary','temperature','gsr'] loop
    if jsonb_typeof(p->'traces'->channel) is distinct from 'array'
      or jsonb_array_length(p->'traces'->channel) > 20000 then return false; end if;
    previous_time := -1;
    for sample in select value from jsonb_array_elements(p->'traces'->channel) loop
      if jsonb_typeof(sample->'value') is distinct from 'number'
        or jsonb_typeof(sample->'t') is distinct from 'number'
        or jsonb_typeof(sample->'timestamp') is distinct from 'number'
        or (sample->>'value')::numeric not between -1000000000000 and 1000000000000
        or (sample->>'t')::numeric not between 0 and 3600000
        or (sample->>'t')::numeric < previous_time
        or (sample->>'timestamp')::numeric not between 0 and 100000000000000 then return false; end if;
      previous_time := (sample->>'t')::numeric;
    end loop;
  end loop;
  count_primary := jsonb_array_length(p->'traces'->'primary');
  if count_primary < 1 or (p->>'sampleCount')::integer <> count_primary then return false; end if;
  foreach feature in array array['mean','rms','stdDev','peakToPeak','derivativeMean'] loop
    if jsonb_typeof(p->'features'->feature) is distinct from 'number'
      or abs((p->'features'->>feature)::numeric) > 1000000000000 then return false; end if;
    if feature <> 'mean' and (p->'features'->>feature)::numeric < 0 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.valid_signal_snapshot(jsonb) from public, anon, authenticated;

create function public.save_baseline(p_baseline jsonb) returns public.baselines
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); existing public.baselines; baseline_id uuid; next_version integer;
begin
  if owner_id is null or not exists(select 1 from auth.users where id = owner_id) then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not public.valid_signal_snapshot(p_baseline) then raise exception 'invalid_baseline' using errcode = '22023'; end if;
  baseline_id := (p_baseline->>'id')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select * into existing from public.baselines where id = baseline_id;
  if found then
    if existing.user_id <> owner_id then raise exception 'baseline_not_owned' using errcode = '42501'; end if;
    if existing.snapshot <> p_baseline then raise exception 'baseline_immutable' using errcode = '23505'; end if;
    return existing;
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.baselines where user_id = owner_id;
  insert into public.baselines(id, user_id, version, snapshot)
    values (baseline_id, owner_id, next_version, p_baseline) returning * into existing;
  return existing;
end;
$$;
revoke all on function public.save_baseline(jsonb) from public, anon, authenticated;
grant execute on function public.save_baseline(jsonb) to authenticated;

create function public.save_capture(p_capture jsonb) returns public.measurements
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); existing public.measurements; baseline_row public.baselines; capture_id uuid; capture_tags text[];
begin
  if owner_id is null or not exists(select 1 from auth.users where id = owner_id) then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not public.valid_signal_snapshot(p_capture) or not public.valid_signal_snapshot(p_capture->'baseline')
    or p_capture->>'baselineId' is distinct from p_capture->'baseline'->>'id'
    or coalesce(p_capture->>'status', '') not in ('completed', 'interrupted')
    or length(coalesce(p_capture->>'notes', '')) > 4000
    or jsonb_typeof(p_capture->'tags') is distinct from 'array'
    or jsonb_array_length(p_capture->'tags') > 12
    or (p_capture->'score' is distinct from 'null'::jsonb and (
      jsonb_typeof(p_capture->'score') is distinct from 'number' or (p_capture->>'score')::numeric not between 0 and 100
    )) then raise exception 'invalid_measurement' using errcode = '22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_capture->'tags') t where jsonb_typeof(t) <> 'string' or length(t#>>'{}') > 40) then raise exception 'invalid_tags' using errcode = '22023'; end if;
  capture_id := (p_capture->>'id')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select * into existing from public.measurements where id = capture_id;
  if found then
    if existing.user_id <> owner_id then raise exception 'measurement_not_owned' using errcode = '42501'; end if;
    if existing.snapshot <> p_capture then raise exception 'capture_id_conflict' using errcode = '23505'; end if;
    return existing;
  end if;
  select * into baseline_row from public.save_baseline(p_capture->'baseline');
  select array_agg(value) into capture_tags from jsonb_array_elements_text(p_capture->'tags');
  insert into public.measurements(id, user_id, baseline_id, baseline_snapshot, snapshot, notes, tags)
    values (capture_id, owner_id, baseline_row.id, baseline_row.snapshot, p_capture,
      coalesce(p_capture->>'notes', ''), coalesce(capture_tags, '{}'::text[])) returning * into existing;
  return existing;
end;
$$;
revoke all on function public.save_capture(jsonb) from public, anon, authenticated;
grant execute on function public.save_capture(jsonb) to authenticated;

create function public.delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  delete from public.bookmarks where user_id = owner_id;
  delete from public.measurements where user_id = owner_id;
  delete from public.baselines where user_id = owner_id;
  delete from public.conversations where user_id = owner_id;
  delete from public.profiles where id = owner_id;
end;
$$;
revoke all on function public.delete_my_data() from public, anon, authenticated;
grant execute on function public.delete_my_data() to authenticated;

create function public.consume_assistant_quota(p_subject text, p_request_id uuid, p_minute_limit integer, p_day_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare minute_start timestamptz := date_trunc('minute', now()); day_start timestamptz := date_trunc('day', now()); minute_used integer; day_used integer;
begin
  if p_subject is null or p_request_id is null or p_minute_limit is null or p_day_limit is null
    or p_subject !~ '^[a-f0-9]{64}$' or p_minute_limit not between 1 and 30 or p_day_limit not between 1 and 300 then raise exception 'invalid_quota_request'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_subject, 1));
  delete from public.assistant_requests where created_at < now() - interval '2 days';
  delete from public.assistant_usage where window_start < now() - interval '2 days';
  if exists(select 1 from public.assistant_requests where request_id = p_request_id) then return jsonb_build_object('allowed', false, 'reason', 'replayed'); end if;
  select requests into minute_used from public.assistant_usage where subject_hash = p_subject and bucket = 'minute' and window_start = minute_start;
  select requests into day_used from public.assistant_usage where subject_hash = p_subject and bucket = 'day' and window_start = day_start;
  if coalesce(minute_used, 0) >= p_minute_limit or coalesce(day_used, 0) >= p_day_limit then return jsonb_build_object('allowed', false, 'reason', 'rate_limited'); end if;
  insert into public.assistant_requests(request_id, subject_hash) values (p_request_id, p_subject);
  insert into public.assistant_usage(subject_hash, bucket, window_start, requests) values (p_subject, 'minute', minute_start, 1), (p_subject, 'day', day_start, 1)
    on conflict(subject_hash, bucket, window_start) do update set requests = public.assistant_usage.requests + 1;
  return jsonb_build_object('allowed', true, 'remainingToday', p_day_limit - coalesce(day_used, 0) - 1);
end;
$$;
revoke all on function public.consume_assistant_quota(text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_assistant_quota(text, uuid, integer, integer) to service_role;

create function public.backend_health() returns jsonb language sql security definer set search_path = '' as $$ select '{"schemaVersion":1}'::jsonb; $$;
revoke all on function public.backend_health() from public, anon, authenticated;
grant execute on function public.backend_health() to service_role;

commit;
