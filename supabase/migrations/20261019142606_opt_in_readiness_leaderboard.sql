-- Explicit anonymous-public publication is separate from the old interest preference.
-- Server authentication supplies identity. Neither client role can access these objects.
create table public.grader_leaderboard_entries (
  workspace_id uuid primary key references public.grader_workspaces(id) on delete cascade,
  alias text not null unique check (alias ~ '^Practice-[A-F0-9]{12}$'),
  report_id uuid not null references public.grader_reports(id) on delete cascade,
  published boolean not null default false,
  consent_version text not null check (consent_version='anonymous-operating-readiness-v1'),
  consent_text text not null check (length(consent_text) between 20 and 1000),
  revision integer not null default 1 check (revision>=1),
  updated_at timestamptz not null default clock_timestamp()
);
create index grader_leaderboard_report_idx on public.grader_leaderboard_entries(report_id);
create table public.grader_leaderboard_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
  report_id uuid references public.grader_reports(id) on delete set null,
  action text not null check (action in ('published','withdrawn')),
  consent_version text not null,
  consent_text text not null check (length(consent_text) between 20 and 1000),
  recorded_at timestamptz not null default clock_timestamp()
);
create index grader_leaderboard_events_workspace_time_idx on public.grader_leaderboard_events(workspace_id,recorded_at desc);
create index grader_leaderboard_events_report_idx on public.grader_leaderboard_events(report_id);
alter table public.grader_leaderboard_entries enable row level security;
alter table public.grader_leaderboard_events enable row level security;
revoke all on public.grader_leaderboard_entries,public.grader_leaderboard_events from public,anon,authenticated;
grant select,insert,update,delete on public.grader_leaderboard_entries to service_role;
grant select,insert,delete on public.grader_leaderboard_events to service_role;

