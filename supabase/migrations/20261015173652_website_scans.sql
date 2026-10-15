-- Public website evidence only. Questionnaire answers never enter these tables.
create table public.website_scan_jobs (
  id uuid primary key,
  url text not null check (length(url) between 8 and 2048),
  url_hash text not null check (url_hash ~ '^[a-f0-9]{64}$'),
  origin_key text not null check (length(origin_key) between 8 and 2048),
  scanner_version text not null check (length(scanner_version) between 1 and 80),
  rubric_version text not null check (length(rubric_version) between 1 and 80),
  status text not null default 'queued' check (status in ('queued','running','complete','partial','unavailable')),
  stage text not null default 'queued' check (length(stage) <= 300),
  lease_id text check (length(lease_id) between 1 and 200),
  workflow_run_id text check (length(workflow_run_id) between 1 and 200),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 1000000)),
  safe_error text check (length(safe_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index website_scan_jobs_origin_created_idx on public.website_scan_jobs (origin_key, created_at desc);
create index website_scan_jobs_cache_idx on public.website_scan_jobs (url_hash, scanner_version, rubric_version, completed_at desc) where status in ('complete','partial');
create index website_scan_jobs_active_idx on public.website_scan_jobs (updated_at) where status in ('queued','running');
create index website_scan_jobs_expiry_idx on public.website_scan_jobs (expires_at);

create table public.website_scan_grants (
  scan_id uuid not null references public.website_scan_jobs(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (scan_id, token_hash),
  unique (token_hash)
);

create table public.website_scan_requests (
  id bigint generated always as identity primary key,
  client_hash text not null check (client_hash ~ '^[a-f0-9]{64}$'),
  scan_id uuid not null references public.website_scan_jobs(id) on delete cascade,
  requested_at timestamptz not null default now(),
  new_job boolean not null
);
create index website_scan_requests_client_time_idx on public.website_scan_requests (client_hash, requested_at desc);
create index website_scan_requests_expiry_idx on public.website_scan_requests (requested_at);
create index website_scan_requests_scan_idx on public.website_scan_requests (scan_id);

-- Aggregate counters retain no URLs, client hashes or scan IDs. They keep a
-- calendar-month spending cap accurate even after 30-day evidence deletion.
create table public.website_scan_usage (
  period_kind text not null check (period_kind in ('day','month')),
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  primary key (period_kind, period_start)
);

alter table public.website_scan_jobs enable row level security;
alter table public.website_scan_jobs force row level security;
alter table public.website_scan_grants enable row level security;
alter table public.website_scan_grants force row level security;
alter table public.website_scan_requests enable row level security;
alter table public.website_scan_requests force row level security;
alter table public.website_scan_usage enable row level security;
alter table public.website_scan_usage force row level security;
revoke all on public.website_scan_jobs, public.website_scan_grants, public.website_scan_requests, public.website_scan_usage from public, anon, authenticated;
grant select, insert, update, delete on public.website_scan_jobs, public.website_scan_grants, public.website_scan_requests, public.website_scan_usage to service_role;
revoke all on sequence public.website_scan_requests_id_seq from public, anon, authenticated;
grant usage, select on sequence public.website_scan_requests_id_seq to service_role;

create function public.website_scan_job_payload(p_job public.website_scan_jobs)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'scanId', p_job.id, 'status', p_job.status, 'stage', p_job.stage,
    'createdAt', p_job.created_at, 'updatedAt', p_job.updated_at, 'expiresAt', p_job.expires_at
  ) || case when p_job.result is not null then jsonb_build_object('result', p_job.result) else '{}'::jsonb end
    || case when p_job.safe_error is not null then jsonb_build_object('error', p_job.safe_error) else '{}'::jsonb end;
$$;

create function public.purge_expired_website_scans()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  update public.website_scan_jobs
    set status = 'unavailable', stage = 'Website check timed out',
      safe_error = 'This website check stopped before completion. Start a new check to try again.',
      result = null, completed_at = v_now, updated_at = v_now
    where status in ('queued','running') and updated_at < v_now - interval '10 minutes';
  delete from public.website_scan_jobs where expires_at <= v_now;
  delete from public.website_scan_requests where requested_at <= v_now - interval '30 days';
  delete from public.website_scan_usage where period_start < (date_trunc('month', v_now at time zone 'UTC') - interval '2 months')::date;
end;
$$;

create function public.reserve_website_scan(
  p_id uuid, p_url text, p_url_hash text, p_token_hash text, p_client_hash text,
  p_scanner_version text, p_rubric_version text, p_force boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_job public.website_scan_jobs;
  v_origin text;
  v_day date := (v_now at time zone 'UTC')::date;
  v_month date := date_trunc('month', v_now at time zone 'UTC')::date;
  v_hour_count integer; v_day_count integer; v_retry integer := 0; v_candidate integer;
  v_cached boolean := false; v_start boolean := false;
begin
  if p_url_hash !~ '^[a-f0-9]{64}$' or p_token_hash !~ '^[a-f0-9]{64}$' or p_client_hash !~ '^[a-f0-9]{64}$'
    or length(p_url) > 2048 or p_url !~ '^https?://[^/?#[:space:]]+(/[^?#[:space:]]*)?$'
    or length(p_scanner_version) not between 1 and 80 or length(p_rubric_version) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid_scan_request';
  end if;
  v_origin := lower(substring(p_url from '^https?://[^/]+'));
  -- One transaction-scoped lock is intentional for a small bounded pilot. This
  -- serializes quota checks and reservation, preventing concurrent overspend.
  perform pg_advisory_xact_lock(1789462217);
  perform public.purge_expired_website_scans();

  -- Exact request retries do not consume a second request or mint a second job.
  select j.* into v_job from public.website_scan_jobs j
    join public.website_scan_grants g on g.scan_id = j.id
    where g.token_hash = p_token_hash and j.expires_at > v_now;
  if found then
    return public.website_scan_job_payload(v_job) || jsonb_build_object('cached', v_job.status in ('complete','partial'), 'start', v_job.id = p_id and v_job.status = 'queued' and v_job.workflow_run_id is null);
  end if;

  select count(*) filter (where requested_at > v_now - interval '1 hour'), count(*)
    into v_hour_count, v_day_count from public.website_scan_requests
    where client_hash = p_client_hash and requested_at > v_now - interval '24 hours';
  if v_hour_count >= 3 then
    select greatest(1, ceil(extract(epoch from (min(requested_at) + interval '1 hour' - v_now)))::integer)
      into v_retry from public.website_scan_requests where client_hash = p_client_hash and requested_at > v_now - interval '1 hour';
  end if;
  if v_day_count >= 10 then
    select greatest(1, ceil(extract(epoch from (min(requested_at) + interval '24 hours' - v_now)))::integer)
      into v_candidate from public.website_scan_requests where client_hash = p_client_hash and requested_at > v_now - interval '24 hours';
    v_retry := greatest(v_retry, v_candidate);
  end if;
  if v_retry > 0 then raise exception using errcode = 'P0001', message = 'client_limit', detail = v_retry::text; end if;

  select * into v_job from public.website_scan_jobs
    where origin_key = v_origin and status in ('queued','running') and expires_at > v_now
    order by created_at desc limit 1;
  if not found then
    if not p_force then
      select * into v_job from public.website_scan_jobs
        where url_hash = p_url_hash and scanner_version = p_scanner_version and rubric_version = p_rubric_version
          and status in ('complete','partial') and result is not null and completed_at > v_now - interval '24 hours' and expires_at > v_now
          and coalesce((result->>'measuredChecks')::integer, 0) > 0
        order by completed_at desc limit 1;
      v_cached := found;
    end if;
    if v_job.id is null then
      if p_force then
        select case when max(created_at) is not null then greatest(1, ceil(extract(epoch from (max(created_at) + interval '15 minutes' - v_now)))::integer) else null end
          into v_retry from public.website_scan_jobs where origin_key = v_origin and created_at > v_now - interval '15 minutes';
        if coalesce(v_retry, 0) > 0 then raise exception using errcode = 'P0001', message = 'domain_cooldown', detail = v_retry::text; end if;
      end if;
      if coalesce((select used from public.website_scan_usage where period_kind = 'day' and period_start = v_day), 0) >= 30 then
        v_retry := greatest(1, ceil(extract(epoch from (((v_day + 1)::timestamp at time zone 'UTC') - v_now)))::integer);
        raise exception using errcode = 'P0001', message = 'global_limit', detail = v_retry::text;
      end if;
      if coalesce((select used from public.website_scan_usage where period_kind = 'month' and period_start = v_month), 0) >= 300 then
        v_retry := greatest(1, ceil(extract(epoch from (((v_month + interval '1 month') at time zone 'UTC') - v_now)))::integer);
        raise exception using errcode = 'P0001', message = 'global_limit', detail = v_retry::text;
      end if;
      insert into public.website_scan_jobs (id,url,url_hash,origin_key,scanner_version,rubric_version,created_at,updated_at,expires_at)
        values (p_id,p_url,p_url_hash,v_origin,p_scanner_version,p_rubric_version,v_now,v_now,v_now+interval '30 days') returning * into v_job;
      insert into public.website_scan_usage(period_kind,period_start,used) values ('day',v_day,1),('month',v_month,1)
        on conflict(period_kind,period_start) do update set used = public.website_scan_usage.used + 1;
      v_start := true;
    end if;
  end if;
  insert into public.website_scan_grants(scan_id,token_hash,created_at) values(v_job.id,p_token_hash,v_now);
  insert into public.website_scan_requests(client_hash,scan_id,requested_at,new_job) values(p_client_hash,v_job.id,v_now,v_start);
  return public.website_scan_job_payload(v_job) || jsonb_build_object('cached',v_cached,'start',v_start);
end;
$$;

create function public.read_website_scan(p_id uuid, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_job public.website_scan_jobs;
begin
  perform public.purge_expired_website_scans();
  select j.* into v_job from public.website_scan_jobs j join public.website_scan_grants g on g.scan_id = j.id
    where j.id = p_id and g.token_hash = p_token_hash and j.expires_at > clock_timestamp();
  if not found then return null; end if;
  return public.website_scan_job_payload(v_job);
end;
$$;

create function public.claim_website_scan(p_id uuid, p_lease_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_url text;
begin
  if length(p_lease_id) not between 1 and 200 then raise exception using errcode = '22023', message = 'invalid_lease'; end if;
  perform public.purge_expired_website_scans();
  update public.website_scan_jobs set status = 'running', stage = 'checking', lease_id = p_lease_id, updated_at = clock_timestamp()
    where id = p_id and expires_at > clock_timestamp()
      and (status = 'queued' or (status = 'running' and lease_id = p_lease_id))
    returning url into v_url;
  if not found then return null; end if;
  return jsonb_build_object('url',v_url);
end;
$$;

create function public.update_website_scan_progress(p_id uuid, p_lease_id text, p_stage text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if length(p_stage) > 300 then raise exception using errcode = '22023', message = 'invalid_stage'; end if;
  update public.website_scan_jobs set stage = p_stage, updated_at = clock_timestamp()
    where id = p_id and status = 'running' and lease_id = p_lease_id and expires_at > clock_timestamp();
end;
$$;

create function public.complete_website_scan(p_id uuid, p_lease_id text, p_result jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_result) <> 'object' or p_result->>'status' not in ('complete','partial','unavailable') or octet_length(p_result::text) > 1000000 then
    raise exception using errcode = '22023', message = 'invalid_result';
  end if;
  update public.website_scan_jobs set status = p_result->>'status', stage = case p_result->>'status' when 'complete' then 'Website checks complete' when 'partial' then 'Website checks completed with some gaps' else 'Website check unavailable' end,
    result = p_result, safe_error = null, completed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_id and status = 'running' and lease_id = p_lease_id and expires_at > clock_timestamp();
end;
$$;

create function public.fail_website_scan(p_id uuid, p_lease_id text, p_safe_error text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.website_scan_jobs set status = 'unavailable', stage = 'Website check unavailable',
    safe_error = left(coalesce(p_safe_error,'This website check could not be completed.'),1000), result = null, completed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_id and expires_at > clock_timestamp() and ((status = 'running' and lease_id = p_lease_id) or (status = 'queued' and lease_id is null));
end;
$$;

create function public.record_website_scan_workflow(p_id uuid, p_run_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if length(p_run_id) not between 1 and 200 then raise exception using errcode = '22023', message = 'invalid_run_id'; end if;
  update public.website_scan_jobs set workflow_run_id = p_run_id
    where id = p_id and status in ('queued','running') and (workflow_run_id is null or workflow_run_id = p_run_id) and expires_at > clock_timestamp();
end;
$$;

revoke all on function public.website_scan_job_payload(public.website_scan_jobs), public.purge_expired_website_scans(), public.reserve_website_scan(uuid,text,text,text,text,text,text,boolean), public.read_website_scan(uuid,text), public.claim_website_scan(uuid,text), public.update_website_scan_progress(uuid,text,text), public.complete_website_scan(uuid,text,jsonb), public.fail_website_scan(uuid,text,text), public.record_website_scan_workflow(uuid,text) from public, anon, authenticated;
grant execute on function public.website_scan_job_payload(public.website_scan_jobs), public.purge_expired_website_scans(), public.reserve_website_scan(uuid,text,text,text,text,text,text,boolean), public.read_website_scan(uuid,text), public.claim_website_scan(uuid,text), public.update_website_scan_progress(uuid,text,text), public.complete_website_scan(uuid,text,jsonb), public.fail_website_scan(uuid,text,text), public.record_website_scan_workflow(uuid,text) to service_role;
