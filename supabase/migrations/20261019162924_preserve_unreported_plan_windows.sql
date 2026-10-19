-- New inserts have no outcome ID. Two NULL IDs do not identify the same
-- reported period: every active unreported registration still reserves its dates.
create or replace function public.grader_save_outcome(p_user_id uuid,p_id uuid,p_revision integer,p_start date,p_end date,p_source text,p_currency text,p_baseline uuid,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;
begin
 if p_user_id is null then raise exception 'invalid_outcome';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select id into w from public.grader_workspaces where owner_user_id=p_user_id;
 if exists(select 1 from public.grader_outcome_plans where workspace_id=w and outcome_id=p_id and (start_date is distinct from p_start or end_date is distinct from p_end or source is distinct from p_source or currency is distinct from p_currency or baseline_report_id is distinct from p_baseline)) then return '{"error":"outcome_plan_frozen"}'::jsonb;end if;
 if exists(select 1 from public.grader_outcome_plans where workspace_id=w and status<>'withdrawn' and (p_id is null or outcome_id is distinct from p_id) and daterange(start_date,end_date,'[]')&&daterange(p_start,p_end,'[]')) then return '{"error":"outcome_plan_overlap"}'::jsonb;end if;
 return public.grader_save_outcome_unplanned(p_user_id,p_id,p_revision,p_start,p_end,p_source,p_currency,p_baseline,p_values);
end;
$$;
revoke execute on function public.grader_save_outcome(uuid,uuid,integer,date,date,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.grader_save_outcome(uuid,uuid,integer,date,date,text,text,uuid,jsonb) to service_role;
