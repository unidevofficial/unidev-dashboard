-- =====================================================================
-- 로컬 전용: Supabase 호환 준비 스크립트 (Supabase로 이전하지 않는다)
--
-- Supabase에 기본으로 있는 역할·auth 스키마·기본 권한을 로컬 PostgreSQL에
-- 똑같이 만들어, db/migrations의 SQL을 수정 없이 양쪽에 적용할 수 있게 한다.
--
-- psql 변수: authenticator_password (PostgREST 접속용 비밀번호)
--
-- 테스트에서 사용자 흉내 내기:
--   begin;
--   set local role authenticated;
--   set local request.jwt.claim.sub = '<auth uuid>';
--   ...
--   rollback;
-- =====================================================================

-- 역할은 클러스터 단위이므로 이미 있으면 건너뛴다.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$$;

alter role authenticator with login noinherit password :'authenticator_password';
grant anon, authenticated, service_role to authenticator;
-- 테스트 스크립트를 실행하는 관리자 계정이 set role 할 수 있도록
grant anon, authenticated, service_role to current_user;

-- ---------------------------------------------------------------------
-- auth 스키마 (Supabase와 같은 정의)
-- ---------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- 로그인 사용자 (Supabase auth.users의 필요한 부분만). 비밀번호는 Supabase와 같이 bcrypt로 저장한다.
-- 로컬 개발 서버(scripts/dev-server.mjs)가 이 표로 아이디·비밀번호 로그인을 흉내 낸다.
create extension if not exists pgcrypto;
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  last_sign_in_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- public 스키마 기본 권한 (Supabase 기본값과 동일: 권한은 RLS로 통제)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
