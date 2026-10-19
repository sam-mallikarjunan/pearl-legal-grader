-- Private aggregate business observations. No existing assessment permission grants outcome research.
create table public.grader_outcome_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  start_date date not null check(start_date>='1970-01-01'),
  end_date date not null,
  source text not null check(source in ('self_reported','export')),
  currency text not null check(currency in ('USD','CAD','GBP','EUR','AUD','NZD','INR')),
  baseline_report_id uuid references public.grader_reports(id) on delete set null,
  period_values jsonb not null check(jsonb_typeof(period_values)='object' and octet_length(period_values::text)<=2500),
  revision integer not null default 0 check(revision between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_date-start_date+1 between 7 and 366),
  unique(workspace_id,start_date,end_date)
);
create index grader_outcome_periods_owner_start_idx on public.grader_outcome_periods(workspace_id,start_date,id);
create index grader_outcome_periods_baseline_idx on public.grader_outcome_periods(baseline_report_id) where baseline_report_id is not null;
create table public.grader_outcome_research_consent (
  workspace_id uuid primary key references public.grader_workspaces(id) on delete cascade,
  granted boolean not null default false,
  revision integer not null default 0 check(revision between 0 and 1000000),
  version text not null default 'outcome-research-consent-v1' check(version='outcome-research-consent-v1'),
  updated_at timestamptz
);
create table public.grader_outcome_consent_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  granted boolean not null,
  version text not null,
  text text not null check(length(text) between 1 and 2000),
  recorded_at timestamptz not null default clock_timestamp()
);
create index grader_outcome_consent_events_owner_idx on public.grader_outcome_consent_events(workspace_id,recorded_at);
create table public.grader_outcome_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  period_id uuid not null,
  action text not null check(action in ('created','updated','deleted')),
  revision integer not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index grader_outcome_events_owner_idx on public.grader_outcome_events(workspace_id,recorded_at);

