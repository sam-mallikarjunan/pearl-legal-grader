-- Only reviewed aggregate periods reach this boundary. Raw files, source headers,
-- mappings and unselected cells are never part of the database contract.
create table public.grader_outcome_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  request_id uuid not null,
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  period_ids uuid[] not null check(cardinality(period_ids) between 1 and 24),
  created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,request_id)
);
create index grader_outcome_imports_owner_idx on public.grader_outcome_imports(workspace_id,created_at);
alter table public.grader_outcome_imports enable row level security;
revoke all on table public.grader_outcome_imports from public,anon,authenticated;
grant all on table public.grader_outcome_imports to service_role;

create function public.grader_outcome_import_json(p_id uuid,p_created boolean) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'batchId',b.id,'periodIds',to_jsonb(b.period_ids),
    'created',p_created,'replayed',not p_created,
    'activePeriodCount',(select count(*) from public.grader_outcome_periods o where o.workspace_id=b.workspace_id and o.id=any(b.period_ids))
  ) from public.grader_outcome_imports b where b.id=p_id;
$$;

create function public.grader_import_outcome_periods(p_user_id uuid,p_request uuid,p_hash text,p_periods jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  workspace uuid; receipt public.grader_outcome_imports%rowtype;
  item jsonb; saved jsonb; values_json jsonb;
  ids uuid[]:=array[]::uuid[]; failure_code text;
begin
  if p_user_id is null or p_request is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_periods) is distinct from 'array' then raise exception 'invalid_outcome_import'; end if;
  if jsonb_array_length(p_periods) not between 1 and 24 or octet_length(p_periods::text)>64000 then raise exception 'invalid_outcome_import'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
  workspace:=public.grader_ensure_workspace(p_user_id);
  select b.* into receipt from public.grader_outcome_imports b where b.workspace_id=workspace and b.request_id=p_request;
  if found then
    if receipt.content_hash is distinct from p_hash then return '{"error":"outcome_import_request_conflict"}'::jsonb; end if;
    -- A retry never recreates a deleted period or consumes another allowance.
    return public.grader_outcome_import_json(receipt.id,false);
  end if;
  if (select count(*) from public.grader_outcome_imports b where b.workspace_id=workspace)>=100 then
    return '{"error":"outcome_import_limit"}'::jsonb;
  end if;
  if (select count(*) from public.grader_outcome_periods o where o.workspace_id=workspace)+jsonb_array_length(p_periods)>24 then
    return '{"error":"outcome_period_limit"}'::jsonb;
  end if;
  -- This block is a subtransaction. Any rejected row rolls back EVERY preceding
  -- row and its audit event. Returning an error from an ordinary loop would not.
  begin
    for item in select value from jsonb_array_elements(p_periods) loop
      if jsonb_typeof(item) is distinct from 'object' or item->>'source' is distinct from 'export'
        or item->'baselineReportId' is distinct from 'null'::jsonb
        or exists(select 1 from jsonb_object_keys(item) k where not(k=any(array[
          'startDate','endDate','source','currency','baselineReportId','inquiries','contacted','booked','attended','clients',
          'leadSpendMinor','cohortBilledMinor','cohortCollectedMinor','adminHours'
        ]))) then raise exception 'invalid_outcome_import'; end if;
      values_json:=jsonb_build_object(
        'inquiries',item->'inquiries','contacted',item->'contacted','booked',item->'booked',
        'attended',item->'attended','clients',item->'clients','leadSpendMinor',item->'leadSpendMinor',
        'cohortBilledMinor',item->'cohortBilledMinor','cohortCollectedMinor',item->'cohortCollectedMinor','adminHours',item->'adminHours'
      );
      saved:=public.grader_save_outcome(p_user_id,null,0,(item->>'startDate')::date,(item->>'endDate')::date,
        'export',item->>'currency',null,values_json);
      if saved ? 'error' then raise exception using message=saved->>'error'; end if;
      if saved->>'id' is null then raise exception 'invalid_outcome_import'; end if;
      ids:=array_append(ids,(saved->>'id')::uuid);
    end loop;
    insert into public.grader_outcome_imports(workspace_id,request_id,content_hash,period_ids)
      values(workspace,p_request,p_hash,ids) returning * into receipt;
  exception when sqlstate 'P0001' then
    get stacked diagnostics failure_code=message_text;
    if failure_code=any(array['invalid_outcome_import','invalid_outcome','outcome_period_overlap','outcome_plan_overlap','outcome_period_limit','outcome_change_limit']) then
      return jsonb_build_object('error',failure_code);
    end if;
    raise;
  end;
  return public.grader_outcome_import_json(receipt.id,true);
end;
$$;

create function public.grader_export_outcome_imports(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('imports',coalesce((
    select jsonb_agg(jsonb_build_object(
      'batchId',b.id,'importedAt',b.created_at,'periodCount',cardinality(b.period_ids),
      'activePeriodCount',(select count(*) from public.grader_outcome_periods o where o.workspace_id=b.workspace_id and o.id=any(b.period_ids))
    ) order by b.created_at,b.id)
    from public.grader_outcome_imports b join public.grader_workspaces w on w.id=b.workspace_id where w.owner_user_id=p_user_id
  ),'[]'::jsonb));
$$;
revoke execute on function public.grader_outcome_import_json(uuid,boolean),public.grader_import_outcome_periods(uuid,uuid,text,jsonb),public.grader_export_outcome_imports(uuid) from public,anon,authenticated;
grant execute on function public.grader_outcome_import_json(uuid,boolean),public.grader_import_outcome_periods(uuid,uuid,text,jsonb),public.grader_export_outcome_imports(uuid) to service_role;
