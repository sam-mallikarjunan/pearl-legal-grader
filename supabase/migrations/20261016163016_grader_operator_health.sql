create function public.grader_operator_health() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_day date:=(clock_timestamp() at time zone 'UTC')::date; v_month date:=date_trunc('month',clock_timestamp() at time zone 'UTC')::date; v_mail jsonb:=null;
begin
  if to_regclass('public.grader_report_email_outbox') is not null then
    select jsonb_build_object('day',coalesce((select count from public.grader_report_email_usage where bucket='day:'||v_day::text),0),'month',coalesce((select count from public.grader_report_email_usage where bucket='month:'||to_char(v_month,'YYYY-MM')),0),'statuses',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from public.grader_report_email_outbox group by status) as states),'{}'::jsonb)) into v_mail;
  end if;
  return jsonb_build_object(
    'asOf',clock_timestamp(),
    'scans',jsonb_build_object('day',coalesce((select used from public.website_scan_usage where period_kind='day' and period_start=v_day),0),'month',coalesce((select used from public.website_scan_usage where period_kind='month' and period_start=v_month),0),'statuses',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from public.website_scan_jobs group by status) as states),'{}'::jsonb)),
    'signInCodes',jsonb_build_object('day',(select count(*) from public.grader_auth_requests where kind='request' and created_at>=v_day::timestamp at time zone 'UTC'),'month',coalesce((select used from public.grader_auth_usage where month_start=v_month),0)),
    'reportEmails',v_mail,
    'accounts',jsonb_build_object('workspaces',(select count(*) from public.grader_workspaces),'reports',(select count(*) from public.grader_reports))
  );
end;
$$;
revoke execute on function public.grader_operator_health() from public,anon,authenticated;
grant execute on function public.grader_operator_health() to service_role;
