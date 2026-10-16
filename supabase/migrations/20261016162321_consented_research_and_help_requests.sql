-- Dynamic consented research inputs and explicit requested-help records.
-- No public rankings, CRM writes, messages, or automatic marketing enrollment.
create table public.grader_lead_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  client_request_id uuid not null,
  topic text not null check (topic in ('intake','cash','workflow','growth','resilience','not_sure')),
  status text not null default 'open' check (status in ('open','in_review','contacted','closed','withdrawn')),
  contact_consent boolean not null default true,
  consent_version text not null check (length(consent_version) between 1 and 100),
  consent_text text not null check (length(consent_text) between 20 and 1000),
  report_id uuid references public.grader_reports(id) on delete set null,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,client_request_id),
  check (status <> 'withdrawn' or not contact_consent)
);
create index grader_lead_requests_workspace_created_idx on public.grader_lead_requests(workspace_id,created_at desc);
create index grader_lead_requests_report_idx on public.grader_lead_requests(report_id);
create index grader_lead_requests_status_created_idx on public.grader_lead_requests(status,created_at desc);
create table public.grader_lead_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.grader_lead_requests(id) on delete cascade,
  actor_id uuid not null,
  action text not null check (action in ('requested','status_changed','withdrawn')),
  from_status text,
  to_status text not null,
  reason text not null check (length(reason) between 10 and 500),
  created_at timestamptz not null default clock_timestamp()
);
create index grader_lead_events_request_idx on public.grader_lead_events(request_id,created_at);
create table public.grader_research_export_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  purpose text not null check (purpose in ('research','requested_help','marketing')),
  policy_version text not null,
  release_id text,
  row_count integer not null check (row_count between 0 and 10000),
  created_at timestamptz not null default clock_timestamp()
);
create index grader_research_export_events_actor_idx on public.grader_research_export_events(actor_id);
alter table public.grader_lead_requests enable row level security;
alter table public.grader_lead_events enable row level security;
alter table public.grader_research_export_events enable row level security;
revoke all on public.grader_lead_requests,public.grader_lead_events,public.grader_research_export_events from public,anon,authenticated;
grant select,insert,update,delete on public.grader_lead_requests to service_role;
grant select,insert,delete on public.grader_lead_events to service_role;
grant select,insert on public.grader_research_export_events to service_role;

