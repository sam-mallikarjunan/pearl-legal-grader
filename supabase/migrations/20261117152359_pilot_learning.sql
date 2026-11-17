-- One bounded voluntary pilot cohort. The opt-in row is also its deletion boundary.
-- Operators receive only fixed aggregate summaries, never identities or outcome values.
create table public.grader_pilot_participation (
  workspace_id uuid primary key references public.grader_workspaces(id) on delete cascade,
  cohort text not null check(cohort='first-improvement-v1'),
  joined_at timestamptz not null default clock_timestamp(),
  revision integer not null default 0 check(revision between 0 and 1000000),
  usefulness text check(usefulness in ('useful','not_yet','unsure')),
  blocker text check(blocker in ('finding_action','finding_baseline','choosing_measure','making_time','reporting_followup','other','none')),
  first_useful_at timestamptz,
  feedback_updated_at timestamptz,
  check((usefulness is not distinct from 'useful')=(first_useful_at is not null)),
  check(first_useful_at is null or first_useful_at>=joined_at),
  check(feedback_updated_at is null or feedback_updated_at>=joined_at)
);
alter table public.grader_pilot_participation enable row level security;
revoke all on table public.grader_pilot_participation from public, anon, authenticated;
grant all on table public.grader_pilot_participation to service_role;

