-- 0004 화면에서 호출하는 함수 (PostgREST RPC: /rest/v1/rpc/<함수명>)

-- ---------------------------------------------------------------------
-- 로그인한 사용자의 권한 요약 (화면 표시용. 실제 권한 통제는 RLS가 한다)
--   kind: 'staff'(운영진 개인 계정) | 'club'(동아리 대표자 계정)
-- ---------------------------------------------------------------------
create or replace function public.get_my_access() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'kind',      a.kind,
    'username',  a.username,
    'member_id', a.member_id,
    'club_id',   a.club_id,
    'name',      coalesce(m.name, c.name),
    'is_staff',  public.is_staff(),
    'is_admin',  public.is_admin(),
    'roles',     coalesce((
                   select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name) order by r.sort_order)
                     from public.role_assignments ra
                     join public.roles r on r.id = ra.role_id
                    where ra.member_id = a.member_id
                      and ra.start_on <= current_date
                      and (ra.end_on is null or ra.end_on >= current_date)
                 ), '[]'::jsonb)
  )
  from public.accounts a
  left join public.members m on m.id = a.member_id
  left join public.clubs c   on c.id = a.club_id
  where auth.uid() is not null
    and a.auth_user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- 계정 관리 (관리자 전용)
--   Supabase Auth 사용자(auth.users) 생성·삭제·비밀번호 변경은 service_role 키가 필요하므로
--   Edge Function(supabase/functions/admin-accounts)이 처리하고, accounts 행은 아래 함수로
--   관리자 본인의 권한으로 기록한다. (변경 이력에 처리자가 남도록)
-- ---------------------------------------------------------------------
create or replace function public.admin_register_account(
  p_auth_user_id uuid,
  p_username     text,
  p_kind         text,
  p_member_id    uuid default null,
  p_club_id      uuid default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '계정 관리는 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
  if p_kind = 'staff' and exists (select 1 from public.accounts where member_id = p_member_id) then
    raise exception '이 구성원에게는 이미 계정이 있습니다.';
  end if;
  if p_kind = 'club' and exists (select 1 from public.accounts where club_id = p_club_id) then
    raise exception '이 동아리에는 이미 대표자 계정이 있습니다.';
  end if;
  insert into public.accounts (auth_user_id, username, kind, member_id, club_id, password_changed_at)
  values (p_auth_user_id, lower(p_username), p_kind,
          case when p_kind = 'staff' then p_member_id end,
          case when p_kind = 'club' then p_club_id end,
          now());
end
$$;

create or replace function public.admin_remove_account(p_auth_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '계정 관리는 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
  if p_auth_user_id = auth.uid() then
    raise exception '자기 계정은 삭제할 수 없습니다.';
  end if;
  delete from public.accounts where auth_user_id = p_auth_user_id;
end
$$;

-- 비밀번호를 바꾼 시각 기록. 본인 계정은 누구나, 다른 계정(재설정)은 관리자만.
create or replace function public.mark_password_changed(p_auth_user_id uuid default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_auth_user_id, auth.uid());
begin
  if v_target is distinct from auth.uid() and not public.is_admin() then
    raise exception '다른 계정의 비밀번호는 관리자만 재설정할 수 있습니다.' using errcode = '42501';
  end if;
  update public.accounts set password_changed_at = now() where auth_user_id = v_target;
end
$$;

-- ---------------------------------------------------------------------
-- 연락처 내보내기 기록 (관리자 전용). 연락처 값 자체는 남기지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.log_contact_export(p_filter jsonb, p_count integer) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '연락처 내보내기는 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;

  insert into public.change_logs (table_name, record_id, action, after_data, actor_member_id)
  values ('members', 'export', 'export',
          jsonb_build_object('filter', coalesce(p_filter, '{}'::jsonb), 'count', p_count),
          public.current_member_id());
end
$$;

-- ---------------------------------------------------------------------
-- 보유 기간이 지난 연락처 파기 (관리자 전용, SPEC 6절)
--   1) 대상 구성원의 phone·email을 지우고 contact_purged_at 기록
--   2) change_logs에 남은 해당 구성원의 phone·email 값도 삭제
--   3) 파기 사실만 'purge'로 기록 (연락처 값은 남기지 않음)
-- ---------------------------------------------------------------------
create or replace function public.purge_expired_contacts() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_ids   uuid[];
  v_actor uuid := public.current_member_id();
