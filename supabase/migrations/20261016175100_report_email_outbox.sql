-- Requested transactional summaries only. No anonymous access or arbitrary-recipient API.
create table public.grader_report_email_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  report_id uuid not null references public.grader_reports(id) on delete cascade,
  request_id uuid not null,
  recipient_email text not null check(length(recipient_email) between 3 and 254),
  recipient_hash text not null check(recipient_hash ~ '^[a-f0-9]{64}$'),
  template_version text not null,
  message jsonb not null check(jsonb_typeof(message)='object' and octet_length(message::text)<=50000),
  status text not null default 'queued' check(status in ('queued','sending','accepted','delivered','bounced','complained','failed','unavailable')),
  attempts integer not null default 0 check(attempts between 0 and 4),
  revision integer not null default 0 check(revision>=0),
  lease_id text,
  lease_until timestamptz,
  workflow_run_id text,
  next_attempt_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retry_deadline timestamptz not null default now()+interval '1 hour',
  expires_at timestamptz not null default now()+interval '30 days',
  provider_message_id uuid,
  delivery_event text,
  delivery_event_at timestamptz,
  error_code text check(error_code is null or error_code in ('provider_rejected','retry_exhausted','queue_unavailable','configuration_unavailable','recipient_changed','recipient_suppressed','expired')),
  unique(workspace_id,request_id)
);
create index grader_report_email_owner_time_idx on public.grader_report_email_outbox(workspace_id,requested_at desc);
create index grader_report_email_report_idx on public.grader_report_email_outbox(report_id,requested_at desc);
create table public.grader_report_email_usage (
  bucket text primary key check(bucket ~ '^(day:[0-9]{4}-[0-9]{2}-[0-9]{2}|month:[0-9]{4}-[0-9]{2})$'),
  count integer not null default 0 check(count>=0)
);
create table public.grader_report_email_requests (
  account_hash text not null check(account_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid not null,
  requested_at timestamptz not null default now(),
  primary key(account_hash,request_id)
);
create index grader_report_email_requests_time_idx on public.grader_report_email_requests(requested_at);
create table public.grader_report_email_events (
  event_id text primary key check(length(event_id) between 1 and 200),
  outbox_id uuid not null references public.grader_report_email_outbox(id) on delete cascade,
  provider_message_id uuid not null,
  event_type text not null check(event_type in ('email.delivered','email.bounced','email.complained','email.failed','email.delivery_delayed','email.suppressed')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index grader_report_email_events_outbox_idx on public.grader_report_email_events(outbox_id);
create table public.grader_report_email_suppression (
  recipient_hash text primary key check(recipient_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check(reason in ('bounced','complained')),
  expires_at timestamptz not null default now()+interval '30 days'
);
alter table public.grader_report_email_events enable row level security;
alter table public.grader_report_email_suppression enable row level security;
alter table public.grader_report_email_requests enable row level security;
alter table public.grader_report_email_outbox enable row level security;
alter table public.grader_report_email_usage enable row level security;
revoke all on public.grader_report_email_outbox,public.grader_report_email_usage,public.grader_report_email_requests,public.grader_report_email_events,public.grader_report_email_suppression from public,anon,authenticated;
grant all on public.grader_report_email_outbox,public.grader_report_email_usage,public.grader_report_email_requests,public.grader_report_email_events,public.grader_report_email_suppression to service_role;

create function public.grader_report_email_json(p_outbox_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_strip_nulls(jsonb_build_object('id',id,'status',status,'requestedAt',requested_at,'updatedAt',updated_at,'errorCode',error_code,'deliveryEvent',delivery_event))
  from public.grader_report_email_outbox where id=p_outbox_id;
$$;

create function public.grader_reserve_report_email(p_user_id uuid,p_report_id uuid,p_request_id uuid,p_recipient text,p_template_version text,p_message jsonb,p_account_hash text,p_recipient_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid;v_row public.grader_report_email_outbox%rowtype;v_day text;v_month text;v_id uuid;
begin
  if p_user_id is null or p_report_id is null or p_request_id is null or p_account_hash is null or p_account_hash !~ '^[a-f0-9]{64}$' or p_recipient_hash is null or p_recipient_hash !~ '^[a-f0-9]{64}$' or p_template_version is distinct from 'report-summary-v1'
    or jsonb_typeof(p_message) is distinct from 'object' or octet_length(p_message::text)>50000
    or p_message->'to' is distinct from jsonb_build_array(p_recipient)
    then raise exception 'invalid_email_request';end if;
  select w.id into v_workspace from public.grader_workspaces w join public.grader_reports r on r.workspace_id=w.id where w.owner_user_id=p_user_id and r.id=p_report_id;
  if v_workspace is null then return '{"error":"not_found"}'::jsonb;end if;
  if p_recipient is null or length(p_recipient) not between 3 and 254 then raise exception 'invalid_email_recipient';end if;
  perform pg_catalog.pg_advisory_xact_lock(82982);
  if exists(select 1 from public.grader_report_email_suppression where recipient_hash=p_recipient_hash and expires_at>now()) then return '{"error":"email_suppressed"}'::jsonb;end if;
  select * into v_row from public.grader_report_email_outbox where workspace_id=v_workspace and request_id=p_request_id;
  if found then
    if v_row.report_id<>p_report_id then return '{"error":"email_request_conflict"}'::jsonb;end if;
    return jsonb_build_object('email',public.grader_report_email_json(v_row.id),'start',v_row.status='queued' and v_row.workflow_run_id is null,'created',false);
  end if;
  select * into v_row from public.grader_report_email_outbox where workspace_id=v_workspace and report_id=p_report_id and status in ('queued','sending','accepted','delivered') and requested_at>now()-interval '5 minutes' order by requested_at desc limit 1;
  if found then return jsonb_build_object('email',public.grader_report_email_json(v_row.id),'start',v_row.status='queued' and v_row.workflow_run_id is null,'created',false);end if;
  if exists(select 1 from public.grader_report_email_requests where account_hash=p_account_hash and request_id=p_request_id) then return '{"error":"email_request_conflict"}'::jsonb;end if;
  if (select count(*) from public.grader_report_email_requests where account_hash=p_account_hash and requested_at>now()-interval '1 hour')>=3 or (select count(*) from public.grader_report_email_requests where account_hash=p_account_hash and requested_at>now()-interval '24 hours')>=10 then return '{"error":"email_account_limit"}'::jsonb;end if;
  v_day:='day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD');v_month:='month:'||to_char(now() at time zone 'UTC','YYYY-MM');
  if coalesce((select count from public.grader_report_email_usage where bucket=v_day),0)>=100 or coalesce((select count from public.grader_report_email_usage where bucket=v_month),0)>=1000 then return '{"error":"email_global_limit"}'::jsonb;end if;
  v_id:=gen_random_uuid();
  p_message:=jsonb_set(p_message,'{tags}',jsonb_build_array(jsonb_build_object('name','pearl_grader_report','value',v_id::text)));
  insert into public.grader_report_email_outbox(id,workspace_id,report_id,request_id,recipient_email,recipient_hash,template_version,message)
    values(v_id,v_workspace,p_report_id,p_request_id,lower(p_recipient),p_recipient_hash,p_template_version,p_message);
  insert into public.grader_report_email_requests(account_hash,request_id) values(p_account_hash,p_request_id);
  insert into public.grader_report_email_usage(bucket,count) values(v_day,1),(v_month,1) on conflict(bucket) do update set count=public.grader_report_email_usage.count+1;
  return jsonb_build_object('email',public.grader_report_email_json(v_id),'start',true,'created',true);
end;
$$;

create function public.grader_list_report_emails(p_user_id uuid,p_report_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when exists(select 1 from public.grader_reports r join public.grader_workspaces w on w.id=r.workspace_id where r.id=p_report_id and w.owner_user_id=p_user_id)
    then coalesce((select jsonb_agg(public.grader_report_email_json(id) order by requested_at desc) from (select e.id,e.requested_at from public.grader_report_email_outbox e join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id and e.report_id=p_report_id order by e.requested_at desc limit 10) recent),'[]'::jsonb)
    else '{"error":"not_found"}'::jsonb end;
$$;

create function public.grader_record_report_email_workflow(p_outbox_id uuid,p_run_id text) returns void
language sql security invoker set search_path='' as $$
  update public.grader_report_email_outbox set workflow_run_id=coalesce(workflow_run_id,p_run_id) where id=p_outbox_id and status='queued';
$$;

create function public.grader_claim_report_email(p_outbox_id uuid,p_lease_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_row public.grader_report_email_outbox%rowtype;v_owner uuid;
begin
  if p_outbox_id is null or p_lease_id is null or length(p_lease_id) not between 1 and 200 then raise exception 'invalid_email_claim';end if;
  select * into v_row from public.grader_report_email_outbox where id=p_outbox_id for update;
  if not found or v_row.status not in ('queued','sending') then return null;end if;
  if exists(select 1 from public.grader_report_email_suppression where recipient_hash=v_row.recipient_hash and expires_at>now()) then
    update public.grader_report_email_outbox set status='unavailable',error_code='recipient_suppressed',message='{}'::jsonb,updated_at=now(),lease_id=null,lease_until=null where id=p_outbox_id;return null;
  end if;
  if v_row.retry_deadline<=now() or v_row.expires_at<=now() or v_row.attempts>=4 then
    update public.grader_report_email_outbox set status='unavailable',error_code='expired',message='{}'::jsonb,updated_at=now(),lease_id=null,lease_until=null where id=p_outbox_id;return null;
  end if;
  if v_row.next_attempt_at>now() or (v_row.status='sending' and v_row.lease_until>now() and v_row.lease_id<>p_lease_id) then return null;end if;
  select owner_user_id into v_owner from public.grader_workspaces where id=v_row.workspace_id;
  update public.grader_report_email_outbox set status='sending',attempts=attempts+1,revision=revision+1,lease_id=p_lease_id,lease_until=now()+interval '2 minutes',updated_at=now() where id=p_outbox_id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'revision',v_row.revision,'attempt',v_row.attempts,'message',v_row.message,'ownerUserId',v_owner,'recipientEmail',v_row.recipient_email);
end;
$$;

create function public.grader_finish_report_email(p_outbox_id uuid,p_lease_id text,p_revision integer,p_status text,p_provider_id uuid,p_error_code text,p_retry_seconds integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_row public.grader_report_email_outbox%rowtype;
begin
  if p_status not in ('queued','accepted','failed','unavailable') or p_retry_seconds not between 0 and 300 then raise exception 'invalid_email_transition';end if;
  select * into v_row from public.grader_report_email_outbox where id=p_outbox_id and status='sending' and lease_id=p_lease_id and revision=p_revision for update;
  if not found then return false;end if;
  if p_status='accepted' and p_provider_id is null then raise exception 'invalid_email_acceptance';end if;
  if p_status='queued' and (v_row.attempts>=4 or v_row.retry_deadline<=now()+make_interval(secs=>p_retry_seconds)) then p_status:='failed';p_error_code:='retry_exhausted';end if;
  update public.grader_report_email_outbox set status=p_status,provider_message_id=case when p_status='accepted' then p_provider_id else provider_message_id end,error_code=p_error_code,next_attempt_at=now()+make_interval(secs=>p_retry_seconds),lease_id=null,lease_until=null,updated_at=now(),message=case when p_status in ('accepted','failed','unavailable') then '{}'::jsonb else message end where id=p_outbox_id;
  return true;
end;
$$;

create function public.grader_fail_report_email_queue(p_outbox_id uuid) returns void
language sql security invoker set search_path='' as $$
  update public.grader_report_email_outbox set status='unavailable',error_code='queue_unavailable',message='{}'::jsonb,updated_at=now() where id=p_outbox_id and status='queued' and workflow_run_id is null;
$$;

create function public.grader_abort_report_email(p_outbox_id uuid,p_lease_id text) returns void
language sql security invoker set search_path='' as $$
  update public.grader_report_email_outbox set status='unavailable',error_code='retry_exhausted',message='{}'::jsonb,lease_id=null,lease_until=null,updated_at=now()
    where id=p_outbox_id and ((status='sending' and lease_id=p_lease_id) or status='queued');
$$;

create function public.grader_record_report_email_event(p_event_id text,p_outbox_id uuid,p_provider_id uuid,p_event_type text,p_occurred_at timestamptz,p_recipient_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_row public.grader_report_email_outbox%rowtype;v_next text;v_priority integer;v_current integer;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 200 or p_provider_id is null or p_event_type not in ('email.delivered','email.bounced','email.complained','email.failed','email.delivery_delayed','email.suppressed') or p_occurred_at is null or p_occurred_at>now()+interval '5 minutes' then raise exception 'invalid_email_event';end if;
  select * into v_row from public.grader_report_email_outbox where id=p_outbox_id for update;
  if not found or v_row.expires_at<=now() or v_row.recipient_hash is distinct from p_recipient_hash or (v_row.provider_message_id is not null and v_row.provider_message_id<>p_provider_id) or p_occurred_at<v_row.requested_at-interval '5 minutes' then return false;end if;
  insert into public.grader_report_email_events(event_id,outbox_id,provider_message_id,event_type,occurred_at) values(p_event_id,p_outbox_id,p_provider_id,p_event_type,p_occurred_at) on conflict(event_id) do nothing;
  if not found then return false;end if;
  v_next:=case p_event_type when 'email.complained' then 'complained' when 'email.bounced' then 'bounced' when 'email.suppressed' then 'bounced' when 'email.delivered' then 'delivered' when 'email.failed' then 'failed' else 'accepted' end;
  v_priority:=case v_next when 'complained' then 100 when 'bounced' then 90 when 'delivered' then 80 when 'failed' then 50 else 40 end;
  v_current:=case v_row.status when 'complained' then 100 when 'bounced' then 90 when 'delivered' then 80 when 'failed' then 50 when 'accepted' then 40 else 0 end;
  if v_next in ('bounced','complained') then
    insert into public.grader_report_email_suppression(recipient_hash,reason,expires_at) values(v_row.recipient_hash,v_next,now()+interval '30 days') on conflict(recipient_hash) do update set reason=case when public.grader_report_email_suppression.reason='complained' then 'complained' else excluded.reason end,expires_at=greatest(public.grader_report_email_suppression.expires_at,excluded.expires_at);
  end if;
  if v_priority>v_current or (v_priority=v_current and (v_row.delivery_event_at is null or p_occurred_at>=v_row.delivery_event_at)) then
    update public.grader_report_email_outbox set status=v_next,provider_message_id=p_provider_id,delivery_event=p_event_type,delivery_event_at=p_occurred_at,updated_at=now(),message='{}'::jsonb,lease_id=null,lease_until=null,error_code=null where id=p_outbox_id;
  end if;
  return true;
end;
$$;

create function public.grader_export_report_emails(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(public.grader_report_email_json(e.id)||jsonb_build_object('reportId',e.report_id) order by e.requested_at desc),'[]'::jsonb) from public.grader_report_email_outbox e join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id;
$$;

create function public.grader_purge_report_emails() returns void
language plpgsql security invoker set search_path='' as $$
begin
  update public.grader_report_email_outbox set status='unavailable',error_code='expired',message='{}'::jsonb,lease_id=null,lease_until=null,updated_at=now() where status in ('queued','sending') and retry_deadline<=now();
  delete from public.grader_report_email_outbox where expires_at<=now();
  delete from public.grader_report_email_requests where requested_at<=now()-interval '48 hours';
  delete from public.grader_report_email_suppression where expires_at<=now();
  delete from public.grader_report_email_usage where (bucket like 'day:%' and substring(bucket from 5)<to_char(now()-interval '14 months','YYYY-MM-DD')) or (bucket like 'month:%' and substring(bucket from 7)<to_char(now()-interval '14 months','YYYY-MM'));
end;
$$;

revoke execute on function public.grader_report_email_json(uuid),public.grader_reserve_report_email(uuid,uuid,uuid,text,text,jsonb,text,text),public.grader_list_report_emails(uuid,uuid),public.grader_record_report_email_workflow(uuid,text),public.grader_claim_report_email(uuid,text),public.grader_finish_report_email(uuid,text,integer,text,uuid,text,integer),public.grader_fail_report_email_queue(uuid),public.grader_abort_report_email(uuid,text),public.grader_record_report_email_event(text,uuid,uuid,text,timestamptz,text),public.grader_export_report_emails(uuid),public.grader_purge_report_emails() from public,anon,authenticated;
grant execute on function public.grader_report_email_json(uuid),public.grader_reserve_report_email(uuid,uuid,uuid,text,text,jsonb,text,text),public.grader_list_report_emails(uuid,uuid),public.grader_record_report_email_workflow(uuid,text),public.grader_claim_report_email(uuid,text),public.grader_finish_report_email(uuid,text,integer,text,uuid,text,integer),public.grader_fail_report_email_queue(uuid),public.grader_abort_report_email(uuid,text),public.grader_record_report_email_event(text,uuid,uuid,text,timestamptz,text),public.grader_export_report_emails(uuid),public.grader_purge_report_emails() to service_role;
