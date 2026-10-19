-- Optional reporting reminders; never inherit the legacy reminders/marketing switches.
create table public.grader_reporting_preferences (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null unique references public.grader_workspaces(id) on delete cascade,
 granted boolean not null default false,revision integer not null default 0 check(revision between 0 and 1000000),generation integer not null default 1 check(generation between 1 and 1000000),
 version text not null default 'outcome-reporting-reminders-v1',recipient_email text not null,recipient_hash text not null check(recipient_hash ~ '^[a-f0-9]{64}$'),updated_at timestamptz not null default now()
);
create table public.grader_reporting_consent_events (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
 granted boolean not null,version text not null,text text not null,source text not null check(source in ('account','one_click')),recorded_at timestamptz not null default clock_timestamp()
);
create index grader_reporting_consent_owner_idx on public.grader_reporting_consent_events(workspace_id,recorded_at);
create table public.grader_reporting_control(id boolean primary key default true check(id),paused boolean not null default false,revision integer not null default 0);
insert into public.grader_reporting_control(id) values(true);
create table public.grader_reporting_outbox (
 id uuid primary key default gen_random_uuid(),preference_id uuid not null references public.grader_reporting_preferences(id) on delete cascade,
 workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,plan_id uuid references public.grader_outcome_plans(id) on delete cascade,
 request_id uuid,kind text not null check(kind in ('closed','follow_up','sample')),generation integer not null,recipient_hash text not null,
 status text not null default 'queued' check(status in ('queued','sending','accepted','delivered','failed','cancelled','bounced','complained')),
 message jsonb check(message is null or (jsonb_typeof(message)='object' and octet_length(message::text)<=30000)),
 attempts integer not null default 0 check(attempts between 0 and 4),revision integer not null default 0,lease_id text,lease_until timestamptz,dispatch_until timestamptz,
 next_attempt_at timestamptz not null default now(),retry_deadline timestamptz not null default now()+interval '2 days',token_expires_at timestamptz not null default now()+interval '90 days',
 budget_day text not null,budget_month text not null,provider_message_id uuid,accepted_at timestamptz,delivery_event text,delivery_event_at timestamptz,error_code text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((kind='sample' and plan_id is null and request_id is not null) or (kind<>'sample' and plan_id is not null and request_id is null)),unique(plan_id,kind),unique(workspace_id,request_id)
);
create index grader_reporting_outbox_pref_idx on public.grader_reporting_outbox(preference_id);
create index grader_reporting_outbox_owner_idx on public.grader_reporting_outbox(workspace_id,created_at);
create index grader_reporting_outbox_due_idx on public.grader_reporting_outbox(next_attempt_at) where status in ('queued','sending');
create table public.grader_reporting_usage(bucket text primary key,count integer not null default 0 check(count>=0));
create table public.grader_reporting_events(event_id text primary key,outbox_id uuid not null references public.grader_reporting_outbox(id) on delete cascade,provider_message_id uuid not null,event_type text not null,occurred_at timestamptz not null,recorded_at timestamptz not null default now());
create index grader_reporting_events_outbox_idx on public.grader_reporting_events(outbox_id);

