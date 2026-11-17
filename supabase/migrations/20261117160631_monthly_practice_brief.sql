-- Latest private owner decision per registered observation. No copied figures,
-- peer comparison, additional permissions, telemetry, or stored free text.
create table public.grader_monthly_brief_decisions (
  observation_id uuid primary key references public.grader_action_observations(id) on delete cascade,
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  choice text not null check (choice in ('keep', 'adjust', 'stop', 'need_more_data')),
  revision integer not null default 0 check (revision between 0 and 1000000),
  evidence jsonb not null check (
    jsonb_typeof(evidence) = 'object'
    and octet_length(evidence::text) <= 350
    and evidence ?& array['observationRevision', 'planRevision', 'baselineRevision', 'followupId', 'followupRevision']
    and evidence - array['observationRevision', 'planRevision', 'baselineRevision', 'followupId', 'followupRevision'] = '{}'::jsonb
    and jsonb_typeof(evidence->'observationRevision') = 'number'
    and jsonb_typeof(evidence->'planRevision') = 'number'
    and jsonb_typeof(evidence->'baselineRevision') = 'number'
    and (
      (evidence->'followupId' = 'null'::jsonb and evidence->'followupRevision' = 'null'::jsonb)
      or (jsonb_typeof(evidence->'followupId') = 'string' and jsonb_typeof(evidence->'followupRevision') = 'number')
    )
  ),
  saved_at timestamptz not null default clock_timestamp()
);
create index grader_monthly_brief_decisions_owner_idx
  on public.grader_monthly_brief_decisions(workspace_id, saved_at desc, observation_id);
alter table public.grader_monthly_brief_decisions enable row level security;
revoke all on table public.grader_monthly_brief_decisions from public, anon, authenticated;
grant all on table public.grader_monthly_brief_decisions to service_role;

-- Re-check the same closed-window lineage as the existing action comparison.
-- The saving transaction already holds the shared owner lock used by the
-- outcomes, plans, and action observation mutation paths.
create function public.grader_monthly_brief_review(p_workspace_id uuid, p_observation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  a public.grader_action_observations%rowtype;
  p public.grader_outcome_plans%rowtype;
  b public.grader_outcome_periods%rowtype;
  f public.grader_outcome_periods%rowtype;
  result_status text;
begin
  select * into a from public.grader_action_observations
    where id = p_observation_id and workspace_id = p_workspace_id;
  if not found or a.status <> 'registered' or a.report_id is null
    or a.baseline_period_id is null then return null; end if;

  select * into p from public.grader_outcome_plans
    where id = a.plan_id and workspace_id = p_workspace_id;
  if not found or p.status not in ('registered', 'reported')
    or p.end_date >= (statement_timestamp() at time zone 'UTC')::date
    or p.baseline_report_id is distinct from a.report_id
    or p.start_date::text is distinct from a.window_snapshot->>'startDate'
    or p.end_date::text is distinct from a.window_snapshot->>'endDate'
    or p.source is distinct from a.window_snapshot->>'source'
    or p.currency is distinct from a.window_snapshot->>'currency'
    or p.baseline_release_id is distinct from a.window_snapshot->>'releaseId'
    or not exists (
      select 1 from public.grader_reports r where r.id = a.report_id
        and r.workspace_id = p_workspace_id and r.content_hash = p.baseline_content_hash
        and r.snapshot->>'isSample' = 'false'
    ) then return null; end if;

  select * into b from public.grader_outcome_periods
    where id = a.baseline_period_id and workspace_id = p_workspace_id;
  if not found
    or b.id::text is distinct from a.baseline_snapshot->>'id'
    or b.revision::text is distinct from a.baseline_snapshot->>'revision'
    or b.start_date::text is distinct from a.baseline_snapshot->>'startDate'
    or b.end_date::text is distinct from a.baseline_snapshot->>'endDate'
    or b.source is distinct from a.baseline_snapshot->>'source'
    or b.currency is distinct from a.baseline_snapshot->>'currency'
    or b.baseline_report_id::text is distinct from a.baseline_snapshot->>'baselineReportId'
    or (b.baseline_report_id is null and not a.scope_declared)
    or b.source <> p.source or b.currency <> p.currency
    or b.end_date >= a.change_start_date
    or a.baseline_snapshot#>>'{observation,value}' is null
    or public.grader_action_metric(a.metric_id, b.period_values, b.end_date - b.start_date + 1)
      is distinct from a.baseline_snapshot->'observation'
    then return null; end if;

  if p.status = 'registered' and p.outcome_id is null then
    result_status := 'unreported';
  elsif p.status = 'reported' and p.outcome_id is not null then
    select * into f from public.grader_outcome_periods
      where id = p.outcome_id and workspace_id = p_workspace_id;
    if not found or f.start_date <> p.start_date or f.end_date <> p.end_date
      or f.source <> p.source or f.currency <> p.currency
      or f.baseline_report_id is distinct from a.report_id then return null; end if;
    if public.grader_action_metric(a.metric_id, f.period_values, f.end_date - f.start_date + 1)->>'value' is null then
      result_status := 'unknown';
    else
      result_status := 'descriptive';
    end if;
  else
    return null;
  end if;

  return jsonb_build_object(
    'status', result_status,
    'evidence', jsonb_build_object(
      'observationRevision', a.revision,
      'planRevision', p.revision,
      'baselineRevision', b.revision,
      'followupId', f.id,
      'followupRevision', f.revision
    )
  );
end;
$$;

create function public.grader_monthly_brief_decision_json(d public.grader_monthly_brief_decisions)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'observationId', d.observation_id, 'choice', d.choice, 'revision', d.revision,
    'evidence', d.evidence, 'savedAt', d.saved_at
  );