create function public.grader_read_pilot(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('participation',(
    select jsonb_build_object(
      'cohort',p.cohort,'joinedAt',p.joined_at,'revision',p.revision,
      'usefulness',p.usefulness,'blocker',p.blocker,'firstUsefulAt',p.first_useful_at,
      'feedbackUpdatedAt',p.feedback_updated_at)
    from public.grader_pilot_participation p
    join public.grader_workspaces w on w.id=p.workspace_id
    where w.owner_user_id=p_user_id));
$$;

create function public.grader_join_pilot(p_user_id uuid,p_cohort text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid;
begin
  if p_user_id is null or p_cohort is distinct from 'first-improvement-v1' then
    return '{"error":"invalid_pilot_cohort"}';
  end if;
  -- Consistent owner lock, then single bounded cohort lock. No unrelated work acquires the cohort lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('grader_pilot_first_improvement_v1',82991));
  select id into v_workspace from public.grader_workspaces where owner_user_id=p_user_id;
  if exists(select 1 from public.grader_pilot_participation where workspace_id=v_workspace) then
    return public.grader_read_pilot(p_user_id);
  end if;
  if (select count(*) from public.grader_pilot_participation)>=10 then
    return '{"error":"pilot_capacity"}';
  end if;
  v_workspace:=public.grader_ensure_workspace(p_user_id);
  insert into public.grader_pilot_participation(workspace_id,cohort) values(v_workspace,p_cohort);
  return public.grader_read_pilot(p_user_id);
end;
$$;

create function public.grader_update_pilot_feedback(
  p_user_id uuid,p_joined_at timestamptz,p_revision integer,p_usefulness text,p_blocker text
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid;v_now timestamptz;
begin
  if p_user_id is null or p_joined_at is null or p_revision is null or p_revision not between 0 and 1000000
    or (p_usefulness is not null and p_usefulness not in ('useful','not_yet','unsure'))
    or (p_blocker is not null and p_blocker not in ('finding_action','finding_baseline','choosing_measure','making_time','reporting_followup','other','none')) then
    return '{"error":"invalid_pilot_feedback"}';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
  select id into v_workspace from public.grader_workspaces where owner_user_id=p_user_id;
  v_now:=clock_timestamp();
  update public.grader_pilot_participation as p set
    usefulness=p_usefulness,blocker=p_blocker,
    first_useful_at=case when p_usefulness='useful' then coalesce(p.first_useful_at,v_now) else null end,
    feedback_updated_at=case when p_usefulness is null and p_blocker is null then null else v_now end,
    revision=p.revision+1
  where p.workspace_id=v_workspace and p.joined_at=p_joined_at and p.revision=p_revision and p.revision<1000000;
  if not found then return '{"error":"pilot_changed"}';end if;
  return public.grader_read_pilot(p_user_id);
end;
$$;

create function public.grader_leave_pilot(p_user_id uuid,p_joined_at timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid;v_joined_at timestamptz;
begin
  if p_user_id is null or p_joined_at is null then return '{"error":"invalid_pilot_feedback"}';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
  select id into v_workspace from public.grader_workspaces where owner_user_id=p_user_id;
  select joined_at into v_joined_at from public.grader_pilot_participation where workspace_id=v_workspace;
  if not found then return '{"participation":null}';end if;
  if v_joined_at is distinct from p_joined_at then return '{"error":"pilot_changed"}';end if;
  delete from public.grader_pilot_participation where workspace_id=v_workspace;
  return '{"participation":null}';
end;
$$;

create function public.grader_read_pilot_summary() returns jsonb
language sql stable security invoker set search_path='' as $$
  with cohort as materialized (
    select * from public.grader_pilot_participation where cohort='first-improvement-v1'
  ), consented as (
    select * from cohort where (select count(*) from cohort)>=5
  ), first_tracking as (
    -- Lock attribution to the first retained registration made after opt-in.
    -- Withdrawal/ineligibility is not a reason to substitute a more favorable period.
    select c.workspace_id,a.*
    from consented c
    join lateral (
      select o.id,o.plan_id,o.report_id,o.baseline_period_id,o.baseline_snapshot,
             o.window_snapshot,o.scope_declared,o.metric_id,o.status,o.created_at
      from public.grader_action_observations o
      where o.workspace_id=c.workspace_id and o.created_at>=c.joined_at
      order by o.created_at,o.id limit 1
    ) a on true
  ), eligible as (
    select a.workspace_id,a.metric_id,p.end_date,p.status,p.outcome_id,p.baseline_report_id,
           p.start_date,p.source,p.currency
    from first_tracking a
    join public.grader_reports r on r.id=a.report_id and r.workspace_id=a.workspace_id
    join public.grader_outcome_plans p on p.id=a.plan_id and p.workspace_id=a.workspace_id
    join public.grader_outcome_periods b on b.id=a.baseline_period_id and b.workspace_id=a.workspace_id
    where a.status='registered' and p.status in ('registered','reported')
      and p.baseline_report_id=a.report_id and p.start_date::text=a.window_snapshot->>'startDate'
      and p.end_date::text=a.window_snapshot->>'endDate' and p.source=a.window_snapshot->>'source'
      and p.currency=a.window_snapshot->>'currency' and p.baseline_release_id=a.window_snapshot->>'releaseId'
      and a.created_at<p.start_date::timestamp at time zone 'UTC'
      and b.id::text=a.baseline_snapshot->>'id' and b.revision::text=a.baseline_snapshot->>'revision'
      and b.start_date::text=a.baseline_snapshot->>'startDate' and b.end_date::text=a.baseline_snapshot->>'endDate'
      and b.source=a.baseline_snapshot->>'source' and b.currency=a.baseline_snapshot->>'currency'
      and b.baseline_report_id::text is not distinct from (a.baseline_snapshot->>'baselineReportId')
      and (b.baseline_report_id is not null or a.scope_declared)
      and b.source=p.source and b.currency=p.currency
      and a.baseline_snapshot#>>'{observation,value}' is not null
      and public.grader_action_metric(a.metric_id,b.period_values,b.end_date-b.start_date+1)=a.baseline_snapshot->'observation'
  ), elapsed as (
    select * from eligible where end_date<(statement_timestamp() at time zone 'UTC')::date
  ), exact_followup as (
    select e.workspace_id,e.metric_id,f.period_values,f.end_date-f.start_date+1 as days
    from elapsed e join public.grader_outcome_periods f
      on f.id=e.outcome_id and f.workspace_id=e.workspace_id and e.status='reported'
      and f.start_date=e.start_date and f.end_date=e.end_date
      and f.source=e.source and f.currency=e.currency and f.baseline_report_id=e.baseline_report_id
  ), feedback as (
    select count(*) filter(where usefulness is not null) as responses,
           count(*) filter(where usefulness='useful') as useful,
           count(*) filter(where blocker is not null) as blocker_responses,
           case when count(first_useful_at)>=5 then
             (round((percentile_cont(0.5) within group
               (order by extract(epoch from first_useful_at-joined_at)/300))::numeric)*5)::integer
           end as median_minutes_to_useful
    from consented
  ), common_blockers as (
    select blocker,count(*) as n from consented where blocker is not null
    group by blocker having count(*)>=3 and (select blocker_responses from feedback)-count(*)>=3
  )
  select jsonb_build_object(
    'cohort','first-improvement-v1','capacity',10,'minimumForDetail',5,
    'enrolled',(select count(*) from cohort),
    'details',case when (select count(*) from cohort)>=5 then jsonb_build_object(
      'reportsAvailable',(select count(*) from consented c where exists(
        select 1 from public.grader_reports r where r.workspace_id=c.workspace_id)),
      'reportsSavedSinceJoining',(select count(*) from consented c where exists(
        select 1 from public.grader_reports r where r.workspace_id=c.workspace_id and r.saved_at>=c.joined_at)),
      'savedReportAndActionChosen',(select count(*) from consented c where exists(
        select 1 from public.grader_reports r join public.grader_action_progress a on r.id=a.report_id
        where r.workspace_id=c.workspace_id and a.state in ('in_progress','done') and a.updated_at>=c.joined_at
      ) or exists(select 1 from eligible a where a.workspace_id=c.workspace_id)),
      'newPlans',(select count(*) from consented c where exists(
        select 1 from public.grader_outcome_plans p join public.grader_reports r
          on r.id=p.baseline_report_id and r.workspace_id=c.workspace_id
        where p.workspace_id=c.workspace_id and p.status in ('registered','reported') and p.created_at>=c.joined_at)),
      'eligibleTracking',(select count(*) from eligible),
      'elapsedWindows',(select count(*) from elapsed),
      'exactFollowups',(select count(*) from exact_followup),
      'comparableFollowups',(select count(*) from exact_followup f where
        public.grader_action_metric(f.metric_id,f.period_values,f.days)->>'value' is not null),
      'usefulnessResponses',(select responses from feedback),
      'usefulResponses',(select useful from feedback),
      'medianMinutesToUseful',(select median_minutes_to_useful from feedback),
      'blockerResponses',(select blocker_responses from feedback),
      'commonBlockers',coalesce((select jsonb_object_agg(blocker,n) from common_blockers),'{}'::jsonb),
      'helpRequests',(select count(*) from consented c where exists(
        select 1 from public.grader_lead_requests h where h.workspace_id=c.workspace_id and h.created_at>=c.joined_at
          and h.contact_consent and h.status<>'withdrawn'))
    ) else null end
  );
$$;
revoke execute on function
  public.grader_read_pilot(uuid),public.grader_join_pilot(uuid,text),
  public.grader_update_pilot_feedback(uuid,timestamptz,integer,text,text),
  public.grader_leave_pilot(uuid,timestamptz),public.grader_read_pilot_summary()
from public,anon,authenticated;
grant execute on function
  public.grader_read_pilot(uuid),public.grader_join_pilot(uuid,text),
  public.grader_update_pilot_feedback(uuid,timestamptz,integer,text,text),
  public.grader_leave_pilot(uuid,timestamptz),public.grader_read_pilot_summary()
to service_role;