create function public.grader_lead_json(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',r.id,'topic',r.topic,'status',r.status,'createdAt',r.created_at,'updatedAt',r.updated_at,'consentVersion',r.consent_version,'consentText',r.consent_text,'contactConsent',r.contact_consent,'reportId',r.report_id,'revision',r.revision)
    from public.grader_lead_requests r where r.id=p_id;
$$;
create function public.grader_lead_request_help(p_user_id uuid,p_request_id uuid,p_topic text,p_report_id uuid,p_consent_version text,p_consent_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid; v_existing public.grader_lead_requests%rowtype; v_id uuid;
begin
  if p_user_id is null or p_request_id is null or p_topic is null or p_topic not in ('intake','cash','workflow','growth','resilience','not_sure') or p_consent_version is distinct from 'requested-pearl-help-v1' or p_consent_text is null or length(p_consent_text) not between 20 and 1000 then raise exception 'invalid_help_request'; end if;
  v_workspace:=public.grader_ensure_workspace(p_user_id);
  perform 1 from public.grader_workspaces where id=v_workspace for update;
  if p_report_id is not null and not exists(select 1 from public.grader_reports where id=p_report_id and workspace_id=v_workspace) then return '{"error":"not_found"}'::jsonb; end if;
  select * into v_existing from public.grader_lead_requests where workspace_id=v_workspace and client_request_id=p_request_id;
  if found then
    if v_existing.topic<>p_topic or v_existing.report_id is distinct from p_report_id then return '{"error":"request_conflict"}'::jsonb; end if;
    return jsonb_build_object('created',false,'request',public.grader_lead_json(v_existing.id));
  end if;
  select * into v_existing from public.grader_lead_requests where workspace_id=v_workspace and topic=p_topic and status in ('open','in_review') and contact_consent order by created_at desc limit 1;
  if found then return jsonb_build_object('created',false,'request',public.grader_lead_json(v_existing.id)); end if;
  if (select count(*) from public.grader_lead_requests where workspace_id=v_workspace and created_at>clock_timestamp()-interval '24 hours')>=3 then return '{"error":"request_limit"}'::jsonb; end if;
  insert into public.grader_lead_requests(workspace_id,client_request_id,topic,consent_version,consent_text,report_id)
    values(v_workspace,p_request_id,p_topic,p_consent_version,p_consent_text,p_report_id) returning id into v_id;
  insert into public.grader_lead_events(request_id,actor_id,action,to_status,reason) values(v_id,p_user_id,'requested','open','The account owner explicitly requested Pearl follow-up.');
  return jsonb_build_object('created',true,'request',public.grader_lead_json(v_id));
end;
$$;
create function public.grader_lead_list_own(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(public.grader_lead_json(r.id) order by r.created_at desc),'[]'::jsonb) from public.grader_lead_requests r join public.grader_workspaces w on w.id=r.workspace_id where w.owner_user_id=p_user_id;
$$;
create function public.grader_lead_withdraw(p_user_id uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_row public.grader_lead_requests%rowtype;
begin
  select r.* into v_row from public.grader_lead_requests r join public.grader_workspaces w on w.id=r.workspace_id where r.id=p_id and w.owner_user_id=p_user_id for update of r;
  if not found then return '{"error":"not_found"}'::jsonb; end if;
  if v_row.status='withdrawn' then return public.grader_lead_json(p_id); end if;
  update public.grader_lead_requests set status='withdrawn',contact_consent=false,revision=revision+1,updated_at=clock_timestamp() where id=p_id;
  insert into public.grader_lead_events(request_id,actor_id,action,from_status,to_status,reason) values(p_id,p_user_id,'withdrawn',v_row.status,'withdrawn','The account owner withdrew permission for requested-help follow-up.');
  return public.grader_lead_json(p_id);
end;
$$;
create function public.grader_lead_update_status(p_id uuid,p_status text,p_revision integer,p_actor uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_row public.grader_lead_requests%rowtype;
begin
  if p_actor is null or p_status is null or p_status not in ('open','in_review','contacted','closed','withdrawn') or p_revision is null or p_reason is null or length(btrim(p_reason)) not between 10 and 500 then raise exception 'invalid_lead_change'; end if;
  select * into v_row from public.grader_lead_requests where id=p_id for update;
  if not found then return '{"error":"not_found"}'::jsonb; end if;
  if v_row.revision<>p_revision then return '{"error":"revision_conflict"}'::jsonb; end if;
  if not v_row.contact_consent and p_status<>'withdrawn' then return '{"error":"consent_withdrawn"}'::jsonb; end if;
  update public.grader_lead_requests set status=p_status,contact_consent=case when p_status='withdrawn' then false else contact_consent end,revision=revision+1,updated_at=clock_timestamp() where id=p_id;
  insert into public.grader_lead_events(request_id,actor_id,action,from_status,to_status,reason) values(p_id,p_actor,'status_changed',v_row.status,p_status,btrim(p_reason));
  return public.grader_lead_json(p_id);
end;
$$;
create function public.grader_lead_admin_list() returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(r.payload order by r.created_at desc),'[]'::jsonb) from (
    select public.grader_lead_json(l.id)||jsonb_build_object('verifiedEmail',null) payload,l.created_at
      from public.grader_lead_requests l order by l.created_at desc limit 500
  ) r;
$$;
create function public.grader_lead_export(p_purpose text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_purpose='requested_help' then
    return (select coalesce(jsonb_agg(jsonb_build_object('ownerUserId',w.owner_user_id,'purpose','requested_help','topic',l.topic,'status',l.status,'consentVersion',l.consent_version,'consentRecordedAt',l.created_at) order by l.created_at desc),'[]'::jsonb)
      from public.grader_lead_requests l join public.grader_workspaces w on w.id=l.workspace_id
      where l.contact_consent and l.status in ('open','in_review') and l.created_at>=clock_timestamp()-interval '90 days');
  elsif p_purpose='marketing' then
    return (select coalesce(jsonb_agg(jsonb_build_object('ownerUserId',w.owner_user_id,'purpose','marketing','topic',null,'status','opted_in','consentVersion',p.consent_version,'consentRecordedAt',p.updated_at) order by p.updated_at desc),'[]'::jsonb)
      from public.grader_preferences p join public.grader_workspaces w on w.id=p.workspace_id
      where p.preference_values->'marketing'='true'::jsonb);
  end if;
  raise exception 'invalid_export_purpose';
end;
$$;

create function public.grader_research_source_page(p_release_id text,p_after uuid default null,p_limit integer default 10) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and 10 then raise exception 'invalid_research_page'; end if;
  with latest as (
    select distinct on (w.id) w.id workspace_id,r.id report_id,r.snapshot
      from public.grader_workspaces w join public.grader_preferences p on p.workspace_id=w.id join public.grader_reports r on r.workspace_id=w.id join public.grader_config_releases c on c.id=p_release_id
      where p.preference_values->'benchmarking'='true'::jsonb and (p_after is null or w.id>p_after)
        and r.snapshot#>>'{assessment,releaseId}'=p_release_id and r.snapshot#>'{assessment,releaseSnapshot}'=c.snapshot
        and r.snapshot->>'isSample'='false' and jsonb_typeof(r.snapshot#>'{assessment,overallScore}')='number'
        and case when jsonb_typeof(r.snapshot#>'{assessment,coverage}')='number' then (r.snapshot#>>'{assessment,coverage}')::numeric>=0.8 else false end
        and r.snapshot->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
        and r.snapshot->>'createdAt'>=to_char((clock_timestamp()-interval '90 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      order by w.id,r.snapshot->>'createdAt' desc,r.saved_at desc
  ), page as (select * from latest order by workspace_id limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('workspaceId',page.workspace_id,'benchmarking',true,'report',page.snapshot,'progress',coalesce((select jsonb_agg(jsonb_build_object('actionId',a.action_id,'details',a.details)) from public.grader_action_progress a where a.report_id=page.report_id),'[]'::jsonb)) order by page.workspace_id),'[]'::jsonb) into v_rows from page;
  return v_rows;
end;
$$;
create function public.grader_research_counts() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('workspaces',(select count(*) from public.grader_workspaces),'benchmarkingConsent',(select count(*) from public.grader_preferences where preference_values->'benchmarking'='true'::jsonb),'marketingConsent',(select count(*) from public.grader_preferences where preference_values->'marketing'='true'::jsonb),'helpRequestsByStatus',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.grader_lead_requests group by status) s),'{}'::jsonb));
$$;
create function public.grader_research_current_consent(p_workspace_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_workspace_ids is null or cardinality(p_workspace_ids)>500 then raise exception 'invalid_research_consent_check'; end if;
  return (select coalesce(jsonb_agg(workspace_id),'[]'::jsonb) from public.grader_preferences where workspace_id=any(p_workspace_ids) and preference_values->'benchmarking'='true'::jsonb);
end;
$$;
create function public.grader_research_record_export(p_actor uuid,p_purpose text,p_release_id text,p_rows integer) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if p_actor is null or p_purpose is null or p_purpose not in ('research','requested_help','marketing') or p_rows is null or p_rows not between 0 and 10000 then raise exception 'invalid_research_export'; end if;
  insert into public.grader_research_export_events(actor_id,purpose,policy_version,release_id,row_count) values(p_actor,p_purpose,'consented-workspace-research-v1',p_release_id,p_rows);
  return true;
end;
$$;
revoke all on function public.grader_lead_json(uuid),public.grader_lead_request_help(uuid,uuid,text,uuid,text,text),public.grader_lead_list_own(uuid),public.grader_lead_withdraw(uuid,uuid),public.grader_lead_update_status(uuid,text,integer,uuid,text),public.grader_lead_admin_list(),public.grader_lead_export(text),public.grader_research_source_page(text,uuid,integer),public.grader_research_counts(),public.grader_research_current_consent(uuid[]),public.grader_research_record_export(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.grader_lead_json(uuid),public.grader_lead_request_help(uuid,uuid,text,uuid,text,text),public.grader_lead_list_own(uuid),public.grader_lead_withdraw(uuid,uuid),public.grader_lead_update_status(uuid,text,integer,uuid,text),public.grader_lead_admin_list(),public.grader_lead_export(text),public.grader_research_source_page(text,uuid,integer),public.grader_research_counts(),public.grader_research_current_consent(uuid[]),public.grader_research_record_export(uuid,text,text,integer) to service_role;
