-- Optional explanations of stored public excerpts. Never an authority for scores.
-- Only the application service role can read/write these owner-scoped records.
create table public.grader_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid not null references public.grader_reports(id) on delete cascade,
  cache_key text not null check (cache_key ~ '^[a-f0-9]{64}$'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  model text not null check (length(model) between 1 and 100),
  prompt_version text not null check (length(prompt_version) between 1 and 100),
  schema_version text not null check (length(schema_version) between 1 and 100),
  status text not null check (status in ('pending','complete','unavailable')),
  lease_id uuid,
  requested_at timestamptz not null default now(),
  consent_version text not null default 'ai-public-excerpts-v1',
  consent_text text not null default 'Send only the saved public website excerpts to OpenAI for this optional explanation. My private assessment answers are not included and my grades will not change.',
  completed_at timestamptz,
  review jsonb check (review is null or (jsonb_typeof(review)='object' and octet_length(review::text)<=25000)),
  error_code text check (error_code is null or error_code in ('provider_unavailable','invalid_response','stale_request')),
  unique(owner_user_id,cache_key),
  check ((status='complete' and review is not null and completed_at is not null) or (status<>'complete' and review is null))
);
create index grader_ai_reviews_report_idx on public.grader_ai_reviews(report_id);
create table public.grader_ai_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- Keep the daily allowance intact when a report/cache is removed.
  review_id uuid references public.grader_ai_reviews(id) on delete set null,
  requested_at timestamptz not null default now()
);
create index grader_ai_attempts_owner_date_idx on public.grader_ai_attempts(owner_user_id,requested_at desc);
create index grader_ai_attempts_review_idx on public.grader_ai_attempts(review_id);
-- Anonymous spend counters survive deletion, without user/report/source identifiers.
create table public.grader_ai_usage (
  bucket text not null check (bucket in ('day','month')),
  period_start date not null,
  requests integer not null default 0 check (requests>=0),
  primary key(bucket,period_start)
);
alter table public.grader_ai_reviews enable row level security;
alter table public.grader_ai_attempts enable row level security;
alter table public.grader_ai_usage enable row level security;
revoke all on public.grader_ai_reviews,public.grader_ai_attempts,public.grader_ai_usage from public,anon,authenticated;
grant all on public.grader_ai_reviews,public.grader_ai_attempts,public.grader_ai_usage to service_role;

