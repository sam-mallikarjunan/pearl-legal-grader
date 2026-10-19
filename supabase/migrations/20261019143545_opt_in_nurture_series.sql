-- Explicit educational marketing series. Apply once with a native migration receipt;
-- no existing preference or account is enrolled by this migration.
create table public.grader_nurture_control (
  id boolean primary key default true check(id),
  paused boolean not null default false,
  revision integer not null default 0 check(revision>=0),
  updated_at timestamptz not null default now()
);
insert into public.grader_nurture_control(id) values(true);
create table public.grader_nurture_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  series_version text not null check(series_version='practice-foundations-v1'),
  consent_version text not null check(consent_version='practice-foundations-consent-v1'),
  consent_text text not null check(length(consent_text) between 1 and 2000),
  recipient_email text not null check(length(recipient_email) between 3 and 254),
  recipient_hash text not null check(recipient_hash ~ '^[a-f0-9]{64}$'),
  generation integer not null default 1 check(generation>=1),
  status text not null default 'active' check(status in ('active','withdrawn','completed','suppressed')),
  next_step integer not null default 1 check(next_step between 1 and 5),
  next_send_at timestamptz,
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,series_version)
);
create index grader_nurture_due_idx on public.grader_nurture_enrollments(next_send_at) where status='active';
create table public.grader_nurture_consent_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.grader_nurture_enrollments(id) on delete cascade,
  granted boolean not null,
  version text not null,
  text text not null check(length(text) between 1 and 2000),
  source text not null check(source in ('account','one_click','preferences','delivery')),
  recorded_at timestamptz not null default now()
);
create index grader_nurture_consent_owner_idx on public.grader_nurture_consent_events(enrollment_id,recorded_at);
create table public.grader_nurture_outbox (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.grader_nurture_enrollments(id) on delete cascade,
  step integer not null check(step between 1 and 4),
  generation integer not null,
  status text not null default 'queued' check(status in ('queued','sending','accepted','delivered','bounced','complained','failed','cancelled')),
  recipient_hash text not null check(recipient_hash ~ '^[a-f0-9]{64}$'),
  budget_day text not null,
  budget_month text not null,
  message jsonb check(message is null or (jsonb_typeof(message)='object' and octet_length(message::text)<=50000)),
  attempts integer not null default 0 check(attempts between 0 and 4),
  revision integer not null default 0 check(revision>=0),
  lease_id text,
  lease_until timestamptz,
  dispatch_until timestamptz,
  workflow_run_id text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Unstarted work can survive a scheduler outage. First claim starts the one-hour provider retry window.
  retry_deadline timestamptz not null default now()+interval '2 days',
  token_expires_at timestamptz not null default now()+interval '90 days',
  provider_message_id uuid,
  delivery_event text,
  delivery_event_at timestamptz,
  error_code text check(error_code is null or error_code ~ '^[a-z_]{1,80}$'),
  unique(enrollment_id,step)
);
create index grader_nurture_outbox_due_idx on public.grader_nurture_outbox(next_attempt_at) where status in ('queued','sending');
create index grader_nurture_outbox_owner_idx on public.grader_nurture_outbox(enrollment_id,created_at);
create table public.grader_nurture_usage (
  bucket text primary key check(bucket ~ '^(day:[0-9]{4}-[0-9]{2}-[0-9]{2}|month:[0-9]{4}-[0-9]{2})$'),
  count integer not null default 0 check(count>=0)
);
create table public.grader_nurture_suppression (
  recipient_hash text primary key check(recipient_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check(reason in ('bounced','complained')),
  recorded_at timestamptz not null default now()
);
create table public.grader_nurture_delivery_events (
  event_id text primary key check(length(event_id) between 1 and 200),
  outbox_id uuid not null references public.grader_nurture_outbox(id) on delete cascade,
  provider_message_id uuid not null,
  event_type text not null check(event_type in ('email.delivered','email.bounced','email.complained','email.failed','email.delivery_delayed','email.suppressed')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create table public.grader_nurture_admin_events (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null,
  paused boolean not null,
  revision integer not null,
  reason text not null check(length(reason) between 8 and 500),
  recorded_at timestamptz not null default now()
);

create function public.grader_nurture_state(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('paused',(select paused from public.grader_nurture_control where id),
    'enrollment',(select jsonb_build_object('id',e.id,'status',case when e.status='active' and p.preference_values->'marketing' is distinct from 'true'::jsonb then 'withdrawn' else e.status end,
      'seriesVersion',e.series_version,'consentVersion',e.consent_version,'enrolledAt',e.enrolled_at,'nextSendAt',case when e.status='active' then e.next_send_at else null end,'generation',e.generation,
      'messagesAccepted',(select count(*) from public.grader_nurture_outbox o where o.enrollment_id=e.id and o.status in ('accepted','delivered','bounced','complained')),
      'messagesDelivered',(select count(*) from public.grader_nurture_outbox o where o.enrollment_id=e.id and o.status='delivered'))
    from public.grader_nurture_enrollments e join public.grader_workspaces w on w.id=e.workspace_id join public.grader_preferences p on p.workspace_id=w.id where w.owner_user_id=p_user_id));
$$;

create function public.grader_enroll_nurture(p_user_id uuid,p_recipient text,p_recipient_hash text,p_series_version text,p_consent_version text,p_consent_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid;v_id uuid;v_status text;v_pref public.grader_preferences%rowtype;
begin
  if p_user_id is null or p_recipient is null or length(p_recipient) not between 3 and 254 or p_recipient_hash is null or p_recipient_hash !~ '^[a-f0-9]{64}$' or p_series_version is distinct from 'practice-foundations-v1' or p_consent_version is distinct from 'practice-foundations-consent-v1' or p_consent_text is null or length(p_consent_text) not between 100 and 2000 then raise exception 'invalid_nurture_consent';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82981));
  if (select paused from public.grader_nurture_control where id) then return '{"error":"nurture_paused"}'::jsonb;end if;
  if exists(select 1 from public.grader_nurture_suppression where recipient_hash=p_recipient_hash) or exists(select 1 from public.grader_report_email_suppression where recipient_hash=p_recipient_hash and expires_at>now()) then return '{"error":"nurture_suppressed"}'::jsonb;end if;
  v_workspace:=public.grader_ensure_workspace(p_user_id);
  select id,status into v_id,v_status from public.grader_nurture_enrollments where workspace_id=v_workspace and series_version=p_series_version;
  if found then
    if v_status<>'active' then return '{"error":"nurture_already_started"}'::jsonb;end if;
    return public.grader_nurture_state(p_user_id);
  end if;
  select * into v_pref from public.grader_preferences where workspace_id=v_workspace for update;
  if (select count(*) from public.grader_consent_events where workspace_id=v_workspace)>=1000 then return '{"error":"preference_limit"}'::jsonb;end if;
  if v_pref.preference_values->'marketing' is distinct from 'true'::jsonb then
    insert into public.grader_consent_events(workspace_id,preference,granted,version,text) values(v_workspace,'marketing',true,p_consent_version,p_consent_text);
    update public.grader_preferences set preference_values=jsonb_set(preference_values,'{marketing}','true'::jsonb),revision=revision+1,updated_at=now() where workspace_id=v_workspace;
  end if;
  insert into public.grader_nurture_enrollments(workspace_id,series_version,consent_version,consent_text,recipient_email,recipient_hash,next_send_at)
    values(v_workspace,p_series_version,p_consent_version,p_consent_text,lower(p_recipient),p_recipient_hash,now()) returning id into v_id;
  insert into public.grader_nurture_consent_events(enrollment_id,granted,version,text,source) values(v_id,true,p_consent_version,p_consent_text,'account');
  return public.grader_nurture_state(p_user_id);
end;
$$;

create function public.grader_withdraw_nurture(p_user_id uuid,p_enrollment_id uuid,p_generation integer,p_source text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_e public.grader_nurture_enrollments%rowtype;v_owner uuid;v_workspace uuid;v_marketing boolean;
begin
  if p_source is null or p_source not in ('account','one_click') or (p_source='account' and p_user_id is null) then raise exception 'invalid_nurture_withdrawal';end if;
  select w.owner_user_id,w.id into v_owner,v_workspace from public.grader_nurture_enrollments e join public.grader_workspaces w on w.id=e.workspace_id
    where ((p_source='account' and w.owner_user_id=p_user_id) or (p_source='one_click' and e.id=p_enrollment_id and e.generation=p_generation));
  if not found then return true;end if;
  -- Shared owner lock and preference-first order match ordinary preference updates.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,82981));
  select preference_values->'marketing'='true'::jsonb into v_marketing from public.grader_preferences where workspace_id=v_workspace for update;
  select e.* into v_e from public.grader_nurture_enrollments e join public.grader_workspaces w on w.id=e.workspace_id
    where ((p_source='account' and w.owner_user_id=p_user_id) or (p_source='one_click' and e.id=p_enrollment_id and e.generation=p_generation)) for update of e;
  if not found then return true;end if;
  if v_e.status='active' then
    update public.grader_nurture_enrollments set status='withdrawn',next_send_at=null,updated_at=now() where id=v_e.id;
    insert into public.grader_nurture_consent_events(enrollment_id,granted,version,text,source) values(v_e.id,false,v_e.consent_version,'Withdraw consent to the Practice Foundations series and all grader marketing email.',p_source);
  end if;
  update public.grader_nurture_outbox set status='cancelled',message=null,lease_id=null,lease_until=null,updated_at=now(),error_code='consent_withdrawn' where enrollment_id=v_e.id and status in ('queued','sending');
  if v_marketing then
    insert into public.grader_consent_events(workspace_id,preference,granted,version,text) values(v_workspace,'marketing',false,'practice-foundations-consent-v1','Unsubscribed from the Practice Foundations series and all grader marketing email.');
    update public.grader_preferences set preference_values=jsonb_set(preference_values,'{marketing}','false'::jsonb),revision=revision+1,updated_at=now() where workspace_id=v_workspace;
  end if;
  return true;
end;
$$;

-- A course-only permission must never be widened into the pre-existing news/offers export.
create or replace function public.grader_lead_export(p_purpose text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_purpose='requested_help' then
    return (select coalesce(jsonb_agg(jsonb_build_object('ownerUserId',w.owner_user_id,'purpose','requested_help','topic',l.topic,'status',l.status,'consentVersion',l.consent_version,'consentRecordedAt',l.created_at) order by l.created_at desc),'[]'::jsonb)
      from public.grader_lead_requests l join public.grader_workspaces w on w.id=l.workspace_id
      where l.contact_consent and l.status in ('open','in_review') and l.created_at>=clock_timestamp()-interval '90 days');
  elsif p_purpose='marketing' then
    return (select coalesce(jsonb_agg(jsonb_build_object('ownerUserId',w.owner_user_id,'purpose','marketing','topic',null,'status','opted_in','consentVersion',c.version,'consentRecordedAt',c.recorded_at) order by c.recorded_at desc),'[]'::jsonb)
      from public.grader_preferences p join public.grader_workspaces w on w.id=p.workspace_id
      join lateral (select e.version,e.granted,e.recorded_at from public.grader_consent_events e where e.workspace_id=w.id and e.preference='marketing' order by e.recorded_at desc,e.id desc limit 1) c on true
      where p.preference_values->'marketing'='true'::jsonb and c.granted and c.version='account-preferences-v1'
        and not exists(select 1 from public.grader_nurture_enrollments e join public.grader_nurture_suppression s on s.recipient_hash=e.recipient_hash where e.workspace_id=w.id)
        and not exists(select 1 from public.grader_nurture_enrollments e join public.grader_report_email_suppression s on s.recipient_hash=e.recipient_hash where e.workspace_id=w.id and s.expires_at>now())
        and not exists(select 1 from public.grader_report_email_outbox o join public.grader_report_email_suppression s on s.recipient_hash=o.recipient_hash where o.workspace_id=w.id and s.expires_at>now()));
  end if;
  raise exception 'invalid_export_purpose';
end;
$$;

-- Turning the existing marketing preference off also cancels the series immediately.
create function public.grader_nurture_preferences_changed() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if new.preference_values->'marketing' is distinct from 'true'::jsonb then
    for v_id in select id from public.grader_nurture_enrollments where workspace_id=new.workspace_id and status='active' for update loop
      insert into public.grader_nurture_consent_events(enrollment_id,granted,version,text,source) values(v_id,false,'practice-foundations-consent-v1','Marketing preference withdrawn. Practice Foundations series cancelled.','preferences');
      update public.grader_nurture_enrollments set status='withdrawn',next_send_at=null,updated_at=now() where id=v_id;
      update public.grader_nurture_outbox set status='cancelled',message=null,lease_id=null,lease_until=null,updated_at=now(),error_code='consent_withdrawn' where enrollment_id=v_id and status in ('queued','sending');
    end loop;
  end if;
  return new;
end;
$$;
create trigger grader_nurture_preferences_cancel after update of preference_values on public.grader_preferences for each row execute function public.grader_nurture_preferences_changed();

create function public.grader_reserve_nurture_batch(p_limit integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_e public.grader_nurture_enrollments%rowtype;v_o public.grader_nurture_outbox%rowtype;v_day text;v_month text;v_result jsonb:='[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'invalid_nurture_batch';end if;
  perform pg_catalog.pg_advisory_xact_lock(82987);
  if (select paused from public.grader_nurture_control where id) then return v_result;end if;
  update public.grader_nurture_outbox set status='failed',error_code='retry_expired',message=null,lease_id=null,lease_until=null,updated_at=now() where status in ('queued','sending') and attempts>0 and retry_deadline<=now();
  update public.grader_nurture_enrollments e set status='withdrawn',next_send_at=null,updated_at=now() where e.status='active' and exists(select 1 from public.grader_nurture_outbox o where o.enrollment_id=e.id and o.status='failed');
  v_day:='day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD');v_month:='month:'||to_char(now() at time zone 'UTC','YYYY-MM');
  for v_e in select e.* from public.grader_nurture_enrollments e join public.grader_preferences p on p.workspace_id=e.workspace_id
    where e.status='active' and e.next_step<=4 and e.next_send_at<=now() and p.preference_values->'marketing'='true'::jsonb
      and not exists(select 1 from public.grader_nurture_suppression s where s.recipient_hash=e.recipient_hash)
      and not exists(select 1 from public.grader_report_email_suppression s where s.recipient_hash=e.recipient_hash and s.expires_at>now())
    order by e.next_send_at,e.id limit 20 for update of e skip locked loop
    select * into v_o from public.grader_nurture_outbox where enrollment_id=v_e.id and step=v_e.next_step for update;
    if found then
      if v_o.status not in ('queued','sending') or (v_o.attempts>0 and v_o.retry_deadline<=now()) or v_o.attempts>=4 or v_o.next_attempt_at>now() or v_o.dispatch_until>now() or v_o.lease_until>now() then continue;end if;
    else
      if coalesce((select count from public.grader_nurture_usage where bucket=v_day),0)>=50 or coalesce((select count from public.grader_nurture_usage where bucket=v_month),0)>=500 then continue;end if;
      insert into public.grader_nurture_outbox(enrollment_id,step,generation,recipient_hash,budget_day,budget_month) values(v_e.id,v_e.next_step,v_e.generation,v_e.recipient_hash,v_day,v_month) returning * into v_o;
      insert into public.grader_nurture_usage(bucket,count) values(v_day,1),(v_month,1) on conflict(bucket) do update set count=public.grader_nurture_usage.count+1;
    end if;
    update public.grader_nurture_outbox set dispatch_until=now()+interval '5 minutes' where id=v_o.id;
    v_result:=v_result||jsonb_build_array(v_o.id);
    if jsonb_array_length(v_result)>=p_limit then exit;end if;
  end loop;
  return v_result;
end;
$$;

create function public.grader_record_nurture_workflow(p_outbox_id uuid,p_run_id text) returns void
language sql security invoker set search_path='' as $$
  update public.grader_nurture_outbox set workflow_run_id=p_run_id where id=p_outbox_id and status in ('queued','sending') and length(p_run_id) between 1 and 200;
$$;
create function public.grader_release_nurture_dispatch(p_outbox_id uuid) returns void
language sql security invoker set search_path='' as $$
  update public.grader_nurture_outbox set dispatch_until=null where id=p_outbox_id and status='queued';
$$;

create function public.grader_claim_nurture(p_outbox_id uuid,p_lease_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_e public.grader_nurture_enrollments%rowtype;v_o public.grader_nurture_outbox%rowtype;v_owner uuid;v_day text;v_month text;
begin
  if p_outbox_id is null or p_lease_id is null or length(p_lease_id) not between 1 and 200 then raise exception 'invalid_nurture_claim';end if;
  perform pg_catalog.pg_advisory_xact_lock(82987);
  -- Enrollment-first locking order matches withdrawal, preventing a cancellation deadlock.
  select e.* into v_e from public.grader_nurture_enrollments e join public.grader_nurture_outbox o on o.enrollment_id=e.id where o.id=p_outbox_id for update of e;
  if not found then return null;end if;
  select * into v_o from public.grader_nurture_outbox where id=p_outbox_id for update;
  if v_o.status not in ('queued','sending') or v_o.next_attempt_at>now() or (v_o.status='sending' and v_o.lease_until>now() and v_o.lease_id<>p_lease_id) then return null;end if;
  if v_e.status<>'active' or v_e.generation<>v_o.generation or (select preference_values->'marketing' from public.grader_preferences where workspace_id=v_e.workspace_id) is distinct from 'true'::jsonb or exists(select 1 from public.grader_nurture_suppression where recipient_hash=v_e.recipient_hash) or exists(select 1 from public.grader_report_email_suppression where recipient_hash=v_e.recipient_hash and expires_at>now()) then
    update public.grader_nurture_outbox set status='cancelled',message=null,lease_id=null,lease_until=null,error_code='consent_or_suppression',updated_at=now() where id=p_outbox_id;return null;
  end if;
  if (select paused from public.grader_nurture_control where id) then return null;end if;
  -- A scheduler outage cannot move yesterday's reserved work past today's sending allowance.
  v_day:='day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD');v_month:='month:'||to_char(now() at time zone 'UTC','YYYY-MM');
  if v_o.attempts=0 and (v_o.budget_day<>v_day or v_o.budget_month<>v_month) then
    if (v_o.budget_day<>v_day and coalesce((select count from public.grader_nurture_usage where bucket=v_day),0)>=50) or (v_o.budget_month<>v_month and coalesce((select count from public.grader_nurture_usage where bucket=v_month),0)>=500) then return null;end if;
    if v_o.budget_day<>v_day then insert into public.grader_nurture_usage(bucket,count) values(v_day,1) on conflict(bucket) do update set count=public.grader_nurture_usage.count+1;end if;
    if v_o.budget_month<>v_month then insert into public.grader_nurture_usage(bucket,count) values(v_month,1) on conflict(bucket) do update set count=public.grader_nurture_usage.count+1;end if;
    update public.grader_nurture_outbox set budget_day=v_day,budget_month=v_month where id=p_outbox_id;
  end if;
  if (v_o.attempts>0 and v_o.retry_deadline<=now()) or v_o.attempts>=4 then
    update public.grader_nurture_outbox set status='failed',error_code='retry_expired',message=null,lease_id=null,lease_until=null,updated_at=now() where id=p_outbox_id;return null;
  end if;
  select owner_user_id into v_owner from public.grader_workspaces where id=v_e.workspace_id;
  update public.grader_nurture_outbox set status='sending',attempts=attempts+1,revision=revision+1,lease_id=p_lease_id,lease_until=now()+interval '2 minutes',retry_deadline=case when attempts=0 then now()+interval '1 hour' else retry_deadline end,token_expires_at=case when attempts=0 then now()+interval '90 days' else token_expires_at end,updated_at=now() where id=p_outbox_id returning * into v_o;
  return jsonb_build_object('id',v_o.id,'enrollmentId',v_e.id,'generation',v_e.generation,'step',v_o.step,'revision',v_o.revision,'attempt',v_o.attempts,'message',v_o.message,'ownerUserId',v_owner,'recipientEmail',v_e.recipient_email,'tokenExpiresAt',v_o.token_expires_at);
end;
$$;

-- The last database check before provider I/O: current consent, pause, lease, recipient and frozen payload.
create function public.grader_preflight_nurture(p_outbox_id uuid,p_lease_id text,p_revision integer,p_recipient text,p_message jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_e public.grader_nurture_enrollments%rowtype;v_o public.grader_nurture_outbox%rowtype;
begin
  select e.* into v_e from public.grader_nurture_enrollments e join public.grader_nurture_outbox o on o.enrollment_id=e.id where o.id=p_outbox_id for update of e;
  if not found then return null;end if;
  select * into v_o from public.grader_nurture_outbox where id=p_outbox_id for update;
  if v_o.status<>'sending' or v_o.lease_id is distinct from p_lease_id or v_o.revision is distinct from p_revision or v_o.lease_until<=now() or v_o.retry_deadline<=now() or v_e.status<>'active' or v_e.generation<>v_o.generation or v_e.recipient_email is distinct from lower(p_recipient) or (select preference_values->'marketing' from public.grader_preferences where workspace_id=v_e.workspace_id) is distinct from 'true'::jsonb or exists(select 1 from public.grader_nurture_suppression where recipient_hash=v_e.recipient_hash) or exists(select 1 from public.grader_report_email_suppression where recipient_hash=v_e.recipient_hash and expires_at>now()) then return null;end if;
  if (select paused from public.grader_nurture_control where id) then return '{"paused":true}'::jsonb;end if;
  if v_o.message is null then
    if jsonb_typeof(p_message) is distinct from 'object' or octet_length(p_message::text)>50000 or p_message->'to' is distinct from jsonb_build_array(v_e.recipient_email) then raise exception 'invalid_nurture_message';end if;
    update public.grader_nurture_outbox set message=p_message where id=p_outbox_id;
    return p_message;
  end if;
  return v_o.message;
end;
$$;

create function public.grader_finish_nurture(p_outbox_id uuid,p_lease_id text,p_revision integer,p_status text,p_provider_id uuid,p_error_code text,p_retry_seconds integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_e public.grader_nurture_enrollments%rowtype;v_o public.grader_nurture_outbox%rowtype;
begin
  if p_status not in ('queued','accepted','failed','cancelled') or p_retry_seconds is null or p_retry_seconds not between 0 and 300 then raise exception 'invalid_nurture_transition';end if;
  select e.* into v_e from public.grader_nurture_enrollments e join public.grader_nurture_outbox o on o.enrollment_id=e.id where o.id=p_outbox_id for update of e;
  if not found then return false;end if;
  select * into v_o from public.grader_nurture_outbox where id=p_outbox_id and status='sending' and lease_id=p_lease_id and revision=p_revision for update;
  if not found then return false;end if;
  if p_status='accepted' and p_provider_id is null then raise exception 'invalid_nurture_acceptance';end if;
  if p_status='queued' and (v_o.attempts>=4 or v_o.retry_deadline<=now()+make_interval(secs=>p_retry_seconds)) then p_status:='failed';p_error_code:='retry_exhausted';end if;
  update public.grader_nurture_outbox set status=p_status,provider_message_id=coalesce(p_provider_id,provider_message_id),error_code=p_error_code,next_attempt_at=now()+make_interval(secs=>p_retry_seconds),message=case when p_status='queued' then message else null end,lease_id=null,lease_until=null,dispatch_until=null,updated_at=now(),attempts=case when p_error_code in ('operator_paused','configuration_paused') and message is null then greatest(attempts-1,0) else attempts end,retry_deadline=case when p_error_code in ('operator_paused','configuration_paused') and message is null then now()+interval '2 days' else retry_deadline end where id=p_outbox_id;
  if p_status='accepted' and v_e.status='active' then
    update public.grader_nurture_enrollments set next_step=greatest(next_step,v_o.step+1),status=case when v_o.step=4 then 'completed' else status end,next_send_at=case when v_o.step=4 then null else now()+interval '7 days' end,updated_at=now() where id=v_e.id;
  elsif p_status in ('failed','cancelled') and v_e.status='active' then
    update public.grader_nurture_enrollments set status='withdrawn',next_send_at=null,updated_at=now() where id=v_e.id;
  end if;
  return true;
end;
$$;

create function public.grader_abort_nurture(p_outbox_id uuid,p_lease_id text) returns void
language plpgsql security invoker set search_path='' as $$
declare v_revision integer;
begin
  select revision into v_revision from public.grader_nurture_outbox where id=p_outbox_id and status='sending' and lease_id=p_lease_id;
  if found then perform public.grader_finish_nurture(p_outbox_id,p_lease_id,v_revision,'failed',null,'workflow_exhausted',0);end if;
end;
$$;

create function public.grader_record_nurture_event(p_event_id text,p_outbox_id uuid,p_provider_id uuid,p_event_type text,p_occurred_at timestamptz,p_recipient_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_e public.grader_nurture_enrollments%rowtype;v_o public.grader_nurture_outbox%rowtype;v_next text;v_priority integer;v_current integer;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 200 or p_provider_id is null or p_event_type not in ('email.delivered','email.bounced','email.complained','email.failed','email.delivery_delayed','email.suppressed') or p_occurred_at is null or p_occurred_at>now()+interval '5 minutes' then raise exception 'invalid_nurture_event';end if;
  select e.* into v_e from public.grader_nurture_enrollments e join public.grader_nurture_outbox o on o.enrollment_id=e.id where o.id=p_outbox_id for update of e;
  if not found then return false;end if;
  select * into v_o from public.grader_nurture_outbox where id=p_outbox_id for update;
  if v_o.recipient_hash is distinct from p_recipient_hash or (v_o.provider_message_id is not null and v_o.provider_message_id<>p_provider_id) or p_occurred_at<v_o.created_at-interval '5 minutes' then return false;end if;
  insert into public.grader_nurture_delivery_events(event_id,outbox_id,provider_message_id,event_type,occurred_at) values(p_event_id,p_outbox_id,p_provider_id,p_event_type,p_occurred_at) on conflict(event_id) do nothing;
  if not found then return false;end if;
  v_next:=case p_event_type when 'email.complained' then 'complained' when 'email.bounced' then 'bounced' when 'email.suppressed' then 'bounced' when 'email.delivered' then 'delivered' when 'email.failed' then 'failed' else 'accepted' end;
  v_priority:=case v_next when 'complained' then 100 when 'bounced' then 90 when 'delivered' then 80 when 'failed' then 50 else 40 end;
  v_current:=case v_o.status when 'complained' then 100 when 'bounced' then 90 when 'delivered' then 80 when 'failed' then 50 when 'accepted' then 40 else 0 end;
  if v_next in ('bounced','complained') then
    insert into public.grader_nurture_suppression(recipient_hash,reason) values(v_o.recipient_hash,v_next) on conflict(recipient_hash) do update set reason=case when public.grader_nurture_suppression.reason='complained' then 'complained' else excluded.reason end;
    update public.grader_nurture_enrollments set status='suppressed',next_send_at=null,updated_at=now() where recipient_hash=v_o.recipient_hash;
    update public.grader_nurture_outbox set status='cancelled',message=null,lease_id=null,lease_until=null,error_code='recipient_suppressed',updated_at=now() where recipient_hash=v_o.recipient_hash and status in ('queued','sending') and id<>p_outbox_id;
  end if;
  if v_priority>v_current or (v_priority=v_current and (v_o.delivery_event_at is null or p_occurred_at>=v_o.delivery_event_at)) then
    update public.grader_nurture_outbox set status=v_next,provider_message_id=p_provider_id,delivery_event=p_event_type,delivery_event_at=p_occurred_at,message=null,lease_id=null,lease_until=null,updated_at=now(),error_code=null where id=p_outbox_id;
    -- A webhook can win the race with the provider response; advance exactly once.
    if v_o.status in ('queued','sending') and v_next in ('accepted','delivered') and v_e.status='active' then
      update public.grader_nurture_enrollments set next_step=greatest(next_step,v_o.step+1),status=case when v_o.step=4 then 'completed' else status end,next_send_at=case when v_o.step=4 then null else now()+interval '7 days' end,updated_at=now() where id=v_e.id;
    elsif v_next='failed' and v_e.status='active' then
      update public.grader_nurture_enrollments set status='withdrawn',next_send_at=null,updated_at=now() where id=v_e.id;
    end if;
  end if;
  return true;
end;
$$;

-- Existing report-mail bounces suppress nurture too. Same purpose-bound recipient HMAC is reused.
create function public.grader_nurture_report_suppression() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  insert into public.grader_nurture_suppression(recipient_hash,reason) values(new.recipient_hash,new.reason) on conflict(recipient_hash) do update set reason=case when public.grader_nurture_suppression.reason='complained' then 'complained' else excluded.reason end;
  update public.grader_nurture_enrollments set status='suppressed',next_send_at=null,updated_at=now() where recipient_hash=new.recipient_hash;
  update public.grader_nurture_outbox set status='cancelled',message=null,lease_id=null,lease_until=null,error_code='recipient_suppressed',updated_at=now() where recipient_hash=new.recipient_hash and status in ('queued','sending');
  return new;
end;
$$;
create trigger grader_nurture_report_suppress after insert or update on public.grader_report_email_suppression for each row execute function public.grader_nurture_report_suppression();

create function public.grader_nurture_operations() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('paused',paused,'revision',revision,'updatedAt',updated_at,
    'enrollments',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.grader_nurture_enrollments group by status) s),'{}'::jsonb),
    'delivery',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.grader_nurture_outbox group by status) s),'{}'::jsonb),
    'usage',jsonb_build_object('day',coalesce((select count from public.grader_nurture_usage where bucket='day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD')),0),'month',coalesce((select count from public.grader_nurture_usage where bucket='month:'||to_char(now() at time zone 'UTC','YYYY-MM')),0))) from public.grader_nurture_control where id;
