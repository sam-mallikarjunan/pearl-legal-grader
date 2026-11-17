-- Attach reviewed totals to an existing closed plan without opening the generic
-- import path to reserved periods. History retains a private receipt, never
-- another copy of the original totals or a foreign key that can reopen the plan.
alter table public.grader_data_deliveries
  add column reporting_plan_id uuid,
  add column reporting_plan_revision integer,
  add constraint grader_data_delivery_reporting_plan_receipt check (
    (reporting_plan_id is null and reporting_plan_revision is null)
    or (reporting_plan_id is not null and reporting_plan_revision is not null
        and reporting_plan_revision between 0 and 999999
        and status='imported' and period_count=1)
  );

create or replace function public.grader_data_delivery_json(p_id uuid,p_details boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',id,'revision',revision,'connectionId',connection_id,
    'createdAt',created_at,'expiresAt',expires_at,'status',status,'periodCount',period_count,
    'importBatchId',import_batch_id)
    || case when reporting_plan_id is not null then jsonb_build_object('reportingPlanId',reporting_plan_id) else '{}'::jsonb end
    || case when p_details then jsonb_build_object('periods',periods) else '{}'::jsonb end
  from public.grader_data_deliveries where id=p_id;
$$;

create function public.grader_apply_delivery_to_plan(
  p_user_id uuid,p_delivery_id uuid,p_delivery_revision integer,p_plan_id uuid,p_plan_revision integer
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  delivery public.grader_data_deliveries%rowtype;
  plan public.grader_outcome_plans%rowtype;
  item jsonb; values_json jsonb; saved jsonb; receipt_id uuid; period_id uuid;
begin
  if p_user_id is null or p_delivery_id is null or p_plan_id is null
    or p_delivery_revision is null or p_delivery_revision not between 0 and 999999
    or p_plan_revision is null or p_plan_revision not between 0 and 999999 then
    return '{"error":"invalid_data_delivery"}'::jsonb;
  end if;

  -- Match the lock used by ordinary imports, plan reports, report deletion and withdrawal.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
  select d.* into delivery
    from public.grader_data_deliveries d
    join public.grader_workspaces w on w.id=d.workspace_id
    where d.id=p_delivery_id and w.owner_user_id=p_user_id for update of d;
  if not found then return '{"error":"data_not_found"}'::jsonb;end if;
  if delivery.status='imported' then
    -- Even a deleted/corrected linked period cannot be overwritten or restored.
    if delivery.reporting_plan_id is distinct from p_plan_id
      or delivery.reporting_plan_revision is distinct from p_plan_revision
      or delivery.revision<>p_delivery_revision+1 then
      return '{"error":"data_plan_delivery_used"}'::jsonb;
    end if;
    return jsonb_build_object('delivery',public.grader_data_delivery_json(delivery.id,true),
      'result',public.grader_outcome_import_json(delivery.import_batch_id,false));
  end if;
  if delivery.status<>'pending' then return '{"error":"data_delivery_closed"}'::jsonb;end if;
  if delivery.expires_at<=clock_timestamp() then
    update public.grader_data_deliveries
      set status='expired',periods=null,revision=least(revision+1,1000000) where id=delivery.id;
    return '{"error":"data_delivery_closed"}'::jsonb;
  end if;
  if delivery.revision<>p_delivery_revision then return '{"error":"data_revision_conflict"}'::jsonb;end if;
  if delivery.period_count<>1 then return '{"error":"data_plan_single_period"}'::jsonb;end if;
  if public.grader_data_periods_valid(delivery.periods) is distinct from true then
    return '{"error":"invalid_data_delivery"}'::jsonb;
  end if;

  select p.* into plan from public.grader_outcome_plans p
    where p.id=p_plan_id and p.workspace_id=delivery.workspace_id for update;
  if not found then return '{"error":"data_not_found"}'::jsonb;end if;
  if plan.status<>'registered' or plan.outcome_id is not null
    or plan.baseline_report_id is null or plan.baseline_snapshot is null then
    return '{"error":"data_plan_not_pending"}'::jsonb;
  end if;
  if plan.revision<>p_plan_revision then return '{"error":"data_revision_conflict"}'::jsonb;end if;
  if plan.end_date>=(clock_timestamp() at time zone 'UTC')::date then
    return '{"error":"data_plan_not_closed"}'::jsonb;
  end if;
  item:=delivery.periods->0;
  if plan.source<>'export' or plan.source is distinct from item->>'source'
    or plan.currency is distinct from item->>'currency'
    or plan.start_date is distinct from (item->>'startDate')::date
    or plan.end_date is distinct from (item->>'endDate')::date then
    return '{"error":"data_plan_mismatch"}'::jsonb;
  end if;
  if exists(select 1 from public.grader_outcome_imports b
    where b.workspace_id=delivery.workspace_id and b.request_id=delivery.id) then
    return '{"error":"outcome_import_request_conflict"}'::jsonb;
  end if;
  if (select count(*) from public.grader_outcome_imports b where b.workspace_id=delivery.workspace_id)>=100 then
    return '{"error":"outcome_import_limit"}'::jsonb;
  end if;

  -- The existing plan reporter owns validation, the frozen baseline link,
  -- the period/audit quotas and ordinary exclusion against saved periods.
  values_json:=item-ARRAY['startDate','endDate','source','currency','baselineReportId'];
  saved:=public.grader_report_outcome_plan(p_user_id,plan.id,p_plan_revision,values_json);
  if saved ? 'error' then return saved;end if;
  period_id:=(saved#>>'{period,id}')::uuid;
  if period_id is null or saved#>>'{plan,outcomeId}' is distinct from period_id::text
    or saved#>>'{plan,status}' is distinct from 'reported' then
    raise exception 'invalid_data_delivery';
  end if;

  insert into public.grader_outcome_imports(workspace_id,request_id,content_hash,period_ids)
    values(delivery.workspace_id,delivery.id,delivery.content_hash,array[period_id])
    returning id into receipt_id;
  update public.grader_data_deliveries set status='imported',periods=null,
    revision=revision+1,import_batch_id=receipt_id,
    reporting_plan_id=plan.id,reporting_plan_revision=p_plan_revision
    where id=delivery.id;
  return jsonb_build_object('delivery',public.grader_data_delivery_json(delivery.id,true),
    'result',public.grader_outcome_import_json(receipt_id,true));
end;
$$;
revoke execute on function public.grader_apply_delivery_to_plan(uuid,uuid,integer,uuid,integer) from public,anon,authenticated;
grant execute on function public.grader_apply_delivery_to_plan(uuid,uuid,integer,uuid,integer) to service_role;
