-- Private, one-owner account storage. Public clients have no table or RPC access.
-- Authentication is verified by the application before supplying p_user_id.
create table public.grader_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.grader_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  local_id uuid not null,
  practice_id uuid not null,
  baseline_local_id uuid,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 250000),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  saved_at timestamptz not null default now(),
  unique (workspace_id, local_id),
  check (snapshot->>'id' = local_id::text and snapshot->>'practiceId' = practice_id::text and snapshot->>'isSample' = 'false'),
  check (baseline_local_id is null or baseline_local_id <> local_id)
);
create index grader_reports_workspace_saved_idx on public.grader_reports(workspace_id, saved_at desc);
create table public.grader_action_progress (
  report_id uuid not null references public.grader_reports(id) on delete cascade,
  action_id text not null check (action_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  state text not null default 'todo' check (state in ('todo','in_progress','done','deferred','not_relevant')),
  revision integer not null default 0 check (revision >= 0),
  details jsonb check (details is null or (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 2500)),
  updated_at timestamptz not null default now(),
  primary key (report_id, action_id)
);
create table public.grader_preferences (
  workspace_id uuid primary key references public.grader_workspaces(id) on delete cascade,
  preference_values jsonb not null default '{"reminders":false,"marketing":false,"benchmarking":false,"leaderboard":false}'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  consent_version text not null default 'account-preferences-v1',
  updated_at timestamptz,
  check (jsonb_typeof(preference_values) = 'object' and jsonb_typeof(preference_values->'reminders') = 'boolean' and jsonb_typeof(preference_values->'marketing') = 'boolean' and jsonb_typeof(preference_values->'benchmarking') = 'boolean' and jsonb_typeof(preference_values->'leaderboard') = 'boolean')
);
create table public.grader_consent_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  preference text not null check (preference in ('reminders','marketing','benchmarking','leaderboard')),
  granted boolean not null,
  version text not null,
  text text not null check (length(text) between 1 and 1000),
  recorded_at timestamptz not null default now()
);
create index grader_consent_events_workspace_idx on public.grader_consent_events(workspace_id, recorded_at);

alter table public.grader_workspaces enable row level security;
alter table public.grader_reports enable row level security;
alter table public.grader_action_progress enable row level security;
alter table public.grader_preferences enable row level security;
alter table public.grader_consent_events enable row level security;
revoke all on public.grader_workspaces, public.grader_reports, public.grader_action_progress, public.grader_preferences, public.grader_consent_events from public, anon, authenticated;
grant all on public.grader_workspaces, public.grader_reports, public.grader_action_progress, public.grader_preferences, public.grader_consent_events to service_role;

create function public.grader_ensure_workspace(p_user_id uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if p_user_id is null then raise exception 'invalid_account'; end if;
  insert into public.grader_workspaces(owner_user_id) values (p_user_id)
    on conflict(owner_user_id) do nothing;
  select id into strict v_id from public.grader_workspaces where owner_user_id=p_user_id;
  insert into public.grader_preferences(workspace_id) values (v_id) on conflict do nothing;
  return v_id;
end;
$$;

create function public.grader_report_json(p_user_id uuid, p_report_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',r.id,'snapshot',r.snapshot,'savedAt',r.saved_at,'canonical',true,
    'actionProgress',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'actionId',a.action_id,'state',a.state,'revision',a.revision,'updatedAt',a.updated_at,'details',a.details
    )) order by a.action_id) from public.grader_action_progress a where a.report_id=r.id),'[]'::jsonb)
  ) from public.grader_reports r join public.grader_workspaces w on w.id=r.workspace_id
  where r.id=p_report_id and w.owner_user_id=p_user_id;
$$;

create function public.grader_list_reports(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(public.grader_report_json(p_user_id,r.id) order by r.saved_at desc),'[]'::jsonb)
  from public.grader_reports r join public.grader_workspaces w on w.id=r.workspace_id where w.owner_user_id=p_user_id;
$$;

