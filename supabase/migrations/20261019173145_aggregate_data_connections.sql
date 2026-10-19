-- Write-only automation credentials and reviewed aggregate deliveries. Neither
-- browser role can access these tables/functions; HTTP derives the owner.
create table public.grader_data_connections (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
 token_hash text unique check(token_hash is null or token_hash~'^[a-f0-9]{64}$'),
 hint text not null check(hint~'^[A-Za-z0-9_-]{4}$'),
 revision integer not null default 0 check(revision between 0 and 1000000),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '30 days',
 revoked_at timestamptz,
 last_received_at timestamptz,
 check((revoked_at is null and token_hash is not null) or (revoked_at is not null and token_hash is null))
);
create index grader_data_connections_owner_idx on public.grader_data_connections(workspace_id,created_at);
create table public.grader_data_deliveries (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.grader_workspaces(id) on delete cascade,
 connection_id uuid not null references public.grader_data_connections(id) on delete cascade,
 request_id uuid not null,
 content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
 periods jsonb,
 period_count integer not null check(period_count between 1 and 24),
 status text not null default 'pending' check(status in ('pending','imported','discarded','expired')),
 revision integer not null default 0 check(revision between 0 and 1000000),
 import_batch_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 unique(workspace_id,request_id),
 check((status='pending' and periods is not null and jsonb_typeof(periods)='array' and jsonb_array_length(periods)=period_count and octet_length(periods::text)<=64000) or (status<>'pending' and periods is null)),
 check((status='imported' and import_batch_id is not null) or (status<>'imported' and import_batch_id is null))
);
create index grader_data_deliveries_connection_idx on public.grader_data_deliveries(connection_id);
create index grader_data_deliveries_owner_idx on public.grader_data_deliveries(workspace_id,created_at);
create index grader_data_deliveries_expiry_idx on public.grader_data_deliveries(expires_at,id) where status='pending';

create function public.grader_data_connection_json(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'revision',revision,'hint',hint,'createdAt',created_at,'expiresAt',expires_at,'revokedAt',revoked_at,'lastReceivedAt',last_received_at) from public.grader_data_connections where id=p_id;
$$;
create function public.grader_data_delivery_json(p_id uuid,p_details boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'revision',revision,'connectionId',connection_id,'createdAt',created_at,'expiresAt',expires_at,'status',status,'periodCount',period_count,'importBatchId',import_batch_id)
 ||case when p_details then jsonb_build_object('periods',periods) else '{}'::jsonb end from public.grader_data_deliveries where id=p_id;
