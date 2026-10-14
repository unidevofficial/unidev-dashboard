-- 0005 행 단위 보안(RLS) 정책과 권한 (SPEC.md 4절 "RLS 정책 요약")
--
-- 권한은 전부 여기서 강제한다. 화면에서 버튼을 숨기는 것은 사용 편의일 뿐이다.
-- 비로그인(anon)에게는 아무 테이블도 열지 않는다.

-- ---------------------------------------------------------------------
-- 테이블 권한: anon은 전부 회수, authenticated는 RLS로 통제
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 변경 이력은 트리거·함수만 기록한다 (직접 쓰기 불가)
revoke insert, update, delete on public.change_logs from authenticated;
-- 로그인 계정은 관리자 전용 함수로만 기록한다
revoke insert, update, delete on public.accounts from authenticated;

-- ---------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.current_member_id(),
  public.current_club_id(),
  public.is_staff(),
  public.is_admin(),
  public.represents_club(uuid),
  public.is_my_club_rep(uuid),
  public.get_my_access(),
  public.admin_register_account(uuid, text, text, uuid, uuid),
  public.admin_remove_account(uuid),
  public.mark_password_changed(uuid),
  public.log_contact_export(jsonb, integer),
  public.purge_expired_contacts(),
  public.replace_representative(uuid, uuid, date, text),
  public.move_team_assignment(uuid, uuid, date, smallint, text)
to authenticated;

-- ---------------------------------------------------------------------
-- RLS 활성화
-- ---------------------------------------------------------------------
alter table public.clubs            enable row level security;
alter table public.members          enable row level security;
alter table public.teams            enable row level security;
alter table public.roles            enable row level security;
alter table public.role_assignments enable row level security;
alter table public.meetings         enable row level security;
alter table public.attendances      enable row level security;
alter table public.sanctions        enable row level security;
alter table public.change_logs      enable row level security;
alter table public.club_officers    enable row level security;
alter table public.accounts         enable row level security;

-- ---------------------------------------------------------------------
-- clubs: 운영진 열람, 관리자 쓰기, 대표자는 자기 동아리 update (필드 제한은 트리거)
-- ---------------------------------------------------------------------
create policy clubs_select on public.clubs for select to authenticated
  using (public.is_staff());
create policy clubs_insert on public.clubs for insert to authenticated
  with check (public.is_admin());
create policy clubs_update on public.clubs for update to authenticated
  using (public.is_admin() or public.represents_club(id))
  with check (public.is_admin() or public.represents_club(id));
create policy clubs_delete on public.clubs for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- members: 운영진 열람, 관리자 쓰기, 본인·자기 동아리 현직 대표자(대표자 계정) update (필드 제한은 트리거)
-- ---------------------------------------------------------------------
create policy members_select on public.members for select to authenticated
  using (public.is_staff());
create policy members_insert on public.members for insert to authenticated
  with check (public.is_admin());
create policy members_update on public.members for update to authenticated
  using (public.is_admin() or id = public.current_member_id() or public.is_my_club_rep(id))
  with check (public.is_admin() or id = public.current_member_id() or public.is_my_club_rep(id));
create policy members_delete on public.members for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- teams, roles, role_assignments, meetings, attendances, sanctions:
-- 운영진 열람, 관리자 쓰기
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['teams', 'roles', 'role_assignments', 'meetings', 'attendances', 'sanctions'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_staff())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- club_officers (동아리 자체 회장단): 운영진 열람, 관리자·해당 동아리 대표자 쓰기
-- ---------------------------------------------------------------------
create policy club_officers_select on public.club_officers for select to authenticated
  using (public.is_staff());
create policy club_officers_insert on public.club_officers for insert to authenticated
  with check (public.is_admin() or public.represents_club(club_id));
create policy club_officers_update on public.club_officers for update to authenticated
  using (public.is_admin() or public.represents_club(club_id))
  with check (public.is_admin() or public.represents_club(club_id));
create policy club_officers_delete on public.club_officers for delete to authenticated
  using (public.is_admin() or public.represents_club(club_id));

-- ---------------------------------------------------------------------
-- change_logs: 관리자만 열람. 쓰기 정책 없음 (트리거·security definer 함수만 기록)
-- ---------------------------------------------------------------------
create policy change_logs_select on public.change_logs for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- accounts: 관리자는 전체, 그 밖에는 자기 계정만 열람. 쓰기 정책 없음 (관리자 전용 함수만)
-- ---------------------------------------------------------------------
create policy accounts_select on public.accounts for select to authenticated
  using (public.is_admin() or auth_user_id = auth.uid());