create function public.grader_read_ai_review(p_user_id uuid,p_report_id uuid,p_cache_key text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_row public.grader_ai_reviews%rowtype;
begin
  if not exists(select 1 from public.grader_reports r join public.grader_workspaces w on w.id=r.workspace_id where r.id=p_report_id and w.owner_user_id=p_user_id and r.snapshot ? 'websiteScan') then return '{"error":"not_found"}'::jsonb; end if;
  select * into v_row from public.grader_ai_reviews where owner_user_id=p_user_id and cache_key=p_cache_key;
  if not found then return null; end if;
  return jsonb_build_object('id',v_row.id,'status',case when v_row.status='pending' and v_row.requested_at<now()-interval '90 seconds' then 'unavailable' else v_row.status end,'review',v_row.review);
end;
$$;

create function public.grader_reserve_ai_review(p_user_id uuid,p_report_id uuid,p_cache_key text,p_source_hash text,p_model text,p_prompt_version text,p_schema_version text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_row public.grader_ai_reviews%rowtype; v_day date:=(now() at time zone 'UTC')::date; v_month date:=date_trunc('month',now() at time zone 'UTC')::date; v_lease uuid:=gen_random_uuid();
begin
  if p_user_id is null or p_report_id is null or p_cache_key is null or p_cache_key !~ '^[a-f0-9]{64}$' or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$' or p_model is null or length(p_model) not between 1 and 100 or p_prompt_version is null or length(p_prompt_version) not between 1 and 100 or p_schema_version is null or length(p_schema_version) not between 1 and 100 then raise exception 'invalid_ai_request'; end if;
  perform pg_catalog.pg_advisory_xact_lock(82981662331);
  if not exists(select 1 from public.grader_reports r join public.grader_workspaces w on w.id=r.workspace_id where r.id=p_report_id and w.owner_user_id=p_user_id and r.snapshot ? 'websiteScan') then return '{"error":"not_found"}'::jsonb; end if;
  select * into v_row from public.grader_ai_reviews where owner_user_id=p_user_id and cache_key=p_cache_key for update;
  if found and (v_row.source_hash<>p_source_hash or v_row.model<>p_model or v_row.prompt_version<>p_prompt_version or v_row.schema_version<>p_schema_version) then return '{"error":"ai_cache_conflict"}'::jsonb; end if;
  if found and (v_row.status='complete' or (v_row.status='pending' and v_row.requested_at>=now()-interval '90 seconds')) then
    return jsonb_build_object('start',false,'id',v_row.id,'status',v_row.status,'review',v_row.review);
  end if;
  if (select count(*) from public.grader_ai_attempts where owner_user_id=p_user_id and requested_at>=(v_day::timestamp at time zone 'UTC'))>=3 then return '{"error":"ai_account_limit"}'::jsonb; end if;
  if coalesce((select requests from public.grader_ai_usage where bucket='day' and period_start=v_day),0)>=100 then return '{"error":"ai_global_limit"}'::jsonb; end if;
  if coalesce((select requests from public.grader_ai_usage where bucket='month' and period_start=v_month),0)>=500 then return '{"error":"ai_global_limit"}'::jsonb; end if;
  if v_row.id is null then
    insert into public.grader_ai_reviews(owner_user_id,report_id,cache_key,source_hash,model,prompt_version,schema_version,status,lease_id) values(p_user_id,p_report_id,p_cache_key,p_source_hash,p_model,p_prompt_version,p_schema_version,'pending',v_lease) returning * into v_row;
  else
    update public.grader_ai_reviews set status='pending',lease_id=v_lease,requested_at=now(),completed_at=null,review=null,error_code=null where id=v_row.id returning * into v_row;
  end if;
  insert into public.grader_ai_attempts(owner_user_id,review_id) values(p_user_id,v_row.id);
  insert into public.grader_ai_usage(bucket,period_start,requests) values('day',v_day,1),('month',v_month,1) on conflict(bucket,period_start) do update set requests=public.grader_ai_usage.requests+1;
  return jsonb_build_object('start',true,'id',v_row.id,'leaseId',v_lease,'status','pending','review',null);
end;
$$;

create function public.grader_finish_ai_review(p_user_id uuid,p_review_id uuid,p_lease_id uuid,p_review jsonb,p_error_code text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
  if p_review is not null and (jsonb_typeof(p_review) is distinct from 'object' or octet_length(p_review::text)>25000) then raise exception 'invalid_ai_response'; end if;
  if p_review is null and (p_error_code is null or p_error_code not in ('provider_unavailable','invalid_response','stale_request')) then raise exception 'invalid_ai_response'; end if;
  if p_review is not null and p_error_code is not null then raise exception 'invalid_ai_response'; end if;
  update public.grader_ai_reviews set status=case when p_review is null then 'unavailable' else 'complete' end,review=p_review,error_code=p_error_code,completed_at=now(),lease_id=null where id=p_review_id and owner_user_id=p_user_id and status='pending' and lease_id=p_lease_id;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;

create function public.grader_export_ai_reviews(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('reportId',r.report_id,'status',r.status,'requestedAt',r.requested_at,'completedAt',r.completed_at,'consentVersion',r.consent_version,'consentText',r.consent_text,'review',r.review) order by r.requested_at desc),'[]'::jsonb) from public.grader_ai_reviews r where r.owner_user_id=p_user_id;
$$;
create function public.grader_purge_ai_review_usage() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_attempts integer; v_stale integer;
begin
  delete from public.grader_ai_attempts where requested_at<now()-interval '48 hours';
  get diagnostics v_attempts=row_count;
  update public.grader_ai_reviews set status='unavailable',lease_id=null,completed_at=now(),error_code='stale_request' where status='pending' and requested_at<now()-interval '90 seconds';
  get diagnostics v_stale=row_count;
  return jsonb_build_object('attemptsRemoved',v_attempts,'staleMarked',v_stale);
end;
$$;
revoke execute on function public.grader_read_ai_review(uuid,uuid,text),public.grader_reserve_ai_review(uuid,uuid,text,text,text,text,text),public.grader_finish_ai_review(uuid,uuid,uuid,jsonb,text),public.grader_export_ai_reviews(uuid),public.grader_purge_ai_review_usage() from public,anon,authenticated;
grant execute on function public.grader_read_ai_review(uuid,uuid,text),public.grader_reserve_ai_review(uuid,uuid,text,text,text,text,text),public.grader_finish_ai_review(uuid,uuid,uuid,jsonb,text),public.grader_export_ai_reviews(uuid),public.grader_purge_ai_review_usage() to service_role;