$$;
create function public.grader_expire_data_deliveries(p_workspace uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 with due as (select id from public.grader_data_deliveries where status='pending' and expires_at<=clock_timestamp() and (p_workspace is null or workspace_id=p_workspace) order by expires_at,id limit 500 for update skip locked)
 update public.grader_data_deliveries d set status='expired',periods=null,revision=least(d.revision+1,1000000) from due where d.id=due.id;
 get diagnostics n=row_count;
 return jsonb_build_object('expired',n);
end;
$$;
create function public.grader_data_periods_valid(p_periods jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare item jsonb;v jsonb;s date;e date;r daterange;seen daterange[]:=array[]::daterange[];
begin
 if jsonb_typeof(p_periods) is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_periods) not between 1 and 24 or octet_length(p_periods::text)>64000 then return false;end if;
 for item in select value from jsonb_array_elements(p_periods) loop
  if jsonb_typeof(item) is distinct from 'object' then return false;end if;
  if (select count(*) from jsonb_object_keys(item))<>14 or item->>'source' is distinct from 'export' or item->'baselineReportId' is distinct from 'null'::jsonb
   or item->>'currency' is null or item->>'currency' not in ('USD','CAD','GBP','EUR','AUD','NZD','INR')
   or jsonb_typeof(item->'startDate') is distinct from 'string' or jsonb_typeof(item->'endDate') is distinct from 'string'
   or item->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' or item->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$'
   or exists(select 1 from jsonb_object_keys(item) k where not(k=any(array['startDate','endDate','source','currency','baselineReportId','inquiries','contacted','booked','attended','clients','leadSpendMinor','cohortBilledMinor','cohortCollectedMinor','adminHours']))) then return false;end if;
  s:=(item->>'startDate')::date;e:=(item->>'endDate')::date;
  if s<'1970-01-01' or e>=(clock_timestamp() at time zone 'UTC')::date or e-s+1 not between 7 and 366 then return false;end if;
  v:=item-'startDate'-'endDate'-'source'-'currency'-'baselineReportId';
  if not public.grader_outcome_values_valid(v,e-s+1) then return false;end if;
  foreach r in array seen loop if r&&daterange(s,e,'[]') then return false;end if;end loop;
  seen:=array_append(seen,daterange(s,e,'[]'));
 end loop;
 return true;
exception when others then return false;
end;
$$;
create function public.grader_read_data_connections(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(public.grader_data_connection_json(c.id) order by c.created_at desc,c.id),'[]'::jsonb) from public.grader_data_connections c join public.grader_workspaces w on w.id=c.workspace_id where w.owner_user_id=p_user_id;
$$;
create function public.grader_create_data_connection(p_user_id uuid,p_hash text,p_hint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;c uuid;
begin
 if p_user_id is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_hint is null or p_hint !~ '^[A-Za-z0-9_-]{4}$' then raise exception 'invalid_data_delivery';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 w:=public.grader_ensure_workspace(p_user_id);
 if (select count(*) from public.grader_data_connections where workspace_id=w)>=24 or (select count(*) from public.grader_data_connections where workspace_id=w and revoked_at is null and expires_at>clock_timestamp())>=3 then return '{"error":"data_connection_limit"}';end if;
 insert into public.grader_data_connections(workspace_id,token_hash,hint) values(w,p_hash,p_hint) returning id into c;
 return public.grader_data_connection_json(c);
end;
$$;
create function public.grader_revoke_data_connection(p_user_id uuid,p_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.grader_data_connections%rowtype;
begin
 if p_user_id is null or p_id is null or p_revision is null or p_revision not between 0 and 999999 then raise exception 'invalid_data_delivery';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select x.* into c from public.grader_data_connections x join public.grader_workspaces w on w.id=x.workspace_id where x.id=p_id and w.owner_user_id=p_user_id for update of x;
 if not found then return '{"error":"data_not_found"}';end if;
 if c.revision<>p_revision then return '{"error":"data_revision_conflict"}';end if;
 if c.revoked_at is not null then return public.grader_data_connection_json(c.id);end if;
 update public.grader_data_connections set token_hash=null,revoked_at=clock_timestamp(),revision=revision+1 where id=c.id;
 return public.grader_data_connection_json(c.id);
end;
$$;
create function public.grader_receive_data_delivery(p_token_hash text,p_request uuid,p_hash text,p_periods jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.grader_data_connections%rowtype;d public.grader_data_deliveries%rowtype;owner_id uuid;duplicate boolean:=false;
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return '{"error":"invalid_connection_key"}';end if;
 select x.* into c from public.grader_data_connections x join public.grader_workspaces w on w.id=x.workspace_id where x.token_hash=p_token_hash and x.revoked_at is null and x.expires_at>clock_timestamp();
 if not found then return '{"error":"invalid_connection_key"}';end if;
 select owner_user_id into owner_id from public.grader_workspaces where id=c.workspace_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,82991));
 select * into c from public.grader_data_connections where id=c.id and token_hash=p_token_hash and revoked_at is null and expires_at>clock_timestamp() for update;
 if not found then return '{"error":"invalid_connection_key"}';end if;
 if p_request is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or not public.grader_data_periods_valid(p_periods) then return '{"error":"invalid_data_delivery"}';end if;
 perform public.grader_expire_data_deliveries(c.workspace_id);
 select * into d from public.grader_data_deliveries where workspace_id=c.workspace_id and request_id=p_request;
 if found then
  if d.content_hash is distinct from p_hash then return '{"error":"data_delivery_conflict"}';end if;
  duplicate:=true;
 else
  if (select count(*) from public.grader_data_deliveries where workspace_id=c.workspace_id)>=100
   or (select count(*) from public.grader_data_deliveries where workspace_id=c.workspace_id and status='pending')>=5
   or (select count(*) from public.grader_data_deliveries where workspace_id=c.workspace_id and created_at>=clock_timestamp()-interval '1 day')>=10 then return '{"error":"data_delivery_limit"}';end if;
  insert into public.grader_data_deliveries(workspace_id,connection_id,request_id,content_hash,periods,period_count) values(c.workspace_id,c.id,p_request,p_hash,p_periods,jsonb_array_length(p_periods)) returning * into d;
  update public.grader_data_connections set last_received_at=clock_timestamp() where id=c.id;
 end if;
 return jsonb_build_object('deliveryId',d.id,'status',d.status,'periodCount',d.period_count,'duplicate',duplicate);
end;
$$;
create function public.grader_read_data_deliveries(p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;v jsonb;
begin
 select id into w from public.grader_workspaces where owner_user_id=p_user_id;
 if w is null then return '[]';end if;
 perform public.grader_expire_data_deliveries(w);
 select coalesce(jsonb_agg(public.grader_data_delivery_json(id) order by created_at desc,id),'[]'::jsonb) into v from public.grader_data_deliveries where workspace_id=w;
 return v;
end;
$$;
create function public.grader_read_data_delivery(p_user_id uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;
begin
 select id into w from public.grader_workspaces where owner_user_id=p_user_id;
 if w is null then return '{"error":"data_not_found"}';end if;
 perform public.grader_expire_data_deliveries(w);
 if not exists(select 1 from public.grader_data_deliveries where id=p_id and workspace_id=w) then return '{"error":"data_not_found"}';end if;
 return public.grader_data_delivery_json(p_id,true);
end;
$$;
create function public.grader_accept_data_delivery(p_user_id uuid,p_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.grader_data_deliveries%rowtype;v jsonb;
begin
 if p_user_id is null or p_id is null or p_revision is null or p_revision not between 0 and 999999 then raise exception 'invalid_data_delivery';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select x.* into d from public.grader_data_deliveries x join public.grader_workspaces w on w.id=x.workspace_id where x.id=p_id and w.owner_user_id=p_user_id for update of x;
 if not found then return '{"error":"data_not_found"}';end if;
 if d.status='imported' then return jsonb_build_object('delivery',public.grader_data_delivery_json(d.id,true),'result',public.grader_outcome_import_json(d.import_batch_id,false));end if;
 if d.status='pending' and d.expires_at<=clock_timestamp() then update public.grader_data_deliveries set status='expired',periods=null,revision=revision+1 where id=d.id;return '{"error":"data_delivery_closed"}';end if;
 if d.status<>'pending' then return '{"error":"data_delivery_closed"}';end if;
 if d.revision<>p_revision then return '{"error":"data_revision_conflict"}';end if;
 v:=public.grader_import_outcome_periods(p_user_id,d.id,d.content_hash,d.periods);
 if v?'error' then return v;end if;
 update public.grader_data_deliveries set status='imported',periods=null,import_batch_id=(v->>'batchId')::uuid,revision=revision+1 where id=d.id;
 return jsonb_build_object('delivery',public.grader_data_delivery_json(d.id,true),'result',v);
end;
$$;
create function public.grader_discard_data_delivery(p_user_id uuid,p_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.grader_data_deliveries%rowtype;
begin
 if p_user_id is null or p_id is null or p_revision is null or p_revision not between 0 and 999999 then raise exception 'invalid_data_delivery';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,82991));
 select x.* into d from public.grader_data_deliveries x join public.grader_workspaces w on w.id=x.workspace_id where x.id=p_id and w.owner_user_id=p_user_id for update of x;
 if not found then return '{"error":"data_not_found"}';end if;
 if d.status<>'pending' then return '{"error":"data_delivery_closed"}';end if;
 if d.revision<>p_revision then return '{"error":"data_revision_conflict"}';end if;
 update public.grader_data_deliveries set status='discarded',periods=null,revision=revision+1 where id=d.id;
 return public.grader_data_delivery_json(d.id,true);
end;
$$;
create function public.grader_export_data_integrations(p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid;v jsonb;
begin
 select id into w from public.grader_workspaces where owner_user_id=p_user_id;
 if w is null then return '{"connections":[],"deliveries":[]}';end if;
 perform public.grader_expire_data_deliveries(w);
 select coalesce(jsonb_agg(public.grader_data_delivery_json(id,true) order by created_at,id),'[]'::jsonb) into v from public.grader_data_deliveries where workspace_id=w;
 return jsonb_build_object('connections',public.grader_read_data_connections(p_user_id),'deliveries',v);
end;
$$;
do $$declare n text;begin
 foreach n in array array['grader_data_connections','grader_data_deliveries'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on table public.%I from public,anon,authenticated',n);
  execute format('grant all on table public.%I to service_role',n);
 end loop;
end $$;
revoke execute on function public.grader_data_connection_json(uuid),public.grader_data_delivery_json(uuid,boolean),public.grader_expire_data_deliveries(uuid),public.grader_data_periods_valid(jsonb),public.grader_read_data_connections(uuid),public.grader_create_data_connection(uuid,text,text),public.grader_revoke_data_connection(uuid,uuid,integer),public.grader_receive_data_delivery(text,uuid,text,jsonb),public.grader_read_data_deliveries(uuid),public.grader_read_data_delivery(uuid,uuid),public.grader_accept_data_delivery(uuid,uuid,integer),public.grader_discard_data_delivery(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.grader_data_connection_json(uuid),public.grader_data_delivery_json(uuid,boolean),public.grader_expire_data_deliveries(uuid),public.grader_data_periods_valid(jsonb),public.grader_read_data_connections(uuid),public.grader_create_data_connection(uuid,text,text),public.grader_revoke_data_connection(uuid,uuid,integer),public.grader_receive_data_delivery(text,uuid,text,jsonb),public.grader_read_data_deliveries(uuid),public.grader_read_data_delivery(uuid,uuid),public.grader_accept_data_delivery(uuid,uuid,integer),public.grader_discard_data_delivery(uuid,uuid,integer) to service_role;
revoke execute on function public.grader_export_data_integrations(uuid) from public,anon,authenticated;
grant execute on function public.grader_export_data_integrations(uuid) to service_role;
