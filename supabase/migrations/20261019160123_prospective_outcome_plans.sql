-- Prospective registration is a server timestamp, never an owner-entered date.
create table public.grader_outcome_plans (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
 request_id uuid not null,
 start_date date not null,
 end_date date not null,
 source text not null check(source in ('self_reported','export')),
 currency text not null check(currency in ('USD','CAD','GBP','EUR','AUD','NZD','INR')),
 baseline_report_id uuid references public.grader_reports(id) on delete set null,
 baseline_release_id text not null,
 baseline_content_hash text not null check(baseline_content_hash ~ '^[a-f0-9]{64}$'),
 baseline_snapshot jsonb,
 baseline_stage text not null check(baseline_stage in ('prelaunch','new','established')),
 baseline_fee_model text not null check(baseline_fee_model in ('hourly','flat','contingency','subscription','mixed','other')),
 status text not null default 'registered' check(status in ('registered','reported','withdrawn')),
 outcome_id uuid unique references public.grader_outcome_periods(id) on delete set null,
 revision integer not null default 0 check(revision between 0 and 1000000),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 reported_at timestamptz,
 withdrawn_at timestamptz,
 unique(workspace_id,request_id),
 check(end_date-start_date+1 between 28 and 31),
 check(created_at < start_date::timestamp at time zone 'UTC'),
 check(status='withdrawn' or (baseline_report_id is not null and baseline_snapshot is not null)),
 check(status<>'registered' or (outcome_id is null and reported_at is null)),
 check(status<>'reported' or (outcome_id is not null and reported_at is not null)),
 check(status<>'withdrawn' or withdrawn_at is not null)
);
create index grader_outcome_plans_owner_idx on public.grader_outcome_plans(workspace_id,start_date,id);
create index grader_outcome_plans_baseline_idx on public.grader_outcome_plans(baseline_report_id);
alter table public.grader_outcome_plans enable row level security;
revoke all on table public.grader_outcome_plans from public,anon,authenticated;
grant all on table public.grader_outcome_plans to service_role;

