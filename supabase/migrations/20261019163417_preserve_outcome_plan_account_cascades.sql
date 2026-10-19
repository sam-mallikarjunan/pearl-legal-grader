-- Account deletion cascades remove the workspace before dependent reports and
-- periods. Their plan-cleanup triggers must not update another child of that
-- deleted workspace; the workspace FK cascade will remove those plans itself.
-- Ordinary report/period deletion keeps its existing terminal-plan behavior.
create or replace function public.grader_outcome_plan_baseline_deleted() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.grader_workspaces w where w.id=old.workspace_id) then return old;end if;
 update public.grader_outcome_plans set status='withdrawn',baseline_snapshot=null,withdrawn_at=coalesce(withdrawn_at,clock_timestamp()),updated_at=clock_timestamp(),revision=least(revision+1,1000000) where baseline_report_id=old.id;
 return old;
end;
$$;

create or replace function public.grader_outcome_plan_period_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p public.grader_outcome_plans%rowtype;
begin
 if not exists(select 1 from public.grader_workspaces w where w.id=old.workspace_id) then
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
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
revoke execute on function public.grader_outcome_plan_baseline_deleted(),public.grader_outcome_plan_period_guard() from public,anon,authenticated;
grant execute on function public.grader_outcome_plan_baseline_deleted(),public.grader_outcome_plan_period_guard() to service_role;