create function public.grader_read_report(p_user_id uuid, p_report_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(public.grader_report_json(p_user_id,p_report_id),'{"error":"not_found"}'::jsonb);
$$;

create function public.grader_save_report(p_user_id uuid, p_snapshot jsonb, p_content_hash text, p_action_states jsonb, p_action_details jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_workspace uuid; v_local uuid; v_practice uuid; v_baseline uuid; v_existing public.grader_reports%rowtype;
  v_report uuid; v_action jsonb; v_action_id text; v_state text;
begin
  if p_user_id is null or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>250000
    or p_snapshot->>'isSample' is distinct from 'false' or p_content_hash is null or p_content_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_action_states) is distinct from 'object' or jsonb_typeof(p_action_details) is distinct from 'object'
    then raise exception 'invalid_report'; end if;
  v_local:=(p_snapshot->>'id')::uuid; v_practice:=(p_snapshot->>'practiceId')::uuid;
  v_baseline:=(p_snapshot->>'baselineId')::uuid;
  if v_local is null or v_practice is null or v_baseline=v_local then raise exception 'invalid_report'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82981));
  v_workspace:=public.grader_ensure_workspace(p_user_id);
  select * into v_existing from public.grader_reports where workspace_id=v_workspace and local_id=v_local;
  if found then
    if v_existing.content_hash<>p_content_hash or v_existing.snapshot<>p_snapshot then return '{"error":"report_conflict"}'::jsonb; end if;
    return jsonb_build_object('created',false,'report',public.grader_report_json(p_user_id,v_existing.id));
  end if;
  if (select count(*) from public.grader_reports where workspace_id=v_workspace)>=40 then return '{"error":"report_limit"}'::jsonb; end if;
  if (select coalesce(sum(octet_length(snapshot::text)),0) from public.grader_reports where workspace_id=v_workspace)+octet_length(p_snapshot::text)>4000000 then return '{"error":"storage_limit"}'::jsonb; end if;
  if exists(select 1 from public.grader_reports where workspace_id=v_workspace and local_id=v_baseline and practice_id<>v_practice)
    then return '{"error":"invalid_baseline"}'::jsonb; end if;
  if exists(select 1 from jsonb_object_keys(p_action_states) as keys(key) where not exists(select 1 from jsonb_array_elements(p_snapshot->'assessment'->'actions') as issued(action) where action->>'id'=keys.key))
    or exists(select 1 from jsonb_object_keys(p_action_details) as keys(key) where not exists(select 1 from jsonb_array_elements(p_snapshot->'assessment'->'actions') as issued(action) where action->>'id'=keys.key))
    then return '{"error":"invalid_action"}'::jsonb; end if;
  insert into public.grader_reports(workspace_id,local_id,practice_id,baseline_local_id,snapshot,content_hash)
    values(v_workspace,v_local,v_practice,v_baseline,p_snapshot,p_content_hash) returning id into v_report;
  for v_action in select value from jsonb_array_elements(p_snapshot->'assessment'->'actions') loop
    v_action_id:=v_action->>'id'; v_state:=coalesce(p_action_states->>v_action_id,'todo');
    insert into public.grader_action_progress(report_id,action_id,state,details)
      values(v_report,v_action_id,v_state,p_action_details->v_action_id);
  end loop;
  return jsonb_build_object('created',true,'report',public.grader_report_json(p_user_id,v_report));
end;
$$;

