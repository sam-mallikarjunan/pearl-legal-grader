-- Private prospective action associations. No research consent, pooled impact claim or grade mutation.
create table public.grader_action_observations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
 request_id uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 plan_id uuid not null references public.grader_outcome_plans(id) on delete cascade,
 report_id uuid references public.grader_reports(id) on delete set null,
 baseline_period_id uuid references public.grader_outcome_periods(id) on delete set null,
 plan_revision integer not null check(plan_revision between 0 and 1000000),
 action_id text not null check(action_id ~ '^[a-z0-9_-]{1,100}$'),
 action_snapshot jsonb not null check(jsonb_typeof(action_snapshot)='object' and octet_length(action_snapshot::text)<=12000),
 context_snapshot jsonb not null check(jsonb_typeof(context_snapshot)='object' and octet_length(context_snapshot::text)<=2500),
 window_snapshot jsonb not null check(jsonb_typeof(window_snapshot)='object' and octet_length(window_snapshot::text)<=1000),
 baseline_snapshot jsonb not null check(jsonb_typeof(baseline_snapshot)='object' and octet_length(baseline_snapshot::text)<=2500),
 metric_id text not null check(metric_id in ('inquiry_conversion','invoice_collection','cost_per_client','owner_admin_hours_day')),
 change_start_date date not null,
 scope_declared boolean not null,
 initial_confounders jsonb not null,
 confounders jsonb not null,
 implementation text not null default 'unreported' check(implementation in ('unreported','not_started','started_as_planned','started_late','not_implemented','unsure')),
 implementation_recorded_at timestamptz,
 version text not null default 'private-action-observation-v1' check(version='private-action-observation-v1'),
 status text not null default 'registered' check(status in ('registered','withdrawn')),
 revision integer not null default 0 check(revision between 0 and 1000000),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 withdrawn_at timestamptz,
 unique(workspace_id,request_id),unique(plan_id,action_id),
 check(created_at < change_start_date::timestamp at time zone 'UTC'),
 check(status<>'withdrawn' or withdrawn_at is not null)
);
create index grader_action_observations_owner_idx on public.grader_action_observations(workspace_id,created_at,id);
create index grader_action_observations_baseline_idx on public.grader_action_observations(baseline_period_id);
create index grader_action_observations_report_idx on public.grader_action_observations(report_id);
create table public.grader_action_observation_events (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
 observation_id uuid not null references public.grader_action_observations(id) on delete cascade,
 action text not null check(action in ('registered','check_in','withdrawn')),
 revision integer not null check(revision between 0 and 1000000),
 implementation text not null,confounders jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
create index grader_action_observation_events_owner_idx on public.grader_action_observation_events(workspace_id,recorded_at,id);
create index grader_action_observation_events_observation_idx on public.grader_action_observation_events(observation_id);
alter table public.grader_action_observations enable row level security;
alter table public.grader_action_observation_events enable row level security;
revoke all on table public.grader_action_observations,public.grader_action_observation_events from public,anon,authenticated;
grant all on table public.grader_action_observations,public.grader_action_observation_events to service_role;

create function public.grader_action_confounders_valid(p jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select jsonb_typeof(p)='array' and jsonb_array_length(p) between 1 and 9
 and not exists(select 1 from jsonb_array_elements(p) x where jsonb_typeof(x)<>'string' or (x#>>'{}') not in ('none_reported','other_actions','pricing_changed','marketing_changed','staffing_changed','case_mix_changed','time_off','unusual_event','unsure'))
 and (select count(*) from jsonb_array_elements(p))=(select count(distinct x) from jsonb_array_elements(p) x)
 and (jsonb_array_length(p)=1 or not (p ? 'none_reported' or p ? 'unsure'));
$$;
create function public.grader_action_practice_scope(p jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('practiceId',p->>'practiceId','stage',p#>>'{assessment,contextSnapshot,stage}','feeModel',p#>>'{assessment,contextSnapshot,feeModel}','practiceArea',p#>>'{assessment,contextSnapshot,practiceArea}','jurisdiction',p#>>'{assessment,contextSnapshot,jurisdiction}');
$$;
create function public.grader_action_metric(p_metric text,p_values jsonb,p_days integer) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare n numeric;d numeric;scale numeric:=1;
begin
 case p_metric
 when 'inquiry_conversion' then n:=(p_values->>'clients')::numeric;d:=(p_values->>'inquiries')::numeric;scale:=100;
 when 'invoice_collection' then n:=(p_values->>'cohortCollectedMinor')::numeric;d:=(p_values->>'cohortBilledMinor')::numeric;scale:=100;
 when 'cost_per_client' then n:=(p_values->>'leadSpendMinor')::numeric;d:=(p_values->>'clients')::numeric;
 when 'owner_admin_hours_day' then n:=(p_values->>'adminHours')::numeric;d:=p_days;
 else raise exception 'invalid_action_observation';end case;
 return jsonb_build_object('value',case when n is not null and d>0 then round(n/d*scale,6) else null end,'numerator',n,'denominator',d,'reason',case when n is null or d is null then 'A required measure is unknown. Leave it blank until you know it.' when d=0 then 'The denominator is zero; this measure is undefined, not zero.' else null end);
end;
$$;
create function public.grader_action_observation_json(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'requestId',request_id,'revision',revision,'status',status,'planId',plan_id,'reportId',report_id,'planRevisionAtRegistration',plan_revision,'action',action_snapshot,'context',context_snapshot,'window',window_snapshot,'baseline',baseline_snapshot,'metricId',metric_id,'changeStartDate',change_start_date,'scopeDeclared',scope_declared,'initialConfounders',initial_confounders,'confounders',confounders,'implementation',implementation,'implementationRecordedAt',implementation_recorded_at,'version',version,'createdAt',created_at,'updatedAt',updated_at,'withdrawnAt',withdrawn_at) from public.grader_action_observations where id=p_id;
$$;
create function public.grader_read_action_observations(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'observations',coalesce((select jsonb_agg(public.grader_action_observation_json(a.id) order by a.created_at desc,a.id) from public.grader_action_observations a join public.grader_workspaces w on w.id=a.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb),
 'plans',coalesce((select jsonb_agg(public.grader_outcome_plan_json(p.id) order by p.id) from public.grader_outcome_plans p join public.grader_workspaces w on w.id=p.workspace_id where w.owner_user_id=p_user_id and exists(select 1 from public.grader_action_observations a where a.workspace_id=w.id and a.plan_id=p.id)),'[]'::jsonb),
 'baselines',coalesce((select jsonb_agg(public.grader_outcome_period_json(o.id) order by o.id) from public.grader_outcome_periods o join public.grader_workspaces w on w.id=o.workspace_id where w.owner_user_id=p_user_id and exists(select 1 from public.grader_action_observations a where a.workspace_id=w.id and a.baseline_period_id=o.id)),'[]'::jsonb),
 'followups',coalesce((select jsonb_agg(public.grader_outcome_period_json(o.id) order by o.id) from public.grader_outcome_periods o join public.grader_workspaces w on w.id=o.workspace_id where w.owner_user_id=p_user_id and exists(select 1 from public.grader_outcome_plans p join public.grader_action_observations a on a.plan_id=p.id where a.workspace_id=w.id and p.workspace_id=w.id and p.outcome_id=o.id)),'[]'::jsonb));
$$;
create function public.grader_register_action_observation(p_user_id uuid,p_hash text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;p public.grader_outcome_plans%rowtype;r public.grader_reports%rowtype;b public.grader_outcome_periods%rowtype;br public.grader_reports%rowtype;a public.grader_action_observations%rowtype;act jsonb;m jsonb;t timestamptz;change_date date;
begin
 if p_user_id is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input))<>11 or p_input->>'version' is distinct from 'private-action-observation-v1' or coalesce(p_input->>'actionId','') !~ '^[a-z0-9_-]{1,100}$' or coalesce(p_input->>'metricId','') not in ('inquiry_conversion','invoice_collection','cost_per_client','owner_admin_hours_day') or jsonb_typeof(p_input->'scopeDeclared') is distinct from 'boolean' or jsonb_typeof(p_input->'planRevision') is distinct from 'number' or jsonb_typeof(p_input->'baselineRevision') is distinct from 'number' or not coalesce(public.grader_action_confounders_valid(p_input->'confounders'),false) or coalesce(p_input->>'planRevision','') !~ '^\d{1,7}$' or (p_input->>'planRevision')::integer>1000000 or coalesce(p_input->>'baselineRevision','') !~ '^\d{1,7}$' or (p_input->>'baselineRevision')::integer>1000000 or coalesce(p_input->>'changeStartDate','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_action_observation';end if;
 if (p_input->>'requestId')::uuid is null or (p_input->>'planId')::uuid is null or (p_input->>'baselinePeriodId')::uuid is null then raise exception 'invalid_action_observation';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 w:=public.grader_ensure_workspace(p_user_id);t:=clock_timestamp();
 select * into a from public.grader_action_observations where workspace_id=w and request_id=(p_input->>'requestId')::uuid;
 if found then if a.request_hash<>p_hash then return '{"error":"action_observation_request_conflict"}'::jsonb;end if;return public.grader_action_observation_json(a.id);end if;
 select * into p from public.grader_outcome_plans where id=(p_input->>'planId')::uuid and workspace_id=w for share;
 if not found then return '{"error":"not_found"}'::jsonb;end if;
 select * into b from public.grader_outcome_periods where id=(p_input->>'baselinePeriodId')::uuid and workspace_id=w for share;
 if not found then return '{"error":"not_found"}'::jsonb;end if;
 if p.revision<>(p_input->>'planRevision')::integer or b.revision<>(p_input->>'baselineRevision')::integer then return '{"error":"revision_conflict"}'::jsonb;end if;
 change_date:=(p_input->>'changeStartDate')::date;
 if p.status<>'registered' or p.outcome_id is not null or p.start_date::timestamp at time zone 'UTC'<=t or change_date::timestamp at time zone 'UTC'<=t or change_date>p.start_date or p.start_date<>date_trunc('month',p.start_date::timestamp)::date or p.end_date<>(p.start_date+interval '1 month - 1 day')::date then return '{"error":"action_observation_not_prospective"}'::jsonb;end if;
 select * into r from public.grader_reports where id=p.baseline_report_id and workspace_id=w for share;
 if not found or r.content_hash<>p.baseline_content_hash or r.snapshot->>'isSample' is distinct from 'false' or r.snapshot#>>'{assessment,releaseId}' is distinct from p.baseline_release_id then return '{"error":"action_observation_action_invalid"}'::jsonb;end if;
 select x into act from jsonb_array_elements(r.snapshot#>'{assessment,actions}') x where x->>'id'=p_input->>'actionId';
 if act is null then return '{"error":"action_observation_action_invalid"}'::jsonb;end if;
 if b.end_date>=(t at time zone 'UTC')::date or b.end_date>=change_date or b.source<>p.source or b.currency<>p.currency or b.start_date<>date_trunc('month',b.start_date::timestamp)::date or b.end_date<>(b.start_date+interval '1 month - 1 day')::date or b.created_at>t or b.updated_at>t or not public.grader_outcome_values_valid(b.period_values,b.end_date-b.start_date+1) then return '{"error":"action_observation_baseline_invalid"}'::jsonb;end if;
 if b.baseline_report_id is null then
  if (p_input->>'scopeDeclared')::boolean is distinct from true then return '{"error":"action_observation_scope_required"}'::jsonb;end if;
 else
  select * into br from public.grader_reports where id=b.baseline_report_id and workspace_id=w for share;
  if not found or br.snapshot->>'isSample' is distinct from 'false' or public.grader_action_practice_scope(br.snapshot) is distinct from public.grader_action_practice_scope(r.snapshot) then return '{"error":"action_observation_baseline_invalid"}'::jsonb;end if;
 end if;
 m:=public.grader_action_metric(p_input->>'metricId',b.period_values,b.end_date-b.start_date+1);
 if m->'value'='null'::jsonb or (m->>'denominator')::numeric<=0 then return '{"error":"action_observation_baseline_unknown"}'::jsonb;end if;
 if (select count(*) from public.grader_action_observations where workspace_id=w)>=72 then return '{"error":"action_observation_limit"}'::jsonb;end if;
 if (select count(*) from public.grader_action_observations where workspace_id=w and plan_id=p.id)>=3 or exists(select 1 from public.grader_action_observations where workspace_id=w and plan_id=p.id and action_id=p_input->>'actionId') then return '{"error":"action_observation_plan_limit"}'::jsonb;end if;
 if (select count(*) from public.grader_action_observation_events where workspace_id=w)>=2000 then return '{"error":"action_observation_change_limit"}'::jsonb;end if;
 t:=clock_timestamp();if change_date::timestamp at time zone 'UTC'<=t or p.start_date::timestamp at time zone 'UTC'<=t then return '{"error":"action_observation_not_prospective"}'::jsonb;end if;
 insert into public.grader_action_observations(workspace_id,request_id,request_hash,plan_id,report_id,baseline_period_id,plan_revision,action_id,action_snapshot,context_snapshot,window_snapshot,baseline_snapshot,metric_id,change_start_date,scope_declared,initial_confounders,confounders,created_at,updated_at)
 values(w,(p_input->>'requestId')::uuid,p_hash,p.id,r.id,b.id,p.revision,p_input->>'actionId',jsonb_build_object('id',act->>'id','title',act->>'title','definitionOfDone',act->>'definitionOfDone','verification',act->>'verification'),public.grader_action_practice_scope(r.snapshot),jsonb_build_object('startDate',p.start_date,'endDate',p.end_date,'source',p.source,'currency',p.currency,'releaseId',p.baseline_release_id),jsonb_build_object('id',b.id,'revision',b.revision,'startDate',b.start_date,'endDate',b.end_date,'source',b.source,'currency',b.currency,'baselineReportId',b.baseline_report_id,'observation',m),p_input->>'metricId',change_date,(p_input->>'scopeDeclared')::boolean,p_input->'confounders',p_input->'confounders',t,t) returning * into a;
 insert into public.grader_action_observation_events(workspace_id,observation_id,action,revision,implementation,confounders) values(w,a.id,'registered',a.revision,a.implementation,a.confounders);
 return public.grader_action_observation_json(a.id);
end;
$$;
create function public.grader_check_in_action_observation(p_user_id uuid,p_id uuid,p_revision integer,p_implementation text,p_confounders jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.grader_action_observations%rowtype;t timestamptz:=clock_timestamp();
begin
 if p_user_id is null or p_id is null or p_revision is null or p_revision not between 0 and 1000000 or p_implementation is null or p_implementation not in ('unreported','not_started','started_as_planned','started_late','not_implemented','unsure') or not coalesce(public.grader_action_confounders_valid(p_confounders),false) then raise exception 'invalid_action_observation';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select x.* into a from public.grader_action_observations x join public.grader_workspaces w on w.id=x.workspace_id where x.id=p_id and w.owner_user_id=p_user_id for update of x;
 if not found then return '{"error":"not_found"}'::jsonb;end if;
 if a.status='withdrawn' then return '{"error":"action_observation_withdrawn"}'::jsonb;end if;
 if a.implementation=p_implementation and a.confounders=p_confounders and p_revision in (a.revision,a.revision-1) then return public.grader_action_observation_json(a.id);end if;
 if a.revision<>p_revision or a.revision>=1000000 then return '{"error":"revision_conflict"}'::jsonb;end if;
 t:=clock_timestamp();
 if (p_implementation in ('started_as_planned','started_late') and (t at time zone 'UTC')::date<a.change_start_date) or (p_implementation='started_late' and (t at time zone 'UTC')::date<=a.change_start_date) then return '{"error":"action_observation_not_started"}'::jsonb;end if;
 if (select count(*) from public.grader_action_observation_events where workspace_id=a.workspace_id)>=2000 then return '{"error":"action_observation_change_limit"}'::jsonb;end if;
 update public.grader_action_observations set implementation=p_implementation,confounders=p_confounders,implementation_recorded_at=t,updated_at=t,revision=revision+1 where id=a.id returning * into a;
 insert into public.grader_action_observation_events(workspace_id,observation_id,action,revision,implementation,confounders) values(a.workspace_id,a.id,'check_in',a.revision,a.implementation,a.confounders);
 return public.grader_action_observation_json(a.id);
end;
$$;
create function public.grader_withdraw_action_observation(p_user_id uuid,p_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.grader_action_observations%rowtype;
begin
 if p_user_id is null or p_id is null or p_revision is null or p_revision not between 0 and 1000000 then raise exception 'invalid_action_observation';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select x.* into a from public.grader_action_observations x join public.grader_workspaces w on w.id=x.workspace_id where x.id=p_id and w.owner_user_id=p_user_id for update of x;
 if not found then return '{"error":"not_found"}'::jsonb;end if;
 if a.status='withdrawn' then return public.grader_action_observation_json(a.id);end if;
 if a.revision<>p_revision then return '{"error":"revision_conflict"}'::jsonb;end if;
 update public.grader_action_observations set status='withdrawn',withdrawn_at=clock_timestamp(),updated_at=clock_timestamp(),revision=least(revision+1,1000000) where id=a.id returning * into a;
 if (select count(*) from public.grader_action_observation_events where workspace_id=a.workspace_id)<2072 then insert into public.grader_action_observation_events(workspace_id,observation_id,action,revision,implementation,confounders) values(a.workspace_id,a.id,'withdrawn',a.revision,a.implementation,a.confounders);end if;
 return public.grader_action_observation_json(a.id);
end;
$$;
create function public.grader_export_action_observations(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version','private-action-observation-v1','observations',public.grader_read_action_observations(p_user_id)->'observations','events',coalesce((select jsonb_agg(jsonb_build_object('observationId',e.observation_id,'action',e.action,'revision',e.revision,'implementation',e.implementation,'confounders',e.confounders,'recordedAt',e.recorded_at) order by e.recorded_at,e.id) from public.grader_action_observation_events e join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb));
$$;
revoke execute on function public.grader_action_confounders_valid(jsonb),public.grader_action_practice_scope(jsonb),public.grader_action_metric(text,jsonb,integer),public.grader_action_observation_json(uuid),public.grader_read_action_observations(uuid),public.grader_register_action_observation(uuid,text,jsonb),public.grader_check_in_action_observation(uuid,uuid,integer,text,jsonb),public.grader_withdraw_action_observation(uuid,uuid,integer),public.grader_export_action_observations(uuid) from public,anon,authenticated;
grant execute on function public.grader_action_confounders_valid(jsonb),public.grader_action_practice_scope(jsonb),public.grader_action_metric(text,jsonb,integer),public.grader_action_observation_json(uuid),public.grader_read_action_observations(uuid),public.grader_register_action_observation(uuid,text,jsonb),public.grader_check_in_action_observation(uuid,uuid,integer,text,jsonb),public.grader_withdraw_action_observation(uuid,uuid,integer),public.grader_export_action_observations(uuid) to service_role;
