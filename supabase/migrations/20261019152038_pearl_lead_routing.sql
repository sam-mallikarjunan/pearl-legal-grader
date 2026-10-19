-- Private first-party requested-contact queue. No external CRM, dispatch worker or automatic messages.
-- Existing v1 RPC and requests are unchanged. The separate v2 RPC requires explicit exact new consent.
create table public.grader_requested_contact_views (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.grader_lead_requests(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 viewed_at timestamptz not null default clock_timestamp()
);
create index grader_requested_contact_views_request_time_idx on public.grader_requested_contact_views(request_id,viewed_at desc);
create index grader_requested_contact_views_actor_time_idx on public.grader_requested_contact_views(actor_id,viewed_at desc);
alter table public.grader_requested_contact_views enable row level security;
revoke all on public.grader_requested_contact_views from public,anon,authenticated;
grant select,insert,delete on public.grader_requested_contact_views to service_role;

create function public.grader_lead_request_routed_help(p_user_id uuid,p_request_id uuid,p_topic text,p_report_id uuid,p_consent_version text,p_consent_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid;v_existing public.grader_lead_requests%rowtype;v_id uuid;
begin
 if p_user_id is null or p_request_id is null or p_topic is null or p_topic not in ('intake','cash','workflow','growth','resilience','not_sure') or p_consent_version is distinct from 'requested-pearl-help-v2' or p_consent_text is distinct from 'I am asking Pearl to contact me at my verified account email about the selected business need. Pearl may add that email and need to its private follow-up queue. If I select a report, I also share only its readiness score, evidence coverage and rubric version. My detailed answers, website and reported outcomes are not shared. This is separate from optional marketing and does not affect my grade. I can withdraw before follow-up; contact already in progress may continue.' then raise exception 'invalid_help_request';end if;
 v_workspace:=public.grader_ensure_workspace(p_user_id);
 perform 1 from public.grader_workspaces where id=v_workspace for update;
 if p_report_id is not null and not exists(select 1 from public.grader_reports where id=p_report_id and workspace_id=v_workspace) then return '{"error":"not_found"}'::jsonb;end if;
 select * into v_existing from public.grader_lead_requests where workspace_id=v_workspace and client_request_id=p_request_id;
 if found then
  if v_existing.topic<>p_topic or v_existing.report_id is distinct from p_report_id then return '{"error":"request_conflict"}'::jsonb;end if;
  -- Never upgrade, backfill or renew an older record's contact permission.
  return jsonb_build_object('created',false,'request',public.grader_lead_json(v_existing.id));
 end if;
 select * into v_existing from public.grader_lead_requests where workspace_id=v_workspace and topic=p_topic and report_id is not distinct from p_report_id and consent_version='requested-pearl-help-v2' and consent_text='I am asking Pearl to contact me at my verified account email about the selected business need. Pearl may add that email and need to its private follow-up queue. If I select a report, I also share only its readiness score, evidence coverage and rubric version. My detailed answers, website and reported outcomes are not shared. This is separate from optional marketing and does not affect my grade. I can withdraw before follow-up; contact already in progress may continue.' and status in ('open','in_review') and contact_consent order by created_at desc limit 1;
 if found then return jsonb_build_object('created',false,'request',public.grader_lead_json(v_existing.id));end if;
 if (select count(*) from public.grader_lead_requests where workspace_id=v_workspace and created_at>clock_timestamp()-interval '24 hours')>=3 then return '{"error":"request_limit"}'::jsonb;end if;
 insert into public.grader_lead_requests(workspace_id,client_request_id,topic,consent_version,consent_text,report_id) values(v_workspace,p_request_id,p_topic,p_consent_version,p_consent_text,p_report_id) returning id into v_id;
 insert into public.grader_lead_events(request_id,actor_id,action,to_status,reason) values(v_id,p_user_id,'requested','open','The account owner explicitly requested purpose-bound Pearl follow-up in its private queue.');
 return jsonb_build_object('created',true,'request',public.grader_lead_json(v_id));
end;
$$;
create function public.grader_requested_contact_queue() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requests',coalesce((select jsonb_agg(payload order by created_at desc) from (
  select r.created_at,jsonb_build_object('id',r.id,'topic',r.topic,'status',r.status,'revision',r.revision,'createdAt',r.created_at,'updatedAt',r.updated_at,'contactConsent',r.contact_consent,'hasSelectedReport',r.report_id is not null,'canViewContact',r.contact_consent and r.status in ('open','in_review') and r.created_at>=clock_timestamp()-interval '90 days') payload
   from public.grader_lead_requests r where r.consent_version='requested-pearl-help-v2' and r.consent_text='I am asking Pearl to contact me at my verified account email about the selected business need. Pearl may add that email and need to its private follow-up queue. If I select a report, I also share only its readiness score, evidence coverage and rubric version. My detailed answers, website and reported outcomes are not shared. This is separate from optional marketing and does not affect my grade. I can withdraw before follow-up; contact already in progress may continue.' order by r.created_at desc limit 100
 ) q),'[]'::jsonb),'truncated',(select count(*)>100 from public.grader_lead_requests where consent_version='requested-pearl-help-v2' and consent_text='I am asking Pearl to contact me at my verified account email about the selected business need. Pearl may add that email and need to its private follow-up queue. If I select a report, I also share only its readiness score, evidence coverage and rubric version. My detailed answers, website and reported outcomes are not shared. This is separate from optional marketing and does not affect my grade. I can withdraw before follow-up; contact already in progress may continue.'));