create function public.grader_reporting_state(p_user_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('paused',(select paused from public.grader_reporting_control where id),'preference',coalesce((select jsonb_build_object('id',p.id,'granted',p.granted,'revision',p.revision,'generation',p.generation,'version',p.version,'updatedAt',p.updated_at) from public.grader_reporting_preferences p join public.grader_workspaces w on w.id=p.workspace_id where w.owner_user_id=p_user_id),'{"id":null,"granted":false,"revision":0,"generation":1,"version":"outcome-reporting-reminders-v1","updatedAt":null}'::jsonb),'messages',coalesce((select jsonb_agg(payload order by created_at desc) from (select o.created_at,jsonb_build_object('id',o.id,'kind',o.kind,'status',o.status,'createdAt',o.created_at,'updatedAt',o.updated_at) payload from public.grader_reporting_outbox o join public.grader_workspaces w on w.id=o.workspace_id where w.owner_user_id=p_user_id order by o.created_at desc limit 30) s),'[]'::jsonb));
$$;
create function public.grader_set_reporting_consent(p_user_id uuid,p_revision integer,p_granted boolean,p_recipient text,p_hash text,p_version text,p_text text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare w uuid;p public.grader_reporting_preferences%rowtype;
begin
 if p_user_id is null or p_revision is null or p_revision not between 0 and 1000000 or p_granted is null or p_version is distinct from 'outcome-reporting-reminders-v1' or p_text is null or length(p_text) not between 100 and 2000 or p_recipient is null or length(p_recipient) not between 3 and 254 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_reporting_consent';end if;
 perform pg_catalog.pg_advisory_xact_lock(82995);w:=public.grader_ensure_workspace(p_user_id);
 select * into p from public.grader_reporting_preferences where workspace_id=w for update;
 if found then if p.revision<>p_revision then return '{"error":"revision_conflict"}'::jsonb;end if;
 else if p_revision<>0 then return '{"error":"revision_conflict"}'::jsonb;end if;
 insert into public.grader_reporting_preferences(workspace_id,recipient_email,recipient_hash) values(w,lower(p_recipient),p_hash) returning * into p;end if;
 if p_granted and (exists(select 1 from public.grader_nurture_suppression where recipient_hash=p_hash) or exists(select 1 from public.grader_report_email_suppression where recipient_hash=p_hash and expires_at>now())) then return '{"error":"reporting_suppressed"}'::jsonb;end if;
 if p.granted=p_granted and p.recipient_email=lower(p_recipient) then return public.grader_reporting_state(p_user_id);end if;
 if p_granted and (p.generation>=1000000 or p.revision>=1000000 or (select count(*) from public.grader_reporting_consent_events where workspace_id=w)>=1000) then return '{"error":"reporting_consent_limit"}'::jsonb;end if;
 update public.grader_reporting_preferences set granted=p_granted,revision=least(revision+1,1000000),generation=least(generation+1,1000000),recipient_email=lower(p_recipient),recipient_hash=p_hash,updated_at=clock_timestamp() where id=p.id;
 insert into public.grader_reporting_consent_events(workspace_id,granted,version,text,source) values(w,p_granted,p_version,p_text,'account');
 update public.grader_reporting_outbox set status='cancelled',message=null,lease_id=null,lease_until=null,error_code='consent_changed',updated_at=now() where preference_id=p.id and status in ('queued','sending');
 return public.grader_reporting_state(p_user_id);
end $$;
create function public.grader_unsubscribe_reporting(p_id uuid,p_generation integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare p public.grader_reporting_preferences%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(82995);select * into p from public.grader_reporting_preferences where id=p_id and generation=p_generation for update;
 if not found or not p.granted then return true;end if;
 update public.grader_reporting_preferences set granted=false,revision=least(revision+1,1000000),updated_at=clock_timestamp() where id=p.id;
 insert into public.grader_reporting_consent_events(workspace_id,granted,version,text,source) values(p.workspace_id,false,'outcome-reporting-reminders-v1','Stop only outcome-reporting reminders. Other account preferences are unchanged.','one_click');
 update public.grader_reporting_outbox set status='cancelled',message=null,lease_id=null,lease_until=null,error_code='consent_withdrawn',updated_at=now() where preference_id=p.id and status in ('queued','sending');return true;
end $$;
create function public.grader_reporting_budget(p_day text,p_month text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(82995);
 if coalesce((select count from public.grader_reporting_usage where bucket=p_day),0)>=20 or coalesce((select count from public.grader_reporting_usage where bucket=p_month),0)>=100 then return false;end if;
 insert into public.grader_reporting_usage(bucket,count) values(p_day,1),(p_month,1) on conflict(bucket) do update set count=public.grader_reporting_usage.count+1;return true;
end $$;
create function public.grader_reserve_reporting(p_user_id uuid default null,p_request_id uuid default null,p_recipient text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.grader_reporting_preferences%rowtype;plan public.grader_outcome_plans%rowtype;o public.grader_reporting_outbox%rowtype;k text;d text;m text;result jsonb:='[]'::jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(82995);d:='day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD');m:='month:'||to_char(now() at time zone 'UTC','YYYY-MM');
 if (select paused from public.grader_reporting_control where id) then return result;end if;
 if p_user_id is not null then
  if p_request_id is null then raise exception 'invalid_reporting_sample';end if;
  select r.* into p from public.grader_reporting_preferences r join public.grader_workspaces w on w.id=r.workspace_id where w.owner_user_id=p_user_id for update of r;
  if not found or not p.granted or p.recipient_email is distinct from lower(p_recipient) then return '{"error":"reporting_consent_required"}'::jsonb;end if;
  if exists(select 1 from public.grader_nurture_suppression where recipient_hash=p.recipient_hash) or exists(select 1 from public.grader_report_email_suppression where recipient_hash=p.recipient_hash and expires_at>now()) then return '{"error":"reporting_suppressed"}'::jsonb;end if;
  select * into o from public.grader_reporting_outbox where workspace_id=p.workspace_id and request_id=p_request_id;
  if found then
   if o.status='queued' and o.attempts<4 and (o.attempts=0 or o.retry_deadline>now()) and o.next_attempt_at<=now() and (o.dispatch_until is null or o.dispatch_until<=now()) and (o.lease_until is null or o.lease_until<=now()) then
    update public.grader_reporting_outbox set dispatch_until=now()+interval '5 minutes' where id=o.id;return jsonb_build_object('messageId',o.id,'dispatch',true);
   end if;return jsonb_build_object('messageId',o.id,'dispatch',false);
  end if;
  if (select count(*) from public.grader_reporting_outbox where workspace_id=p.workspace_id and kind='sample' and created_at>date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=1 or (select count(*) from public.grader_reporting_outbox where workspace_id=p.workspace_id and kind='sample' and created_at>date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')>=3 then return '{"error":"reporting_sample_limit"}'::jsonb;end if;
  if not public.grader_reporting_budget(d,m) then return '{"error":"reporting_global_limit"}'::jsonb;end if;
  insert into public.grader_reporting_outbox(preference_id,workspace_id,request_id,kind,generation,recipient_hash,budget_day,budget_month,dispatch_until) values(p.id,p.workspace_id,p_request_id,'sample',p.generation,p.recipient_hash,d,m,now()+interval '5 minutes') returning * into o;return jsonb_build_object('messageId',o.id,'dispatch',true);
 end if;
 -- Recover queued jobs first, including failed dispatches. Never retry provider work outside its one-hour window.
 update public.grader_reporting_outbox set status='failed',message=null,error_code='retry_expired',lease_id=null,lease_until=null where status in ('queued','sending') and attempts>0 and retry_deadline<=now();
 for o in select * from public.grader_reporting_outbox where status in ('queued','sending') and attempts<4 and next_attempt_at<=now() and (dispatch_until is null or dispatch_until<=now()) and (lease_until is null or lease_until<=now()) order by created_at limit 10 for update skip locked loop
  update public.grader_reporting_outbox set dispatch_until=now()+interval '5 minutes' where id=o.id;result:=result||jsonb_build_array(o.id);
 end loop;
 for plan in select q.* from public.grader_outcome_plans q join public.grader_reporting_preferences r on r.workspace_id=q.workspace_id where q.status='registered' and q.outcome_id is null and q.end_date<(now() at time zone 'UTC')::date and r.granted order by q.end_date,q.id for update of q skip locked loop
  if jsonb_array_length(result)>=10 then exit;end if;
  select * into p from public.grader_reporting_preferences where workspace_id=plan.workspace_id;
  if exists(select 1 from public.grader_nurture_suppression where recipient_hash=p.recipient_hash) or exists(select 1 from public.grader_report_email_suppression where recipient_hash=p.recipient_hash and expires_at>now()) then continue;end if;
  k:='closed';
  if exists(select 1 from public.grader_reporting_outbox where plan_id=plan.id and kind='closed') then
   if not exists(select 1 from public.grader_reporting_outbox where plan_id=plan.id and kind='closed' and status in ('accepted','delivered') and accepted_at<=now()-interval '7 days') then continue;end if;k:='follow_up';
  end if;
  if exists(select 1 from public.grader_reporting_outbox where plan_id=plan.id and kind=k) then continue;end if;
  if not public.grader_reporting_budget(d,m) then exit;end if;
  insert into public.grader_reporting_outbox(preference_id,workspace_id,plan_id,kind,generation,recipient_hash,budget_day,budget_month,dispatch_until) values(p.id,p.workspace_id,plan.id,k,p.generation,p.recipient_hash,d,m,now()+interval '5 minutes') returning * into o;result:=result||jsonb_build_array(o.id);
 end loop;return result;
end $$;
create function public.grader_claim_reporting(p_id uuid,p_lease text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.grader_reporting_outbox%rowtype;p public.grader_reporting_preferences%rowtype;w uuid;d text;m text;
begin
 if p_lease is null or length(p_lease) not between 1 and 200 then raise exception 'invalid_reporting_claim';end if;
 perform pg_catalog.pg_advisory_xact_lock(82995);select * into o from public.grader_reporting_outbox where id=p_id for update;
 if not found or o.status not in ('queued','sending') or o.next_attempt_at>now() or (o.lease_until>now() and o.lease_id<>p_lease) then return null;end if;
 select * into p from public.grader_reporting_preferences where id=o.preference_id;
 if not p.granted or p.generation<>o.generation or p.recipient_hash<>o.recipient_hash or exists(select 1 from public.grader_nurture_suppression where recipient_hash=o.recipient_hash) or exists(select 1 from public.grader_report_email_suppression where recipient_hash=o.recipient_hash and expires_at>now()) or (o.kind<>'sample' and not exists(select 1 from public.grader_outcome_plans where id=o.plan_id and status='registered' and outcome_id is null and end_date<(now() at time zone 'UTC')::date)) then update public.grader_reporting_outbox set status='cancelled',message=null,error_code='consent_plan_or_suppression',lease_id=null,lease_until=null where id=p_id;return null;end if;
 if (select paused from public.grader_reporting_control where id) then return null;end if;
 if o.attempts>=4 or (o.attempts>0 and o.retry_deadline<=now()) then update public.grader_reporting_outbox set status='failed',message=null,error_code='retry_expired' where id=p_id;return null;end if;
 d:='day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD');m:='month:'||to_char(now() at time zone 'UTC','YYYY-MM');
 if o.attempts=0 and (o.budget_day<>d or o.budget_month<>m) then if not public.grader_reporting_budget(d,m) then return null;end if;update public.grader_reporting_outbox set budget_day=d,budget_month=m where id=p_id;end if;
 select owner_user_id into w from public.grader_workspaces where id=o.workspace_id;
 update public.grader_reporting_outbox set status='sending',attempts=attempts+1,revision=revision+1,lease_id=p_lease,lease_until=now()+interval '2 minutes',retry_deadline=case when attempts=0 then now()+interval '1 hour' else retry_deadline end,token_expires_at=case when attempts=0 then now()+interval '90 days' else token_expires_at end,updated_at=now() where id=p_id returning * into o;
 return jsonb_build_object('id',o.id,'preferenceId',p.id,'generation',p.generation,'kind',o.kind,'revision',o.revision,'attempt',o.attempts,'ownerUserId',w,'recipientEmail',p.recipient_email,'message',o.message,'tokenExpiresAt',o.token_expires_at,'startDate',(select start_date from public.grader_outcome_plans where id=o.plan_id),'endDate',(select end_date from public.grader_outcome_plans where id=o.plan_id));
end $$;
create function public.grader_preflight_reporting(p_id uuid,p_lease text,p_revision integer,p_recipient text,p_message jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.grader_reporting_outbox%rowtype;p public.grader_reporting_preferences%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(82995);select * into o from public.grader_reporting_outbox where id=p_id for update;
 if not found or o.status<>'sending' or o.lease_id is distinct from p_lease or o.revision is distinct from p_revision or o.lease_until<=now() or o.retry_deadline<=now() then return null;end if;
 select * into p from public.grader_reporting_preferences where id=o.preference_id;
 if not p.granted or p.generation<>o.generation or p.recipient_email is distinct from lower(p_recipient) or p.recipient_hash<>o.recipient_hash or exists(select 1 from public.grader_nurture_suppression where recipient_hash=o.recipient_hash) or exists(select 1 from public.grader_report_email_suppression where recipient_hash=o.recipient_hash and expires_at>now()) then return null;end if;
 if o.kind<>'sample' then perform 1 from public.grader_outcome_plans where id=o.plan_id and status='registered' and outcome_id is null and end_date<(now() at time zone 'UTC')::date for update;if not found then return null;end if;end if;
 if (select paused from public.grader_reporting_control where id) then return '{"paused":true}'::jsonb;end if;
 if o.message is null then if jsonb_typeof(p_message) is distinct from 'object' or octet_length(p_message::text)>30000 or p_message->'to' is distinct from jsonb_build_array(p.recipient_email) then raise exception 'invalid_reporting_message';end if;update public.grader_reporting_outbox set message=p_message where id=p_id;return p_message;end if;return o.message;
end $$;
create function public.grader_finish_reporting(p_id uuid,p_lease text,p_revision integer,p_status text,p_provider uuid,p_error text,p_retry integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.grader_reporting_outbox%rowtype;
begin
 if p_status not in ('queued','accepted','failed','cancelled') or p_retry not between 0 and 300 then raise exception 'invalid_reporting_transition';end if;
 perform pg_catalog.pg_advisory_xact_lock(82995);select * into o from public.grader_reporting_outbox where id=p_id and status='sending' and lease_id=p_lease and revision=p_revision for update;if not found then return false;end if;
 if p_status='accepted' and p_provider is null then raise exception 'invalid_reporting_acceptance';end if;
 if p_status='queued' and (o.attempts>=4 or o.retry_deadline<=now()+make_interval(secs=>p_retry)) then p_status:='failed';p_error:='retry_exhausted';end if;
 update public.grader_reporting_outbox set status=p_status,provider_message_id=coalesce(p_provider,provider_message_id),accepted_at=case when p_status='accepted' then coalesce(accepted_at,now()) else accepted_at end,error_code=p_error,next_attempt_at=now()+make_interval(secs=>p_retry),message=case when p_status='queued' then message else null end,lease_id=null,lease_until=null,dispatch_until=null,attempts=case when p_error='paused' and message is null then greatest(attempts-1,0) else attempts end,retry_deadline=case when p_error='paused' and message is null then now()+interval '2 days' else retry_deadline end,updated_at=now() where id=p_id;return true;
end $$;
create function public.grader_release_reporting(p_id uuid) returns void language sql security invoker set search_path='' as $$ update public.grader_reporting_outbox set dispatch_until=null where id=p_id and status='queued'; $$;
create function public.grader_abort_reporting(p_id uuid,p_lease text) returns void language plpgsql security invoker set search_path='' as $$ declare r integer;begin select revision into r from public.grader_reporting_outbox where id=p_id and status='sending' and lease_id=p_lease;if found then perform public.grader_finish_reporting(p_id,p_lease,r,'failed',null,'workflow_exhausted',0);end if;end $$;
create function public.grader_record_reporting_event(p_event_id text,p_outbox_id uuid,p_provider_id uuid,p_event_type text,p_occurred_at timestamptz,p_recipient_hash text) returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.grader_reporting_outbox%rowtype;n text;priority integer;current_priority integer;
begin
 if length(p_event_id) not between 1 and 200 or p_provider_id is null or p_event_type not in ('email.delivered','email.bounced','email.complained','email.failed','email.delivery_delayed','email.suppressed') or p_occurred_at is null or p_occurred_at>now()+interval '5 minutes' then raise exception 'invalid_reporting_event';end if;
 perform pg_catalog.pg_advisory_xact_lock(82995);select * into o from public.grader_reporting_outbox where id=p_outbox_id for update;
 if not found or o.recipient_hash is distinct from p_recipient_hash or (o.provider_message_id is not null and o.provider_message_id<>p_provider_id) or p_occurred_at<o.created_at-interval '5 minutes' then return false;end if;
 insert into public.grader_reporting_events(event_id,outbox_id,provider_message_id,event_type,occurred_at) values(p_event_id,p_outbox_id,p_provider_id,p_event_type,p_occurred_at) on conflict do nothing;if not found then return false;end if;
 n:=case p_event_type when 'email.complained' then 'complained' when 'email.bounced' then 'bounced' when 'email.suppressed' then 'bounced' when 'email.delivered' then 'delivered' when 'email.failed' then 'failed' else 'accepted' end;
 priority:=case n when 'complained' then 100 when 'bounced' then 90 when 'delivered' then 80 when 'failed' then 50 else 40 end;current_priority:=case o.status when 'complained' then 100 when 'bounced' then 90 when 'delivered' then 80 when 'failed' then 50 when 'accepted' then 40 else 0 end;
 if n in ('bounced','complained') then insert into public.grader_nurture_suppression(recipient_hash,reason) values(o.recipient_hash,n) on conflict(recipient_hash) do update set reason=case when public.grader_nurture_suppression.reason='complained' then 'complained' else excluded.reason end;update public.grader_reporting_outbox set status='cancelled',message=null,lease_id=null,lease_until=null,error_code='recipient_suppressed' where recipient_hash=o.recipient_hash and status in ('queued','sending') and id<>p_outbox_id;end if;
 if priority>current_priority or (priority=current_priority and (o.delivery_event_at is null or p_occurred_at>=o.delivery_event_at)) then update public.grader_reporting_outbox set status=n,provider_message_id=p_provider_id,accepted_at=case when n in ('accepted','delivered') then coalesce(accepted_at,now()) else accepted_at end,delivery_event=p_event_type,delivery_event_at=p_occurred_at,message=null,lease_id=null,lease_until=null,updated_at=now() where id=p_outbox_id;end if;return true;
end $$;
create function public.grader_reporting_operations() returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('paused',paused,'revision',revision,'delivery',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from public.grader_reporting_outbox group by status)s),'{}'::jsonb),'usage',jsonb_build_object('day',coalesce((select count from public.grader_reporting_usage where bucket='day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD')),0),'month',coalesce((select count from public.grader_reporting_usage where bucket='month:'||to_char(now() at time zone 'UTC','YYYY-MM')),0))) from public.grader_reporting_control where id; $$;
create function public.grader_pause_reporting(p_revision integer,p_paused boolean) returns jsonb language plpgsql security invoker set search_path='' as $$ begin perform pg_catalog.pg_advisory_xact_lock(82995);if p_paused is null then raise exception 'invalid_reporting_pause';end if;update public.grader_reporting_control set paused=p_paused,revision=revision+1 where id and revision=p_revision;if not found then return '{"error":"revision_conflict"}'::jsonb;end if;return public.grader_reporting_operations();end $$;
create function public.grader_export_reporting(p_user_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select (public.grader_reporting_state(p_user_id)-'messages')||jsonb_build_object(
 'historyLimit',1000,'historyTruncated',(select count(*)>1000 from public.grader_reporting_outbox o join public.grader_workspaces w on w.id=o.workspace_id where w.owner_user_id=p_user_id),
 'messages',coalesce((select jsonb_agg(payload order by created_at desc)from(select o.created_at,jsonb_build_object('id',o.id,'kind',o.kind,'status',o.status,'createdAt',o.created_at,'updatedAt',o.updated_at,'deliveryEvent',o.delivery_event)payload from public.grader_reporting_outbox o join public.grader_workspaces w on w.id=o.workspace_id where w.owner_user_id=p_user_id order by o.created_at desc limit 1000)s),'[]'::jsonb),
 'consentHistoryTruncated',(select count(*)>1000 from public.grader_reporting_consent_events e join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id),
 'consentEvents',coalesce((select jsonb_agg(payload order by recorded_at desc)from(select e.recorded_at,jsonb_build_object('granted',e.granted,'version',e.version,'text',e.text,'source',e.source,'recordedAt',e.recorded_at)payload from public.grader_reporting_consent_events e join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id order by e.recorded_at desc limit 1000)s),'[]'::jsonb));
$$;
create function public.grader_purge_reporting() returns void language plpgsql security invoker set search_path='' as $$ begin update public.grader_reporting_outbox set message=null where retry_deadline<=now();delete from public.grader_reporting_events where recorded_at<now()-interval '90 days';delete from public.grader_reporting_usage where (bucket like 'day:%' and substring(bucket from 5)<to_char(now()-interval '14 months','YYYY-MM-DD')) or (bucket like 'month:%' and substring(bucket from 7)<to_char(now()-interval '14 months','YYYY-MM'));end $$;
do $$ declare n text;r record;begin
 foreach n in array array['grader_reporting_preferences','grader_reporting_consent_events','grader_reporting_control','grader_reporting_outbox','grader_reporting_usage','grader_reporting_events'] loop execute format('alter table public.%I enable row level security',n);execute format('revoke all on public.%I from public,anon,authenticated',n);execute format('grant all on public.%I to service_role',n);end loop;
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'grader_reporting_%' or p.proname in ('grader_set_reporting_consent','grader_unsubscribe_reporting','grader_reserve_reporting','grader_claim_reporting','grader_preflight_reporting','grader_finish_reporting','grader_release_reporting','grader_abort_reporting','grader_record_reporting_event','grader_pause_reporting','grader_export_reporting','grader_purge_reporting')) loop execute format('revoke execute on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;
end $$;