$$;
create function public.grader_set_nurture_pause(p_actor uuid,p_revision integer,p_paused boolean,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_actor is null or p_revision is null or p_paused is null or p_reason is null or length(p_reason) not between 8 and 500 then raise exception 'invalid_nurture_pause';end if;
  perform 1 from public.grader_nurture_control where id and revision=p_revision for update;
  if not found then return '{"error":"revision_conflict"}'::jsonb;end if;
  update public.grader_nurture_control set paused=p_paused,revision=revision+1,updated_at=now() where id;
  insert into public.grader_nurture_admin_events(actor,paused,revision,reason) values(p_actor,p_paused,p_revision+1,p_reason);
  return public.grader_nurture_operations();
end;
$$;

create function public.grader_export_nurture(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select public.grader_nurture_state(p_user_id)||jsonb_build_object('consentEvents',coalesce((select jsonb_agg(jsonb_build_object('granted',c.granted,'version',c.version,'text',c.text,'source',c.source,'recordedAt',c.recorded_at) order by c.recorded_at) from public.grader_nurture_consent_events c join public.grader_nurture_enrollments e on e.id=c.enrollment_id join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb),'messages',coalesce((select jsonb_agg(jsonb_build_object('step',o.step,'status',o.status,'createdAt',o.created_at,'updatedAt',o.updated_at,'deliveryEvent',o.delivery_event) order by o.step) from public.grader_nurture_outbox o join public.grader_nurture_enrollments e on e.id=o.enrollment_id join public.grader_workspaces w on w.id=e.workspace_id where w.owner_user_id=p_user_id),'[]'::jsonb));
$$;

create function public.grader_purge_nurture() returns void
language plpgsql security invoker set search_path='' as $$
begin
  -- Terminal payloads are already scrubbed at transition; clear any abandoned payload after its retry window.
  update public.grader_nurture_outbox set message=null where message is not null and retry_deadline<=now();
  delete from public.grader_nurture_delivery_events where recorded_at<now()-interval '90 days';
  delete from public.grader_nurture_admin_events where recorded_at<now()-interval '3 years';
  delete from public.grader_nurture_enrollments where status<>'active' and updated_at<now()-interval '3 years';
  delete from public.grader_nurture_usage where (bucket like 'day:%' and substring(bucket from 5)<to_char(now()-interval '14 months','YYYY-MM-DD')) or (bucket like 'month:%' and substring(bucket from 7)<to_char(now()-interval '14 months','YYYY-MM'));
  -- Suppression digests persist so a bounce/complaint cannot be undone by deletion and re-registration.
end;
$$;

do $$ declare n text;begin
  foreach n in array array['grader_nurture_control','grader_nurture_enrollments','grader_nurture_consent_events','grader_nurture_outbox','grader_nurture_usage','grader_nurture_suppression','grader_nurture_delivery_events','grader_nurture_admin_events'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated',n);
    execute format('grant all on public.%I to service_role',n);
  end loop;
end $$;
do $$ declare r record;begin
  for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'grader_nurture_%' or p.proname in ('grader_enroll_nurture','grader_withdraw_nurture','grader_reserve_nurture_batch','grader_record_nurture_workflow','grader_release_nurture_dispatch','grader_claim_nurture','grader_preflight_nurture','grader_finish_nurture','grader_abort_nurture','grader_record_nurture_event','grader_set_nurture_pause','grader_export_nurture','grader_purge_nurture')) loop
    execute format('revoke execute on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;
