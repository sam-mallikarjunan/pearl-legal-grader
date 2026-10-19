-- Fresh explicit requests must not deduplicate against expired contact permission.
-- Exact client-request-ID retries remain immutable, including older issued requests.
create or replace function public.grader_lead_request_routed_help(p_user_id uuid,p_request_id uuid,p_topic text,p_report_id uuid,p_consent_version text,p_consent_text text) returns jsonb
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
 select * into v_existing from public.grader_lead_requests where workspace_id=v_workspace and topic=p_topic and report_id is not distinct from p_report_id and consent_version='requested-pearl-help-v2' and consent_text='I am asking Pearl to contact me at my verified account email about the selected business need. Pearl may add that email and need to its private follow-up queue. If I select a report, I also share only its readiness score, evidence coverage and rubric version. My detailed answers, website and reported outcomes are not shared. This is separate from optional marketing and does not affect my grade. I can withdraw before follow-up; contact already in progress may continue.' and status in ('open','in_review') and contact_consent and created_at>=clock_timestamp()-interval '90 days' order by created_at desc limit 1;
 if found then return jsonb_build_object('created',false,'request',public.grader_lead_json(v_existing.id));end if;
 if (select count(*) from public.grader_lead_requests where workspace_id=v_workspace and created_at>clock_timestamp()-interval '24 hours')>=3 then return '{"error":"request_limit"}'::jsonb;end if;
 insert into public.grader_lead_requests(workspace_id,client_request_id,topic,consent_version,consent_text,report_id) values(v_workspace,p_request_id,p_topic,p_consent_version,p_consent_text,p_report_id) returning id into v_id;
 insert into public.grader_lead_events(request_id,actor_id,action,to_status,reason) values(v_id,p_user_id,'requested','open','The account owner explicitly requested purpose-bound Pearl follow-up in its private queue.');
 return jsonb_build_object('created',true,'request',public.grader_lead_json(v_id));
end;
$$;