create function public.grader_outcome_plan_json(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'requestId',request_id,'revision',revision,'startDate',start_date,'endDate',end_date,'source',source,'currency',currency,'baselineReportId',baseline_report_id,'baselineReleaseId',baseline_release_id,'baselineStage',baseline_stage,'baselineFeeModel',baseline_fee_model,'status',status,'outcomeId',outcome_id,'createdAt',created_at,'updatedAt',updated_at,'reportedAt',reported_at,'withdrawnAt',withdrawn_at) from public.grader_outcome_plans where id=p_id;
$$;
create function public.grader_read_outcome_plans(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('plans',coalesce((select jsonb_agg(public.grader_outcome_plan_json(p.id) order by p.start_date desc,p.id) from public.grader_outcome_plans p join public.grader_workspaces w on w.id=p.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb));
$$;
create function public.grader_export_outcome_plans(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version','future-month-plan-v1','plans',public.grader_read_outcome_plans(p_user_id)->'plans');
$$;
create function public.grader_register_outcome_plan(p_user_id uuid,p_request uuid,p_start date,p_end date,p_source text,p_currency text,p_baseline uuid,p_release text,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;p public.grader_outcome_plans%rowtype;r public.grader_reports%rowtype;t timestamptz:=clock_timestamp();
begin
 if p_user_id is null or p_request is null or p_start is null or p_end is null or p_end-p_start+1 not between 28 and 31 or p_source is null or p_source not in ('self_reported','export') or p_currency is null or p_currency not in ('USD','CAD','GBP','EUR','AUD','NZD','INR') or p_baseline is null or p_release is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_outcome_plan';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 t:=clock_timestamp();
 w:=public.grader_ensure_workspace(p_user_id);
 select * into p from public.grader_outcome_plans where workspace_id=w and request_id=p_request;
 if found then
   if p.start_date<>p_start or p.end_date<>p_end or p.source<>p_source or p.currency<>p_currency or p.baseline_report_id is distinct from p_baseline or p.baseline_release_id<>p_release or p.baseline_content_hash<>p_hash then return '{"error":"outcome_plan_request_conflict"}'::jsonb;end if;
   return public.grader_outcome_plan_json(p.id);
 end if;
 if p_start::timestamp at time zone 'UTC' <= t or p_start>(t at time zone 'UTC')::date+366 then raise exception 'invalid_outcome_plan';end if;
 perform 1 from public.grader_config_active where singleton and release_id=p_release for share;
 if not found then return '{"error":"outcome_plan_release_changed"}'::jsonb;end if;
 select * into r from public.grader_reports where id=p_baseline and workspace_id=w for share;
 if not found or r.content_hash<>p_hash or r.snapshot->>'isSample' is distinct from 'false' or r.snapshot#>>'{assessment,releaseId}' is distinct from p_release or r.saved_at>t or (r.snapshot->>'createdAt')::timestamptz>t or (r.snapshot->>'createdAt')::timestamptz < (p_start::timestamp at time zone 'UTC')-interval '90 days' or coalesce(r.snapshot#>>'{assessment,contextSnapshot,stage}','') not in ('prelaunch','new','established') or coalesce(r.snapshot#>>'{assessment,contextSnapshot,feeModel}','') not in ('hourly','flat','contingency','subscription','mixed','other') then return '{"error":"outcome_plan_baseline_invalid"}'::jsonb;end if;
 if (select count(*) from public.grader_outcome_plans where workspace_id=w)>=36 then return '{"error":"outcome_plan_limit"}'::jsonb;end if;
 if exists(select 1 from public.grader_outcome_plans where workspace_id=w and status<>'withdrawn' and daterange(start_date,end_date,'[]')&&daterange(p_start,p_end,'[]')) or exists(select 1 from public.grader_outcome_periods where workspace_id=w and daterange(start_date,end_date,'[]')&&daterange(p_start,p_end,'[]')) then return '{"error":"outcome_plan_overlap"}'::jsonb;end if;
 t:=clock_timestamp();
 if p_start::timestamp at time zone 'UTC' <= t then raise exception 'invalid_outcome_plan';end if;
 insert into public.grader_outcome_plans(workspace_id,request_id,start_date,end_date,source,currency,baseline_report_id,baseline_release_id,baseline_content_hash,baseline_snapshot,baseline_stage,baseline_fee_model,created_at,updated_at) values(w,p_request,p_start,p_end,p_source,p_currency,r.id,p_release,r.content_hash,r.snapshot,r.snapshot#>>'{assessment,contextSnapshot,stage}',r.snapshot#>>'{assessment,contextSnapshot,feeModel}',t,t) returning * into p;
 return public.grader_outcome_plan_json(p.id);
end;
$$;
create function public.grader_withdraw_outcome_plan(p_user_id uuid,p_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.grader_outcome_plans%rowtype;
begin
 if p_user_id is null or p_id is null or p_revision is null or p_revision not between 0 and 1000000 then raise exception 'invalid_outcome_plan';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select x.* into p from public.grader_outcome_plans x join public.grader_workspaces w on w.id=x.workspace_id where x.id=p_id and w.owner_user_id=p_user_id for update of x;
 if not found then return '{"error":"not_found"}'::jsonb;end if;
 if p.status='withdrawn' then return public.grader_outcome_plan_json(p.id);end if;
 if p.revision<>p_revision then return '{"error":"revision_conflict"}'::jsonb;end if;
 update public.grader_outcome_plans set status='withdrawn',withdrawn_at=clock_timestamp(),updated_at=clock_timestamp(),revision=least(revision+1,1000000) where id=p_id;
 return public.grader_outcome_plan_json(p.id);
end;
$$;

-- Keep the legacy input contract, but lock the registered metadata and prevent an
-- ordinary unlinked write from stealing a reserved period. Reporting below calls
-- this service-only implementation within the same ownership lock.
alter function public.grader_save_outcome(uuid,uuid,integer,date,date,text,text,uuid,jsonb) rename to grader_save_outcome_unplanned;
create function public.grader_save_outcome(p_user_id uuid,p_id uuid,p_revision integer,p_start date,p_end date,p_source text,p_currency text,p_baseline uuid,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;
begin
 if p_user_id is null then raise exception 'invalid_outcome';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select id into w from public.grader_workspaces where owner_user_id=p_user_id;
 if exists(select 1 from public.grader_outcome_plans where workspace_id=w and outcome_id=p_id and (start_date is distinct from p_start or end_date is distinct from p_end or source is distinct from p_source or currency is distinct from p_currency or baseline_report_id is distinct from p_baseline)) then return '{"error":"outcome_plan_frozen"}'::jsonb;end if;
 if exists(select 1 from public.grader_outcome_plans where workspace_id=w and status<>'withdrawn' and outcome_id is distinct from p_id and daterange(start_date,end_date,'[]')&&daterange(p_start,p_end,'[]')) then return '{"error":"outcome_plan_overlap"}'::jsonb;end if;
 return public.grader_save_outcome_unplanned(p_user_id,p_id,p_revision,p_start,p_end,p_source,p_currency,p_baseline,p_values);
end;
$$;
create function public.grader_outcome_plan_period_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p public.grader_outcome_plans%rowtype;
begin
 select * into p from public.grader_outcome_plans where outcome_id=old.id for update;
 if not found then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_op='DELETE' then
  update public.grader_outcome_plans set status='withdrawn',outcome_id=null,withdrawn_at=coalesce(withdrawn_at,clock_timestamp()),updated_at=clock_timestamp(),revision=least(revision+1,1000000) where id=p.id;
  return old;
 end if;
 if new.workspace_id is distinct from old.workspace_id or new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date or new.source is distinct from old.source or new.currency is distinct from old.currency or (new.baseline_report_id is distinct from old.baseline_report_id and not(new.baseline_report_id is null and not exists(select 1 from public.grader_reports where id=old.baseline_report_id))) then raise exception 'outcome_plan_frozen';end if;
 if new.period_values is distinct from old.period_values then update public.grader_outcome_plans set updated_at=clock_timestamp(),revision=least(revision+1,1000000) where id=p.id;end if;
 return new;
end;
$$;
create trigger grader_outcome_plan_period_guard before update or delete on public.grader_outcome_periods for each row execute function public.grader_outcome_plan_period_guard();
create function public.grader_outcome_plan_baseline_deleted() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 update public.grader_outcome_plans set status='withdrawn',baseline_snapshot=null,withdrawn_at=coalesce(withdrawn_at,clock_timestamp()),updated_at=clock_timestamp(),revision=least(revision+1,1000000) where baseline_report_id=old.id;
 return old;
end;
$$;
create trigger grader_outcome_plan_baseline_deleted before delete on public.grader_reports for each row execute function public.grader_outcome_plan_baseline_deleted();
create function public.grader_report_outcome_plan(p_user_id uuid,p_id uuid,p_revision integer,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.grader_outcome_plans%rowtype;o public.grader_outcome_periods%rowtype;v jsonb;
begin
 if p_user_id is null or p_id is null or p_revision is null or p_revision not between 0 and 1000000 then raise exception 'invalid_outcome_plan';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select x.* into p from public.grader_outcome_plans x join public.grader_workspaces w on w.id=x.workspace_id where x.id=p_id and w.owner_user_id=p_user_id for update of x;
 if not found then return '{"error":"not_found"}'::jsonb;end if;
 if p.status='withdrawn' or p.baseline_report_id is null then return '{"error":"outcome_plan_closed"}'::jsonb;end if;
 if p.end_date>=(clock_timestamp() at time zone 'UTC')::date then return '{"error":"outcome_plan_not_closed"}'::jsonb;end if;
 if not public.grader_outcome_values_valid(p_values,p.end_date-p.start_date+1) then raise exception 'invalid_outcome';end if;
 if p.outcome_id is not null then select * into o from public.grader_outcome_periods where id=p.outcome_id and workspace_id=p.workspace_id for update;end if;
 -- Exact retry after an accepted write is safe; a different stale payload is not.
 if p.revision<>p_revision then
  if o.id is not null and p_revision=p.revision-1 and o.period_values=p_values then return jsonb_build_object('plan',public.grader_outcome_plan_json(p.id),'period',public.grader_outcome_period_json(o.id));end if;
  return '{"error":"revision_conflict"}'::jsonb;
 end if;
 if p.revision>=1000000 then return '{"error":"outcome_change_limit"}'::jsonb;end if;
 if o.id is not null and o.period_values=p_values then return jsonb_build_object('plan',public.grader_outcome_plan_json(p.id),'period',public.grader_outcome_period_json(o.id));end if;
 v:=public.grader_save_outcome_unplanned(p_user_id,p.outcome_id,coalesce(o.revision,0),p.start_date,p.end_date,p.source,p.currency,p.baseline_report_id,p_values);
 if v ? 'error' then return v;end if;
 if p.outcome_id is null then update public.grader_outcome_plans set status='reported',outcome_id=(v->>'id')::uuid,reported_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=p.id;end if;
 return jsonb_build_object('plan',public.grader_outcome_plan_json(p.id),'period',v);
end;
$$;

-- No copied snapshots leave the private source. The projection links immutable
-- hashes to canonical reports; withdrawn registrations can never become a
-- retrospective fallback observation.
create or replace function public.grader_outcome_research_source_page(p_release_id text,p_after uuid,p_limit integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_release_id is null or p_release_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_limit is null or p_limit not between 1 and 2 then raise exception 'invalid_calibration_request';end if;
 if not exists(select 1 from public.grader_config_active where singleton and release_id=p_release_id) then raise exception 'calibration_release_changed';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('workspaceId',w.id,'benchmarking',true,'outcomeResearch',true,
 'periods',coalesce((select jsonb_agg(public.grader_outcome_period_json(o.id) order by o.start_date,o.id) from public.grader_outcome_periods o where o.workspace_id=w.id),'[]'::jsonb),
 'plans',coalesce((select jsonb_agg(public.grader_outcome_plan_json(p.id)||jsonb_build_object('baselineContentHash',p.baseline_content_hash) order by p.created_at,p.id) from public.grader_outcome_plans p where p.workspace_id=w.id),'[]'::jsonb),
 'baselines',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'savedAt',r.saved_at,'contentHash',r.content_hash,'report',r.snapshot) order by r.saved_at,r.id) from public.grader_reports r where r.workspace_id=w.id and exists(select 1 from public.grader_outcome_periods o where o.workspace_id=w.id and o.baseline_report_id=r.id)),'[]'::jsonb)) order by w.id),'[]'::jsonb)
 from (select w.id from public.grader_workspaces w join public.grader_preferences p on p.workspace_id=w.id join public.grader_outcome_research_consent c on c.workspace_id=w.id where p.preference_values->'benchmarking'='true'::jsonb and c.granted and c.version='outcome-research-consent-v1' and (p_after is null or w.id>p_after) and exists(select 1 from public.grader_outcome_periods o where o.workspace_id=w.id) order by w.id limit p_limit) w);
end;
$$;
revoke execute on function public.grader_outcome_plan_json(uuid),public.grader_read_outcome_plans(uuid),public.grader_export_outcome_plans(uuid),public.grader_register_outcome_plan(uuid,uuid,date,date,text,text,uuid,text,text),public.grader_withdraw_outcome_plan(uuid,uuid,integer),public.grader_save_outcome(uuid,uuid,integer,date,date,text,text,uuid,jsonb),public.grader_report_outcome_plan(uuid,uuid,integer,jsonb),public.grader_outcome_plan_period_guard(),public.grader_outcome_plan_baseline_deleted() from public,anon,authenticated;
grant execute on function public.grader_outcome_plan_json(uuid),public.grader_read_outcome_plans(uuid),public.grader_export_outcome_plans(uuid),public.grader_register_outcome_plan(uuid,uuid,date,date,text,text,uuid,text,text),public.grader_withdraw_outcome_plan(uuid,uuid,integer),public.grader_save_outcome(uuid,uuid,integer,date,date,text,text,uuid,jsonb),public.grader_report_outcome_plan(uuid,uuid,integer,jsonb),public.grader_outcome_plan_period_guard(),public.grader_outcome_plan_baseline_deleted() to service_role;

-- Serialize baseline deletion with registration/reporting before acquiring row locks.
create or replace function public.grader_delete_report(p_user_id uuid,p_report_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_user_id is null or p_report_id is null then return false;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 delete from public.grader_reports r using public.grader_workspaces w where r.workspace_id=w.id and w.owner_user_id=p_user_id and r.id=p_report_id;
 get diagnostics n=row_count;return n=1;
end;
$$;