begin
  if not public.is_admin() then
    raise exception '연락처 파기는 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.id), '{}') into v_ids
    from public.v_contact_purge_candidates c;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  update public.members
     set phone = null, email = null, contact_purged_at = now()
   where id = any(v_ids);

  -- 위 update가 남긴 이력(연락처가 before_data에 들어 있음)은 purge 기록으로 대체한다
  delete from public.change_logs
   where table_name = 'members'
     and action = 'update'
     and created_at = now()   -- now()는 트랜잭션 시작 시각이므로 이 함수가 만든 행만 해당
     and record_id = any(select unnest(v_ids)::text);

  -- 과거 이력에 남은 연락처 제거
  update public.change_logs
     set before_data = case when before_data is null then null else before_data - array['phone', 'email'] end,
         after_data  = case when after_data  is null then null else after_data  - array['phone', 'email'] end
   where table_name = 'members'
     and record_id = any(select unnest(v_ids)::text)
     and (before_data ?| array['phone', 'email'] or after_data ?| array['phone', 'email']);

  insert into public.change_logs (table_name, record_id, action, after_data, actor_member_id)
  select 'members', id::text, 'purge',
         jsonb_build_object('contact_purged_at', now(), 'reason', '역할 종료 후 보유 기간(1년) 경과'),
         v_actor
    from unnest(v_ids) as id;

  return cardinality(v_ids);
end
$$;

-- ---------------------------------------------------------------------
-- 대표자 교체 (한 트랜잭션): 현직 대표자 배정 종료 → 새 대표자 배정
--   security invoker: 호출자의 RLS(관리자만 배정 변경 가능)가 그대로 적용된다
-- ---------------------------------------------------------------------
create or replace function public.replace_representative(
  p_club_id   uuid,
  p_member_id uuid,
  p_start_on  date default current_date,
  p_basis     text default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_role_id smallint;
  v_new_id  uuid;
begin
  select id into v_role_id from public.roles where code = 'representative';

  update public.role_assignments
     set end_on = greatest(start_on, p_start_on - 1)
   where club_id = p_club_id
     and role_id = v_role_id
     and (end_on is null or end_on >= p_start_on);

  insert into public.role_assignments (member_id, role_id, club_id, start_on, basis)
  values (p_member_id, v_role_id, p_club_id, p_start_on, p_basis)
  returning id into v_new_id;

  return v_new_id;
end
$$;

-- ---------------------------------------------------------------------
-- 팀원 이동 (한 트랜잭션): 기존 팀 배정 종료 → 새 팀에 같은 역할로 배정
-- ---------------------------------------------------------------------
create or replace function public.move_team_assignment(
  p_assignment_id uuid,
  p_new_team_id   uuid,
  p_move_on       date default current_date,
  p_new_role_id   smallint default null,
  p_basis         text default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_old    public.role_assignments;
  v_new_id uuid;
begin
  select * into v_old from public.role_assignments where id = p_assignment_id;
  if v_old.id is null then
    raise exception '배정 기록을 찾을 수 없습니다.';
  end if;
  if v_old.team_id is null then
    raise exception '팀 배정만 이동할 수 있습니다.';
  end if;

  update public.role_assignments
     set end_on = greatest(start_on, p_move_on - 1)
   where id = p_assignment_id;

  insert into public.role_assignments (member_id, role_id, team_id, start_on, basis)
  values (v_old.member_id, coalesce(p_new_role_id, v_old.role_id), p_new_team_id, p_move_on, p_basis)
  returning id into v_new_id;

  return v_new_id;
end
$$;