$$;

create function public.grader_read_monthly_brief_decisions(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'version', 'monthly-practice-brief-v1',
    'decisions', coalesce((
      select jsonb_agg(public.grader_monthly_brief_decision_json(d) order by d.saved_at desc, d.observation_id)
      from public.grader_monthly_brief_decisions d join public.grader_workspaces w on w.id = d.workspace_id
      where w.owner_user_id = p_user_id
    ), '[]'::jsonb)
  );
$$;

create function public.grader_read_monthly_brief_context(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  -- Both inputs use the same authorized database snapshot.
  select jsonb_build_object(
    'context', public.grader_read_action_observations(p_user_id),
    'decisions', public.grader_read_monthly_brief_decisions(p_user_id)
  );
$$;

create function public.grader_save_monthly_brief_decision(
  p_user_id uuid, p_observation_id uuid, p_choice text, p_expected_revision integer, p_evidence jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  ws uuid;
  reviewed jsonb;
  d public.grader_monthly_brief_decisions%rowtype;
begin
  if p_user_id is null or p_observation_id is null or p_choice is null
    or p_choice not in ('keep', 'adjust', 'stop', 'need_more_data')
    or (p_expected_revision is not null and p_expected_revision not between 0 and 1000000)
    or jsonb_typeof(p_evidence) is distinct from 'object'
    or octet_length(p_evidence::text) > 350
    then return '{"error":"invalid_monthly_brief_decision"}'::jsonb; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 82991));
  select a.workspace_id into ws from public.grader_action_observations a
    join public.grader_workspaces w on w.id = a.workspace_id
    where a.id = p_observation_id and w.owner_user_id = p_user_id
    for share of a;
  if not found then return '{"error":"monthly_brief_not_found"}'::jsonb; end if;

  reviewed := public.grader_monthly_brief_review(ws, p_observation_id);
  if reviewed is null
    or (p_choice <> 'need_more_data' and reviewed->>'status' <> 'descriptive')
    then return '{"error":"monthly_brief_not_decidable"}'::jsonb; end if;
  if reviewed->'evidence' is distinct from p_evidence
    then return '{"error":"monthly_brief_conflict"}'::jsonb; end if;

  select * into d from public.grader_monthly_brief_decisions where observation_id = p_observation_id;
  if found then
    if d.workspace_id <> ws then return '{"error":"monthly_brief_not_found"}'::jsonb; end if;
    if d.evidence = p_evidence and d.choice = p_choice then
      -- A lost response can be retried without creating a new revision.
      return public.grader_monthly_brief_decision_json(d);
    end if;
    if d.revision is distinct from p_expected_revision or d.revision >= 1000000
      then return '{"error":"monthly_brief_conflict"}'::jsonb; end if;
    update public.grader_monthly_brief_decisions
      set choice = p_choice, revision = revision + 1, evidence = p_evidence, saved_at = clock_timestamp()
      where observation_id = p_observation_id and workspace_id = ws
      returning * into d;
  else
    if p_expected_revision is not null
      then return '{"error":"monthly_brief_conflict"}'::jsonb; end if;
    insert into public.grader_monthly_brief_decisions(observation_id, workspace_id, choice, evidence)
      values (p_observation_id, ws, p_choice, p_evidence) returning * into d;
  end if;
  return public.grader_monthly_brief_decision_json(d);
end;
$$;

revoke execute on function
  public.grader_monthly_brief_review(uuid, uuid),
  public.grader_monthly_brief_decision_json(public.grader_monthly_brief_decisions),
  public.grader_read_monthly_brief_decisions(uuid),
  public.grader_read_monthly_brief_context(uuid),
  public.grader_save_monthly_brief_decision(uuid, uuid, text, integer, jsonb)
from public, anon, authenticated;
grant execute on function
  public.grader_monthly_brief_review(uuid, uuid),
  public.grader_monthly_brief_decision_json(public.grader_monthly_brief_decisions),
  public.grader_read_monthly_brief_decisions(uuid),
  public.grader_read_monthly_brief_context(uuid),
  public.grader_save_monthly_brief_decision(uuid, uuid, text, integer, jsonb)
to service_role;