$$;
create function public.grader_prepare_requested_contact(p_actor uuid,p_request_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.grader_lead_requests%rowtype;v_owner uuid;
begin
 if p_actor is null or p_request_id is null or p_revision is null or p_revision<0 then raise exception 'invalid_contact_view';end if;
 select * into r from public.grader_lead_requests where id=p_request_id for update;
 if not found then return '{"error":"not_found"}'::jsonb;end if;
 if r.revision<>p_revision or not r.contact_consent or r.status not in ('open','in_review') or r.consent_version<>'requested-pearl-help-v2' or r.consent_text<>'I am asking Pearl to contact me at my verified account email about the selected business need. Pearl may add that email and need to its private follow-up queue. If I select a report, I also share only its readiness score, evidence coverage and rubric version. My detailed answers, website and reported outcomes are not shared. This is separate from optional marketing and does not affect my grade. I can withdraw before follow-up; contact already in progress may continue.' or r.created_at<clock_timestamp()-interval '90 days' then return '{"error":"contact_permission_unavailable"}'::jsonb;end if;
 select owner_user_id into v_owner from public.grader_workspaces where id=r.workspace_id;
 return jsonb_build_object('requestId',r.id,'ownerUserId',v_owner,'topic',r.topic,'reportId',r.report_id,'revision',r.revision,'consentVersion',r.consent_version,'consentText',r.consent_text);
end;
$$;
create function public.grader_record_requested_contact_view(p_actor uuid,p_request_id uuid,p_revision integer,p_report_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.grader_lead_requests%rowtype;
begin
 if p_actor is null or p_request_id is null or p_revision is null or p_revision<0 then raise exception 'invalid_contact_view';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text,82989));
 select * into r from public.grader_lead_requests where id=p_request_id for update;
 if not found then return 'false'::jsonb;end if;
 if r.revision<>p_revision or not r.contact_consent or r.status not in ('open','in_review') or r.report_id is distinct from p_report_id or r.consent_version<>'requested-pearl-help-v2' or r.consent_text<>'I am asking Pearl to contact me at my verified account email about the selected business need. Pearl may add that email and need to its private follow-up queue. If I select a report, I also share only its readiness score, evidence coverage and rubric version. My detailed answers, website and reported outcomes are not shared. This is separate from optional marketing and does not affect my grade. I can withdraw before follow-up; contact already in progress may continue.' or r.created_at<clock_timestamp()-interval '90 days' then return 'false'::jsonb;end if;
 if (select count(*) from public.grader_requested_contact_views where actor_id=p_actor and viewed_at>clock_timestamp()-interval '1 hour')>=30 then return '{"error":"contact_view_limit"}'::jsonb;end if;
 insert into public.grader_requested_contact_views(request_id,actor_id) values(p_request_id,p_actor);
 return 'true'::jsonb;
end;
$$;
create function public.grader_requested_contact_export(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('contactViews',coalesce((select jsonb_agg(payload order by viewed_at desc) from (
  select v.viewed_at,jsonb_build_object('requestId',v.request_id,'viewedAt',v.viewed_at) payload from public.grader_requested_contact_views v join public.grader_lead_requests r on r.id=v.request_id join public.grader_workspaces w on w.id=r.workspace_id where w.owner_user_id=p_user_id order by v.viewed_at desc limit 1000
 ) q),'[]'::jsonb),'historyTruncated',(select count(*)>1000 from public.grader_requested_contact_views v join public.grader_lead_requests r on r.id=v.request_id join public.grader_workspaces w on w.id=r.workspace_id where w.owner_user_id=p_user_id));
$$;
create function public.grader_purge_requested_contact_views() returns boolean
language plpgsql security invoker set search_path='' as $$
begin delete from public.grader_requested_contact_views where viewed_at<clock_timestamp()-interval '30 days';return true;end;
$$;
revoke all on function public.grader_lead_request_routed_help(uuid,uuid,text,uuid,text,text),public.grader_requested_contact_queue(),public.grader_prepare_requested_contact(uuid,uuid,integer),public.grader_record_requested_contact_view(uuid,uuid,integer,uuid),public.grader_requested_contact_export(uuid),public.grader_purge_requested_contact_views() from public,anon,authenticated;
grant execute on function public.grader_lead_request_routed_help(uuid,uuid,text,uuid,text,text),public.grader_requested_contact_queue(),public.grader_prepare_requested_contact(uuid,uuid,integer),public.grader_record_requested_contact_view(uuid,uuid,integer,uuid),public.grader_requested_contact_export(uuid),public.grader_purge_requested_contact_views() to service_role;
