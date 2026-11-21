-- Minimal emulation of Supabase's auth schema + roles so migrations and RLS run locally.
do $$begin create role anon nologin; exception when duplicate_object then null; end$$;
do $$begin create role authenticated nologin; exception when duplicate_object then null; end$$;
do $$begin create role service_role nologin bypassrls; exception when duplicate_object then null; end$$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants table privileges broadly and relies on RLS:
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- Minimal Storage API schema for private-bucket migration/RLS tests.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner_id uuid, created_at timestamptz default now(), unique(bucket_id,name)
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant all on storage.buckets, storage.objects to authenticated, service_role;
grant execute on function storage.foldername(text) to authenticated, service_role;

create or replace function storage.extension(name text) returns text language sql immutable as $$ select lower(split_part(name,'.',array_length(string_to_array(name,'.'),1))) $$;
grant execute on function storage.extension(text) to authenticated, service_role;
