-- Service-only calibration source. The application recomputes canonical baselines and
-- returns only thresholded descriptive summaries, never these source rows.
create function public.grader_outcome_research_source_page(p_release_id text,p_after uuid,p_limit integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_release_id is null or p_release_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_limit is null or p_limit not between 1 and 2 then raise exception 'invalid_calibration_request';end if;
  if not exists(select 1 from public.grader_config_active where singleton and release_id=p_release_id) then raise exception 'calibration_release_changed';end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'workspaceId',w.id,'benchmarking',true,'outcomeResearch',true,
      'periods',coalesce((select jsonb_agg(public.grader_outcome_period_json(o.id) order by o.start_date,o.id) from public.grader_outcome_periods o where o.workspace_id=w.id),'[]'::jsonb),
      'baselines',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'savedAt',r.saved_at,'report',r.snapshot) order by r.saved_at,r.id)
        from public.grader_reports r where r.workspace_id=w.id and exists(select 1 from public.grader_outcome_periods o where o.workspace_id=w.id and o.baseline_report_id=r.id)),'[]'::jsonb)
    ) order by w.id),'[]'::jsonb)
    from (
      select w.id from public.grader_workspaces w
      join public.grader_preferences p on p.workspace_id=w.id
      join public.grader_outcome_research_consent c on c.workspace_id=w.id
      where p.preference_values->'benchmarking'='true'::jsonb and c.granted and c.version='outcome-research-consent-v1'
        and (p_after is null or w.id>p_after) and exists(select 1 from public.grader_outcome_periods o where o.workspace_id=w.id)
      order by w.id limit p_limit
    ) w
  );
end;
$$;

create function public.grader_outcome_research_current_consent(p_workspace_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_workspace_ids is null or cardinality(p_workspace_ids)>200 then raise exception 'invalid_calibration_request';end if;
  return (select coalesce(jsonb_agg(w.id order by w.id),'[]'::jsonb)
    from public.grader_workspaces w join public.grader_preferences p on p.workspace_id=w.id
    join public.grader_outcome_research_consent c on c.workspace_id=w.id
    where w.id=any(p_workspace_ids) and p.preference_values->'benchmarking'='true'::jsonb
      and c.granted and c.version='outcome-research-consent-v1');
end;
$$;

revoke execute on function public.grader_outcome_research_source_page(text,uuid,integer),public.grader_outcome_research_current_consent(uuid[]) from public,anon,authenticated;
grant execute on function public.grader_outcome_research_source_page(text,uuid,integer),public.grader_outcome_research_current_consent(uuid[]) to service_role;