create function public.grader_leaderboard_own_json(p_workspace uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce((select jsonb_build_object('published',l.published,'alias',l.alias,'reportId',l.report_id,'revision',l.revision,'updatedAt',l.updated_at) from public.grader_leaderboard_entries l where l.workspace_id=p_workspace),'{"published":false,"alias":null,"reportId":null,"revision":0,"updatedAt":null}'::jsonb);
$$;
create function public.grader_leaderboard_read_own(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select public.grader_leaderboard_own_json((select id from public.grader_workspaces where owner_user_id=p_user_id));
$$;
-- Structural checks supplement deterministic score reproduction in the server adapter.
create function public.grader_leaderboard_report_eligible(p_report uuid,p_workspace uuid,p_release text) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.grader_reports r join public.grader_config_releases c on c.id=p_release
    join public.grader_config_active a on a.release_id=c.id and a.singleton
    where r.id=p_report and r.workspace_id=p_workspace
      and r.snapshot->>'isSample'='false'
      and r.snapshot#>>'{assessment,releaseId}'=p_release
      and r.snapshot#>'{assessment,releaseSnapshot}'=c.snapshot
      and jsonb_typeof(r.snapshot#>'{assessment,overallScore}')='number'
      and case when jsonb_typeof(r.snapshot#>'{assessment,coverage}')='number' then (r.snapshot#>>'{assessment,coverage}')::numeric>=0.8 else false end
      and jsonb_typeof(r.snapshot#>'{assessment,domains}')='array'
      and not exists(select 1 from jsonb_array_elements(r.snapshot#>'{assessment,domains}') d where d->>'status'='incomplete')
      and r.snapshot->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      and r.snapshot->>'createdAt'>=to_char((clock_timestamp()-interval '90 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      and r.snapshot->>'createdAt'<=to_char((clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
create function public.grader_leaderboard_publish(p_user_id uuid,p_report_id uuid,p_revision integer,p_alias text,p_release_id text,p_consent_version text,p_consent_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid; v_current public.grader_leaderboard_entries%rowtype;
begin
  if p_user_id is null or p_revision is null or p_revision<0 or p_alias is null or p_alias !~ '^Practice-[A-F0-9]{12}$' or p_consent_version is distinct from 'anonymous-operating-readiness-v1' or p_consent_text is null or length(p_consent_text) not between 20 and 1000 then raise exception 'invalid_publication'; end if;
  v_workspace:=public.grader_ensure_workspace(p_user_id);
  perform 1 from public.grader_workspaces where id=v_workspace for update;
  if not exists(select 1 from public.grader_reports where id=p_report_id and workspace_id=v_workspace) then return '{"error":"not_found"}'::jsonb; end if;
  select * into v_current from public.grader_leaderboard_entries where workspace_id=v_workspace for update;
  if coalesce(v_current.revision,0)<>p_revision then return '{"error":"revision_conflict"}'::jsonb; end if;
  if not exists(select 1 from public.grader_config_active where singleton and release_id=p_release_id) then return '{"error":"release_conflict"}'::jsonb; end if;
  if not public.grader_leaderboard_report_eligible(p_report_id,v_workspace,p_release_id) then return '{"error":"ineligible_report"}'::jsonb; end if;
  if v_current.published and v_current.report_id=p_report_id then return public.grader_leaderboard_own_json(v_workspace); end if;
  if (select count(*) from public.grader_leaderboard_events where workspace_id=v_workspace and action='published' and recorded_at>clock_timestamp()-interval '24 hours')>=10 then return '{"error":"publication_limit"}'::jsonb; end if;
  insert into public.grader_leaderboard_entries(workspace_id,alias,report_id,published,consent_version,consent_text)
    values(v_workspace,p_alias,p_report_id,true,p_consent_version,p_consent_text)
    on conflict(workspace_id) do update set report_id=excluded.report_id,published=true,consent_version=excluded.consent_version,consent_text=excluded.consent_text,revision=grader_leaderboard_entries.revision+1,updated_at=clock_timestamp();
  insert into public.grader_leaderboard_events(workspace_id,report_id,action,consent_version,consent_text) values(v_workspace,p_report_id,'published',p_consent_version,p_consent_text);
  return public.grader_leaderboard_own_json(v_workspace);
end;
$$;
create function public.grader_leaderboard_withdraw(p_user_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_workspace uuid; v_current public.grader_leaderboard_entries%rowtype;
begin
  if p_user_id is null or p_revision is null or p_revision<0 then raise exception 'invalid_revision'; end if;
  select id into v_workspace from public.grader_workspaces where owner_user_id=p_user_id for update;
  select * into v_current from public.grader_leaderboard_entries where workspace_id=v_workspace for update;
  if coalesce(v_current.revision,0)<>p_revision then return '{"error":"revision_conflict"}'::jsonb; end if;
  if v_current.published is distinct from true then return public.grader_leaderboard_own_json(v_workspace); end if;
  update public.grader_leaderboard_entries set published=false,revision=revision+1,updated_at=clock_timestamp() where workspace_id=v_workspace;
  insert into public.grader_leaderboard_events(workspace_id,report_id,action,consent_version,consent_text) values(v_workspace,v_current.report_id,'withdrawn',v_current.consent_version,v_current.consent_text);
  return public.grader_leaderboard_own_json(v_workspace);
end;
$$;
create function public.grader_leaderboard_source_page(p_release_id text,p_after uuid default null,p_limit integer default 10) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 10 then raise exception 'invalid_leaderboard_page'; end if;
  return (select coalesce(jsonb_agg(payload order by workspace_id),'[]'::jsonb) from (
    select l.workspace_id,jsonb_build_object('workspaceId',l.workspace_id,'reportId',l.report_id,'alias',l.alias,'published',true,'consentVersion',l.consent_version,'revision',l.revision,'report',r.snapshot) payload
      from public.grader_leaderboard_entries l join public.grader_reports r on r.id=l.report_id and r.workspace_id=l.workspace_id
      where l.published and l.consent_version='anonymous-operating-readiness-v1' and (p_after is null or l.workspace_id>p_after)
        and public.grader_leaderboard_report_eligible(l.report_id,l.workspace_id,p_release_id)
      order by l.workspace_id limit p_limit
  ) rows);
end;
$$;
create function public.grader_leaderboard_current_publications(p_selections jsonb,p_release_id text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_selections) is distinct from 'array' or jsonb_array_length(p_selections)>1000 then raise exception 'invalid_leaderboard_selection'; end if;
  return (select coalesce(jsonb_agg(l.workspace_id),'[]'::jsonb)
    from public.grader_leaderboard_entries l
    where l.published and l.consent_version='anonymous-operating-readiness-v1'
      and public.grader_leaderboard_report_eligible(l.report_id,l.workspace_id,p_release_id)
      and exists(select 1 from jsonb_array_elements(p_selections) s where s->>'workspaceId'=l.workspace_id::text and s->>'reportId'=l.report_id::text and s->>'revision'=l.revision::text));
end;
$$;
create function public.grader_leaderboard_export_own(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('enrollment',public.grader_leaderboard_own_json(w.id),'consentEvents',coalesce((select jsonb_agg(e.payload order by e.recorded_at desc) from (select recorded_at,jsonb_build_object('action',action,'reportId',report_id,'consentVersion',consent_version,'consentText',consent_text,'recordedAt',recorded_at) payload from public.grader_leaderboard_events where workspace_id=w.id order by recorded_at desc limit 1000) e),'[]'::jsonb),'historyTruncated',(select count(*)>1000 from public.grader_leaderboard_events where workspace_id=w.id))
    from (select (select id from public.grader_workspaces where owner_user_id=p_user_id) id) w;
$$;
revoke all on function public.grader_leaderboard_own_json(uuid),public.grader_leaderboard_read_own(uuid),public.grader_leaderboard_report_eligible(uuid,uuid,text),public.grader_leaderboard_publish(uuid,uuid,integer,text,text,text,text),public.grader_leaderboard_withdraw(uuid,integer),public.grader_leaderboard_source_page(text,uuid,integer),public.grader_leaderboard_current_publications(jsonb,text),public.grader_leaderboard_export_own(uuid) from public,anon,authenticated;
grant execute on function public.grader_leaderboard_own_json(uuid),public.grader_leaderboard_read_own(uuid),public.grader_leaderboard_report_eligible(uuid,uuid,text),public.grader_leaderboard_publish(uuid,uuid,integer,text,text,text,text),public.grader_leaderboard_withdraw(uuid,integer),public.grader_leaderboard_source_page(text,uuid,integer),public.grader_leaderboard_current_publications(jsonb,text),public.grader_leaderboard_export_own(uuid) to service_role;
