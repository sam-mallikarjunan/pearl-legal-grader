-- Hashed request identifiers only; counters are independent of browser sessions.
create table public.grader_auth_requests (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('request','verify')),
  email_hash text not null check (email_hash ~ '^[a-f0-9]{64}$'),
  client_hash text not null check (client_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create index grader_auth_requests_email_time on public.grader_auth_requests(email_hash,kind,created_at desc);
create index grader_auth_requests_client_time on public.grader_auth_requests(client_hash,kind,created_at desc);
create table public.grader_auth_usage (
  month_start date primary key,
  used integer not null default 0 check(used>=0)
);
alter table public.grader_auth_requests enable row level security;
alter table public.grader_auth_usage enable row level security;
revoke all on public.grader_auth_requests,public.grader_auth_usage from public,anon,authenticated;
grant all on public.grader_auth_requests,public.grader_auth_usage to service_role;
revoke all on sequence public.grader_auth_requests_id_seq from public,anon,authenticated;
grant usage,select on sequence public.grader_auth_requests_id_seq to service_role;

create function public.grader_auth_reserve(p_kind text,p_email_hash text,p_client_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_month date; v_email_limit integer; v_client_limit integer;
begin
  if p_kind not in ('request','verify') or p_email_hash !~ '^[a-f0-9]{64}$' or p_client_hash !~ '^[a-f0-9]{64}$' then raise exception 'auth_invalid'; end if;
  perform pg_advisory_xact_lock(763045210);
  delete from public.grader_auth_requests where created_at<v_now-interval '2 days';
  v_email_limit:=case when p_kind='request' then 3 else 10 end;
  v_client_limit:=case when p_kind='request' then 10 else 30 end;
  if (select count(*) from public.grader_auth_requests where email_hash=p_email_hash and kind=p_kind and created_at>v_now-interval '1 hour')>=v_email_limit
    or (select count(*) from public.grader_auth_requests where client_hash=p_client_hash and kind=p_kind and created_at>v_now-interval '1 hour')>=v_client_limit then raise exception 'auth_limit'; end if;
  if p_kind='request' then
    v_month:=date_trunc('month',v_now at time zone 'UTC')::date;
    insert into public.grader_auth_usage(month_start) values(v_month) on conflict do nothing;
    if (select used from public.grader_auth_usage where month_start=v_month)>=500 or (select count(*) from public.grader_auth_requests where kind='request' and created_at>=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC')>=50 then raise exception 'auth_limit'; end if;
    update public.grader_auth_usage set used=used+1 where month_start=v_month;
  end if;
  insert into public.grader_auth_requests(kind,email_hash,client_hash,created_at) values(p_kind,p_email_hash,p_client_hash,v_now);
  return true;
end;
$$;
revoke execute on function public.grader_auth_reserve(text,text,text) from public,anon,authenticated;
grant execute on function public.grader_auth_reserve(text,text,text) to service_role;
