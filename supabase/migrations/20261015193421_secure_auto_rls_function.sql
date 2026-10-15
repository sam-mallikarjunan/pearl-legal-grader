-- Keep Supabase's automatic RLS trigger enabled while closing direct API execution.
-- Some local or older projects do not install this optional helper.
do $secure_auto_rls$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$secure_auto_rls$;
