-- Run only in a NEW, DEDICATED Supabase project. Refuses an existing application database.
begin;
do $$
begin
  if to_regclass('public.jh_app_identity') is null and exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f')
  ) then
    raise exception 'Refusing installation: public schema is not empty. Create a dedicated Supabase project.';
  end if;
end $$;

create table if not exists public.jh_app_identity (
  singleton boolean primary key default true check (singleton),
  app text not null check (app='personal-remote-job-hunter/v1')
);
insert into public.jh_app_identity values (true,'personal-remote-job-hunter/v1') on conflict do nothing;
create table if not exists public.jh_jobs (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  status text not null default 'New' check (status in ('New','Interested','Applied','Interviewing','Rejected','Offer')),
  notes text not null default '', status_updated_at timestamptz not null default now()
);
create index if not exists jh_jobs_status on public.jh_jobs(status, last_seen desc);
create table if not exists public.jh_source_health (
  id bigint generated always as identity primary key, checked_at timestamptz not null default now(), payload jsonb not null
);
create table if not exists public.jh_digests (
  id uuid primary key default gen_random_uuid(), day date not null, recipient text not null, sender text not null,
  state text not null default 'pending' check (state in ('pending','sent','abandoned')),
  subject text not null, html text not null, plain_text text not null, content_hash text not null,
  job_ids text[] not null check (cardinality(job_ids)>0), created_at timestamptz not null default now(),
  sent_at timestamptz, provider_id text, lease_token uuid, lease_until timestamptz,
  unique(day,recipient)
);
create table if not exists public.jh_notifications (
  recipient text not null, job_id text not null references public.jh_jobs(id),
  digest_id uuid not null references public.jh_digests(id), sent_at timestamptz not null default now(),
  primary key(recipient,job_id)
);
create index if not exists jh_pending_digest on public.jh_digests(recipient,created_at) where state='pending';

alter table public.jh_app_identity enable row level security;
alter table public.jh_jobs enable row level security;
alter table public.jh_source_health enable row level security;
alter table public.jh_digests enable row level security;
alter table public.jh_notifications enable row level security;
revoke all on public.jh_app_identity,public.jh_jobs,public.jh_source_health,public.jh_digests,public.jh_notifications from public,anon,authenticated;
revoke all on sequence public.jh_source_health_id_seq from public,anon,authenticated;
grant all on public.jh_app_identity,public.jh_jobs,public.jh_source_health,public.jh_digests,public.jh_notifications to service_role;
grant usage, select on sequence public.jh_source_health_id_seq to service_role;

create or replace function public.jh_identity() returns text language sql security definer set search_path=public,pg_temp as $$
  select app from public.jh_app_identity where singleton=true;
$$;
create or replace function public.jh_upsert_jobs(p_jobs jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.jh_jobs(id,payload)
  select j->>'id',j from jsonb_array_elements(p_jobs) j
  on conflict(id) do update set payload=excluded.payload,last_seen=now();
end $$;
create or replace function public.jh_record_health(p_health jsonb) returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.jh_source_health(payload) values(p_health);
$$;
create or replace function public.jh_notification_state(p_recipient text) returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'notified',coalesce((select jsonb_agg(job_id) from public.jh_notifications where recipient=p_recipient),'[]'::jsonb),
    'tracked',coalesce((select jsonb_agg(id) from public.jh_jobs where status<>'New'),'[]'::jsonb)
  );
$$;

create or replace function public.jh_prepare_digest(
  p_day date,p_recipient text,p_sender text,p_lease_token uuid,p_job_ids text[],p_subject text,p_html text,p_text text,p_content_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.jh_digests; lease uuid;
begin
  -- Serialize reservations across days and across concurrent machines for this recipient.
  perform pg_advisory_xact_lock(hashtextextended(p_recipient,0));
  select * into d from public.jh_digests where recipient=p_recipient and state='pending' order by created_at limit 1 for update;
  if not found then
    select * into d from public.jh_digests where recipient=p_recipient and day=p_day for update;
    if found then return jsonb_build_object('state',d.state); end if;
    if cardinality(p_job_ids)=0 then return jsonb_build_object('state','empty'); end if;
    if exists (
      select 1 from unnest(p_job_ids) x
      where not exists(select 1 from public.jh_jobs j where j.id=x and j.status='New')
      or exists(select 1 from public.jh_notifications n where n.recipient=p_recipient and n.job_id=x)
    ) then return jsonb_build_object('state','stale'); end if;
    insert into public.jh_digests(day,recipient,sender,subject,html,plain_text,content_hash,job_ids)
    values(p_day,p_recipient,p_sender,p_subject,p_html,p_text,p_content_hash,p_job_ids) returning * into d;
  end if;
  if d.created_at <= now()-interval '23 hours' then
    return jsonb_build_object('state','needs_reconciliation','id',d.id);
  end if;
  if d.lease_until>now() then
    if d.lease_token=p_lease_token then return to_jsonb(d); end if;
    return jsonb_build_object('state','busy');
  end if;
  lease:=p_lease_token;
  update public.jh_digests set lease_token=lease,lease_until=now()+interval '5 minutes' where id=d.id returning * into d;
  return to_jsonb(d);
end $$;

create or replace function public.jh_complete_digest(p_id uuid,p_lease_token uuid,p_provider_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.jh_digests;
begin
  select * into d from public.jh_digests where id=p_id for update;
  if not found then raise exception 'Unknown digest'; end if;
  if d.state='sent' then return; end if;
  if d.state<>'pending' or d.lease_token is distinct from p_lease_token then raise exception 'Digest lease mismatch'; end if;
  insert into public.jh_notifications(recipient,job_id,digest_id)
    select d.recipient,unnest(d.job_ids),d.id on conflict do nothing;
  update public.jh_digests set state='sent',provider_id=p_provider_id,sent_at=now(),lease_until=null,lease_token=null where id=p_id;
end $$;
create or replace function public.jh_release_digest(p_id uuid,p_lease_token uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.jh_digests set lease_until=null,lease_token=null where id=p_id and state='pending' and lease_token=p_lease_token;
$$;
create or replace function public.jh_track(p_id text,p_status text,p_notes text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.jh_jobs set status=p_status,notes=p_notes,status_updated_at=now() where id=p_id;
  return found;
end $$;
create or replace function public.jh_list_jobs(p_status text default null) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from (
    select id,status,notes,payload->>'title' as title,payload->>'company' as company,payload->>'applicationUrl' as url,last_seen
    from public.jh_jobs where p_status is null or status=p_status order by last_seen desc limit 100
  ) j;
$$;
-- PostgreSQL grants EXECUTE to PUBLIC by default. Restrict every application RPC explicitly.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'jh\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
commit;