create function public.grader_delete_report(p_user_id uuid, p_report_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  delete from public.grader_reports r using public.grader_workspaces w
    where r.workspace_id=w.id and w.owner_user_id=p_user_id and r.id=p_report_id;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;

create function public.grader_update_action(p_user_id uuid, p_report_id uuid, p_action_id text, p_state text, p_revision integer, p_details jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_progress public.grader_action_progress%rowtype;
begin
  if p_state not in ('todo','in_progress','done','deferred','not_relevant') or p_revision<0 or p_revision is null then raise exception 'invalid_action'; end if;
  if not exists(select 1 from public.grader_reports r join public.grader_workspaces w on w.id=r.workspace_id where r.id=p_report_id and w.owner_user_id=p_user_id) then return '{"error":"not_found"}'::jsonb; end if;
  select * into v_progress from public.grader_action_progress where report_id=p_report_id and action_id=p_action_id for update;
  if not found then return '{"error":"invalid_action"}'::jsonb; end if;
  if v_progress.revision<>p_revision then return '{"error":"revision_conflict"}'::jsonb; end if;
  update public.grader_action_progress set state=p_state,revision=revision+1,details=p_details,updated_at=now()
    where report_id=p_report_id and action_id=p_action_id returning * into v_progress;
  return jsonb_strip_nulls(jsonb_build_object('actionId',v_progress.action_id,'state',v_progress.state,'revision',v_progress.revision,'updatedAt',v_progress.updated_at,'details',v_progress.details));
end;
$$;

create function public.grader_read_preferences(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce((select jsonb_build_object('values',p.preference_values,'revision',p.revision,'updatedAt',p.updated_at,'consentVersion',p.consent_version)
    from public.grader_preferences p join public.grader_workspaces w on w.id=p.workspace_id where w.owner_user_id=p_user_id),
    '{"values":{"reminders":false,"marketing":false,"benchmarking":false,"leaderboard":false},"revision":0,"updatedAt":null,"consentVersion":"account-preferences-v1"}'::jsonb);
$$;

create function public.grader_update_preferences(p_user_id uuid, p_revision integer, p_values jsonb, p_consent_version text, p_consent_text jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_workspace uuid; v_preferences public.grader_preferences%rowtype; v_key text; v_count integer;
begin
  if p_revision is null or p_revision<0 or p_consent_version is distinct from 'account-preferences-v1'
    or jsonb_typeof(p_values) is distinct from 'object' or jsonb_typeof(p_consent_text) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_values))<>4 then raise exception 'invalid_preferences'; end if;
  foreach v_key in array array['reminders','marketing','benchmarking','leaderboard'] loop
    if jsonb_typeof(p_values->v_key) is distinct from 'boolean' or jsonb_typeof(p_consent_text->v_key) is distinct from 'string' or length(p_consent_text->>v_key) not between 1 and 1000 then raise exception 'invalid_preferences'; end if;
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82981));
  v_workspace:=public.grader_ensure_workspace(p_user_id);
  select * into v_preferences from public.grader_preferences where workspace_id=v_workspace for update;
  if v_preferences.revision<>p_revision then return '{"error":"revision_conflict"}'::jsonb; end if;
  select count(*) into v_count from public.grader_consent_events where workspace_id=v_workspace;
  if v_count+4>1000 then return '{"error":"preference_limit"}'::jsonb; end if;
  foreach v_key in array array['reminders','marketing','benchmarking','leaderboard'] loop
    if v_preferences.preference_values->v_key is distinct from p_values->v_key then
      insert into public.grader_consent_events(workspace_id,preference,granted,version,text)
        values(v_workspace,v_key,(p_values->>v_key)::boolean,p_consent_version,p_consent_text->>v_key);
    end if;
  end loop;
  update public.grader_preferences set preference_values=p_values,revision=revision+1,consent_version=p_consent_version,updated_at=now() where workspace_id=v_workspace;
  return public.grader_read_preferences(p_user_id);
end;
$$;

create function public.grader_export_account(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('reports',public.grader_list_reports(p_user_id),'preferences',public.grader_read_preferences(p_user_id),
    'consentEvents',coalesce((select jsonb_agg(jsonb_build_object('preference',e.preference,'granted',e.granted,'version',e.version,'text',e.text,'recordedAt',e.recorded_at) order by e.recorded_at,e.id)
      from public.grader_consent_events e join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb));
$$;

create function public.grader_delete_workspace(p_user_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.grader_workspaces where owner_user_id=p_user_id;
  return true;
end;
$$;

revoke execute on function public.grader_ensure_workspace(uuid), public.grader_report_json(uuid,uuid), public.grader_list_reports(uuid), public.grader_read_report(uuid,uuid), public.grader_save_report(uuid,jsonb,text,jsonb,jsonb), public.grader_delete_report(uuid,uuid), public.grader_update_action(uuid,uuid,text,text,integer,jsonb), public.grader_read_preferences(uuid), public.grader_update_preferences(uuid,integer,jsonb,text,jsonb), public.grader_export_account(uuid), public.grader_delete_workspace(uuid) from public,anon,authenticated;
grant execute on function public.grader_ensure_workspace(uuid), public.grader_report_json(uuid,uuid), public.grader_list_reports(uuid), public.grader_read_report(uuid,uuid), public.grader_save_report(uuid,jsonb,text,jsonb,jsonb), public.grader_delete_report(uuid,uuid), public.grader_update_action(uuid,uuid,text,text,integer,jsonb), public.grader_read_preferences(uuid), public.grader_update_preferences(uuid,integer,jsonb,text,jsonb), public.grader_export_account(uuid), public.grader_delete_workspace(uuid) to service_role;
