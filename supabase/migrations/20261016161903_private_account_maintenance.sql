create function public.grader_auth_purge() returns integer
language plpgsql security invoker set search_path='' as $$
declare v_deleted integer;
begin
  delete from public.grader_auth_requests where created_at<clock_timestamp()-interval '2 days';
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;
revoke execute on function public.grader_auth_purge() from public,anon,authenticated;
grant execute on function public.grader_auth_purge() to service_role;