create function public.grader_outcome_period_json(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select period_values||jsonb_build_object('id',id,'revision',revision,'startDate',start_date,'endDate',end_date,'source',source,'currency',currency,'baselineReportId',baseline_report_id,'createdAt',created_at,'updatedAt',updated_at) from public.grader_outcome_periods where id=p_id;
$$;
create function public.grader_outcome_consent_json(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce((select jsonb_build_object('granted',c.granted,'revision',c.revision,'version',c.version,'updatedAt',c.updated_at) from public.grader_outcome_research_consent c join public.grader_workspaces w on w.id=c.workspace_id where w.owner_user_id=p_user_id),'{"granted":false,"revision":0,"version":"outcome-research-consent-v1","updatedAt":null}'::jsonb);
$$;
create function public.grader_read_outcomes(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('periods',coalesce((select jsonb_agg(public.grader_outcome_period_json(o.id) order by o.start_date desc,o.id) from public.grader_outcome_periods o join public.grader_workspaces w on w.id=o.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb),'consent',public.grader_outcome_consent_json(p_user_id));
$$;

create function public.grader_outcome_values_valid(p_values jsonb,p_days integer) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare k text;n numeric;previous numeric:=null;known integer:=0;
begin
  if jsonb_typeof(p_values) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_values))<>9 or p_days is null or p_days not between 7 and 366 then return false;end if;
  foreach k in array array['inquiries','contacted','booked','attended','clients','leadSpendMinor','cohortBilledMinor','cohortCollectedMinor','adminHours'] loop
    if not p_values ? k or jsonb_typeof(p_values->k) not in ('number','null') then return false;end if;
    if p_values->k='null'::jsonb then continue;end if;
    n:=(p_values->>k)::numeric;known:=known+1;
    if n<0 or (k in ('inquiries','contacted','booked','attended','clients') and (n>1000000 or n<>trunc(n))) or (k in ('leadSpendMinor','cohortBilledMinor','cohortCollectedMinor') and (n>10000000000 or n<>trunc(n))) or (k='adminHours' and (n>p_days*24 or n<>round(n,2))) then return false;end if;
    if k in ('inquiries','contacted','booked','attended','clients') then
      if previous is not null and n>previous then return false;end if;previous:=n;
    end if;
  end loop;
  if known=0 or ((p_values->>'cohortCollectedMinor')::numeric>(p_values->>'cohortBilledMinor')::numeric) then return false;end if;
  return true;
exception when others then return false;
end;
$$;

create function public.grader_save_outcome(p_user_id uuid,p_id uuid,p_revision integer,p_start date,p_end date,p_source text,p_currency text,p_baseline uuid,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;v_row public.grader_outcome_periods%rowtype;v_cutoff timestamptz;v_action text;
begin
  if p_user_id is null or p_start is null or p_end is null or p_start<'1970-01-01' or p_end>=(clock_timestamp() at time zone 'UTC')::date or p_end-p_start+1 not between 7 and 366 or p_source is null or p_source not in ('self_reported','export') or p_currency is null or p_currency not in ('USD','CAD','GBP','EUR','AUD','NZD','INR') or p_revision is null or p_revision not between 0 and 1000000 or not public.grader_outcome_values_valid(p_values,p_end-p_start+1) then raise exception 'invalid_outcome';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
  w:=public.grader_ensure_workspace(p_user_id);
  if (select count(*) from public.grader_outcome_events where workspace_id=w)>=2000 then return '{"error":"outcome_change_limit"}'::jsonb;end if;
  if p_id is not null then
    select * into v_row from public.grader_outcome_periods where id=p_id and workspace_id=w for update;
    if not found then return '{"error":"not_found"}'::jsonb;end if;
    if v_row.revision<>p_revision or v_row.revision>=1000000 then return '{"error":"revision_conflict"}'::jsonb;end if;
  elsif p_revision<>0 then return '{"error":"revision_conflict"}'::jsonb;
  elsif (select count(*) from public.grader_outcome_periods where workspace_id=w)>=24 then return '{"error":"outcome_period_limit"}'::jsonb;
  end if;
  if exists(select 1 from public.grader_outcome_periods where workspace_id=w and (p_id is null or id<>p_id) and daterange(start_date,end_date,'[]') && daterange(p_start,p_end,'[]')) then return '{"error":"outcome_period_overlap"}'::jsonb;end if;
  if p_baseline is not null then
    v_cutoff:=p_start::timestamp at time zone 'UTC';
    if not exists(select 1 from public.grader_reports where id=p_baseline and workspace_id=w and snapshot->>'isSample'='false' and saved_at<=v_cutoff and (snapshot->>'createdAt')::timestamptz<=v_cutoff) then return '{"error":"outcome_baseline_invalid"}'::jsonb;end if;
  end if;
  if p_id is null then
    insert into public.grader_outcome_periods(workspace_id,start_date,end_date,source,currency,baseline_report_id,period_values) values(w,p_start,p_end,p_source,p_currency,p_baseline,p_values) returning * into v_row;
    v_action:='created';
  else
    update public.grader_outcome_periods set start_date=p_start,end_date=p_end,source=p_source,currency=p_currency,baseline_report_id=p_baseline,period_values=p_values,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
    v_action:='updated';
  end if;
  insert into public.grader_outcome_events(workspace_id,period_id,action,revision) values(w,v_row.id,v_action,v_row.revision);
  return public.grader_outcome_period_json(v_row.id);
end;
$$;

create function public.grader_delete_outcome(p_user_id uuid,p_id uuid,p_revision integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_row public.grader_outcome_periods%rowtype;
begin
  if p_user_id is null or p_id is null or p_revision is null or p_revision not between 0 and 1000000 then raise exception 'invalid_outcome';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
  select o.* into v_row from public.grader_outcome_periods o join public.grader_workspaces w on w.id=o.workspace_id where o.id=p_id and w.owner_user_id=p_user_id for update of o;
  if not found then raise exception 'not_found';end if;
  if v_row.revision<>p_revision then raise exception 'revision_conflict';end if;
  -- Deletion remains available even after the change allowance is exhausted.
  delete from public.grader_outcome_periods where id=p_id;
  if (select count(*) from public.grader_outcome_events where workspace_id=v_row.workspace_id)<2024 then insert into public.grader_outcome_events(workspace_id,period_id,action,revision) values(v_row.workspace_id,p_id,'deleted',p_revision);end if;
  return true;
end;
$$;

create function public.grader_set_outcome_research_consent(p_user_id uuid,p_revision integer,p_granted boolean,p_version text,p_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;c public.grader_outcome_research_consent%rowtype;
begin
  if p_user_id is null or p_revision is null or p_revision not between 0 and 1000000 or p_granted is null or p_version is distinct from 'outcome-research-consent-v1' or p_text is null or length(p_text) not between 100 and 2000 then raise exception 'invalid_outcome_consent';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
  w:=public.grader_ensure_workspace(p_user_id);
  insert into public.grader_outcome_research_consent(workspace_id) values(w) on conflict do nothing;
  select * into c from public.grader_outcome_research_consent where workspace_id=w for update;
  if c.revision<>p_revision then return '{"error":"revision_conflict"}'::jsonb;end if;
  if c.granted=p_granted then return public.grader_outcome_consent_json(p_user_id);end if;
  if p_granted and (select count(*) from public.grader_outcome_consent_events where workspace_id=w)>=1000 then return '{"error":"outcome_consent_limit"}'::jsonb;end if;
  update public.grader_outcome_research_consent set granted=p_granted,revision=revision+1,version=p_version,updated_at=clock_timestamp() where workspace_id=w;
  insert into public.grader_outcome_consent_events(workspace_id,granted,version,text) values(w,p_granted,p_version,p_text);
  return public.grader_outcome_consent_json(p_user_id);
end;
$$;

create function public.grader_export_outcomes(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select public.grader_read_outcomes(p_user_id)||jsonb_build_object('consentEvents',coalesce((select jsonb_agg(jsonb_build_object('granted',c.granted,'version',c.version,'text',c.text,'recordedAt',c.recorded_at) order by c.recorded_at) from public.grader_outcome_consent_events c join public.grader_workspaces w on w.id=c.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb),'changes',coalesce((select jsonb_agg(jsonb_build_object('periodId',e.period_id,'action',e.action,'revision',e.revision,'recordedAt',e.recorded_at) order by e.recorded_at) from public.grader_outcome_events e join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb));
$$;

do $$ declare n text;begin
  foreach n in array array['grader_outcome_periods','grader_outcome_research_consent','grader_outcome_consent_events','grader_outcome_events'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated',n);
    execute format('grant all on public.%I to service_role',n);
  end loop;
end $$;
revoke execute on function public.grader_outcome_period_json(uuid),public.grader_outcome_consent_json(uuid),public.grader_read_outcomes(uuid),public.grader_outcome_values_valid(jsonb,integer),public.grader_save_outcome(uuid,uuid,integer,date,date,text,text,uuid,jsonb),public.grader_delete_outcome(uuid,uuid,integer),public.grader_set_outcome_research_consent(uuid,integer,boolean,text,text),public.grader_export_outcomes(uuid) from public,anon,authenticated;
grant execute on function public.grader_outcome_period_json(uuid),public.grader_outcome_consent_json(uuid),public.grader_read_outcomes(uuid),public.grader_outcome_values_valid(jsonb,integer),public.grader_save_outcome(uuid,uuid,integer,date,date,text,text,uuid,jsonb),public.grader_delete_outcome(uuid,uuid,integer),public.grader_set_outcome_research_consent(uuid,integer,boolean,text,text),public.grader_export_outcomes(uuid) to service_role;
