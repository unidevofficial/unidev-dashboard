-- 0007 관리자 계정 (kind='admin')
--   구성원·동아리에 연결되지 않는 계정. 모든 권한을 가지지만 사람이 아니므로 구성원 목록·조직도·
--   연락망·출석부 등 어디에도 나타나지 않는다.
--   관리자 계정의 생성·비밀번호 재설정·삭제는 관리자 계정만 할 수 있다. (팀장 등 일반 관리자는 불가)

alter table public.accounts drop constraint accounts_kind_check;
alter table public.accounts add constraint accounts_kind_check check (kind in ('staff', 'club', 'admin'));
-- 기존 검사(staff ↔ member_id, club ↔ club_id)로 admin 계정은 member_id·club_id가 모두 비게 된다.

-- 로그인한 계정의 아이디, 관리자 계정 여부
create or replace function public.current_username() returns text
language sql stable security definer set search_path = ''
as $$
  select a.username from public.accounts a where auth.uid() is not null and a.auth_user_id = auth.uid()
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.accounts a
                  where auth.uid() is not null and a.auth_user_id = auth.uid() and a.kind = 'admin')
$$;

-- 변경 이력에 처리한 계정의 아이디도 남긴다 (관리자 계정은 구성원·동아리가 없으므로)
alter table public.change_logs add column actor_username text default public.current_username();

-- 열람·관리자 권한에 관리자 계정을 포함
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_super_admin() or exists (
    select 1
      from public.accounts a
      join public.role_assignments ra on ra.member_id = a.member_id
     where auth.uid() is not null
       and a.auth_user_id = auth.uid()
       and a.kind = 'staff'
       and ra.start_on <= current_date
       and (ra.end_on is null or ra.end_on >= current_date)
  ) or exists (
    select 1
      from public.accounts a
      join public.clubs c on c.id = a.club_id
     where auth.uid() is not null
       and a.auth_user_id = auth.uid()
       and a.kind = 'club'
       and c.status in ('full', 'provisional')
  )
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_super_admin() or exists (
    select 1
      from public.accounts a
      join public.role_assignments ra on ra.member_id = a.member_id
      join public.roles r on r.id = ra.role_id
     where auth.uid() is not null
       and a.auth_user_id = auth.uid()
       and a.kind = 'staff'
       and r.is_admin
       and ra.start_on <= current_date
       and (ra.end_on is null or ra.end_on >= current_date)
  )
$$;

create or replace function public.get_my_access() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'auth_user_id', a.auth_user_id,
    'kind',      a.kind,
    'username',  a.username,
    'member_id', a.member_id,
    'club_id',   a.club_id,
    'name',      coalesce(m.name, c.name, '관리자'),
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

-- 이 계정을 관리(비밀번호 재설정·삭제)할 수 있는지. 관리자 계정은 관리자 계정만 관리한다.
create or replace function public.can_manage_account(p_auth_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() and (
    public.is_super_admin()
    or not exists (select 1 from public.accounts where auth_user_id = p_auth_user_id and kind = 'admin')
  )
$$;

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
  if p_kind = 'admin' and not public.is_super_admin() then
    raise exception '관리자 계정은 관리자 계정으로만 만들 수 있습니다.' using errcode = '42501';
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
  if not public.can_manage_account(p_auth_user_id) then
    raise exception '이 계정을 삭제할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_auth_user_id = auth.uid() then
    raise exception '자기 계정은 삭제할 수 없습니다.';
  end if;
  delete from public.accounts where auth_user_id = p_auth_user_id;
end
$$;

create or replace function public.mark_password_changed(p_auth_user_id uuid default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_auth_user_id, auth.uid());
begin
  if v_target is distinct from auth.uid() and not public.can_manage_account(v_target) then
    raise exception '이 계정의 비밀번호를 재설정할 권한이 없습니다.' using errcode = '42501';
  end if;
  update public.accounts set password_changed_at = now() where auth_user_id = v_target;
end
$$;

revoke execute on function public.current_username(), public.is_super_admin(), public.can_manage_account(uuid) from public, anon;
grant execute on function public.current_username(), public.is_super_admin(), public.can_manage_account(uuid) to authenticated;
