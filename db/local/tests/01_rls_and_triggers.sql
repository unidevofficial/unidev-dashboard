-- RLS·트리거 검증 (가상 데이터 기준). 전체를 rollback 하므로 데이터는 바뀌지 않는다.
-- 사용자 흉내: set local role authenticated; set local request.jwt.claim.sub = '<uuid>';
\set ON_ERROR_STOP 1
begin;

-- =====================================================================
-- 비로그인(anon): 테이블 접근 자체가 거부된다
-- =====================================================================
set local role anon;
do $$
begin
  begin
    perform 1 from public.clubs limit 1;
    raise exception 'FAIL: anon이 clubs를 조회함';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.v_club_overview limit 1;
    raise exception 'FAIL: anon이 v_club_overview를 조회함';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS anon: 테이블·뷰 접근 거부';
end $$;

-- =====================================================================
-- 현직 역할이 없는 사용자 (류하은): 아무것도 볼 수 없다
-- =====================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare n int;
begin
  assert (select count(*) from public.clubs) = 0, 'FAIL: 역할 없는 사용자가 clubs를 봄';
  assert (select count(*) from public.members) = 0, 'FAIL: 역할 없는 사용자가 members를 봄';
  assert (select count(*) from public.v_current_assignments) = 0, 'FAIL: 역할 없는 사용자가 배정을 봄';
  assert not public.is_staff(), 'FAIL: is_staff()가 참';
  assert (public.get_my_access() ->> 'is_staff')::boolean = false, 'FAIL: get_my_access is_staff';
  update public.members set phone = '010-0000-0000' where id = 'b0000000-0000-0000-0000-000000000019';
  get diagnostics n = row_count;
  assert n = 0, 'FAIL: 역할 없는 사용자가 본인 정보를 수정함';
  raise notice 'PASS 역할 없음: 조회·수정 불가';
end $$;

-- 심사 중 동아리의 대표자 계정 (버그헌터즈): 아무것도 볼 수 없다
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';
do $$
begin
  assert (select count(*) from public.clubs) = 0, 'FAIL: 심사 중 동아리 계정이 clubs를 봄';
  assert not public.represents_club('c0000000-0000-0000-0000-000000000006'), 'FAIL: 심사 중 동아리 represents_club';
  assert (public.get_my_access() ->> 'kind') = 'club', 'FAIL: get_my_access kind';
  raise notice 'PASS 심사 중 동아리 대표자 계정: 조회 불가';
end $$;

-- =====================================================================
-- 운영진 (신예린, 행사팀원)
-- =====================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
do $$
declare n int;
begin
  assert public.is_staff() and not public.is_admin(), 'FAIL: 운영진 권한 판별';
  assert (select count(*) from public.clubs) = 8, 'FAIL: 운영진 clubs 열람';
  assert (select count(*) from public.members) = 21, 'FAIL: 운영진 members 열람';
  assert (select count(*) from public.change_logs) = 0, 'FAIL: 운영진이 변경 이력을 봄';
  assert (select count(*) from public.v_contact_purge_candidates) = 0, 'FAIL: 운영진이 파기 대상을 봄';

  begin
    insert into public.clubs (university, name) values ('테스트대학교', '테스트');
    raise exception 'FAIL: 운영진이 동아리를 등록함';
  exception when insufficient_privilege then null;
  end;

  update public.clubs set note = 'x' where id = 'c0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'FAIL: 운영진이 동아리 정보를 수정함';

  update public.members set name = 'x' where id = 'b0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'FAIL: 운영진이 다른 사람 정보를 수정함';

  update public.members set phone = '010-9999-0012', contact_verified_on = current_date where id = public.current_member_id();
  get diagnostics n = row_count;
  assert n = 1, 'FAIL: 본인 연락처 수정 실패';

  begin
    update public.members set club_id = 'c0000000-0000-0000-0000-000000000001' where id = public.current_member_id();
    raise exception 'FAIL: 본인이 소속 동아리를 바꿈';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  begin
    update public.accounts set kind = 'club' where auth_user_id = auth.uid();
    raise exception 'FAIL: 본인이 계정 정보를 바꿈';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.admin_register_account(gen_random_uuid(), 'hacker', 'staff', public.current_member_id(), null);
    raise exception 'FAIL: 운영진이 계정을 만듦';
  exception when insufficient_privilege then null;
  end;

  assert (select count(*) from public.accounts) = 1, 'FAIL: 운영진이 다른 계정을 봄';

  begin
    insert into public.role_assignments (member_id, role_id, team_id)
    values (public.current_member_id(), (select id from public.roles where code = 'team_member'),
            (select id from public.teams where name = '재무팀'));
    raise exception 'FAIL: 운영진이 역할을 배정함';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.purge_expired_contacts();
    raise exception 'FAIL: 운영진이 연락처 파기를 실행함';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.log_contact_export('{}'::jsonb, 1);
    raise exception 'FAIL: 운영진이 내보내기 기록을 남김';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.change_logs (table_name, record_id, action) values ('x', 'x', 'insert');
    raise exception 'FAIL: 변경 이력에 직접 기록함';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS 운영진: 열람 가능, 본인 연락처만 수정 가능';
end $$;

-- =====================================================================
-- 대표자 계정 (픽셀랩)
-- =====================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
do $$
declare n int;
begin
  assert public.represents_club('c0000000-0000-0000-0000-000000000001'), 'FAIL: represents_club';
  assert not public.represents_club('c0000000-0000-0000-0000-000000000002'), 'FAIL: 다른 동아리 대표 판별';

  update public.clubs set name = '픽셀랩', member_count = 90, official_email = 'new@example.com',
                          sns_url = null, note = '대표자 수정'
   where id = 'c0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'FAIL: 대표자가 자기 동아리 정보를 수정하지 못함';

  begin
    update public.clubs set status = 'provisional' where id = 'c0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: 대표자가 등록 구분을 바꿈';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  begin
    update public.clubs set registered_on = '2000-01-01' where id = 'c0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: 대표자가 등록일을 바꿈';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  update public.clubs set note = 'x' where id = 'c0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  assert n = 0, 'FAIL: 대표자가 다른 동아리를 수정함';

  -- 자기 동아리 현직 대표자(최유나)의 연락처는 수정 가능, 다른 사람은 불가
  update public.members set phone = '010-7777-0004' where id = 'b0000000-0000-0000-0000-000000000004';
  get diagnostics n = row_count;
  assert n = 1, 'FAIL: 대표자 계정이 현직 대표자 연락처를 수정하지 못함';
  update public.members set phone = '010-7777-0016' where id = 'b0000000-0000-0000-0000-000000000016';
  get diagnostics n = row_count;
  assert n = 0, 'FAIL: 대표자 계정이 다른 구성원을 수정함';
  begin
    update public.members set club_id = null where id = 'b0000000-0000-0000-0000-000000000004';
    raise exception 'FAIL: 대표자 계정이 대표자의 소속을 바꿈';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  assert not public.is_admin() and public.current_member_id() is null, 'FAIL: 대표자 계정 권한';

  raise notice 'PASS 대표자: 자기 동아리 허용 항목만 수정';
end $$;

-- =====================================================================
-- 관리자 (박지민, 행사팀장)
-- =====================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
declare
  v_club uuid;
  v_member uuid;
  v_team uuid;
  v_rep smallint := (select id from public.roles where code = 'representative');
  v_tm  smallint := (select id from public.roles where code = 'team_member');
  n int;
begin
  assert public.is_admin(), 'FAIL: 팀장은 관리자';

  -- 이력: 앞서 대표자가 수정한 기록이 처리자와 함께 남아 있어야 한다
  assert exists (select 1 from public.change_logs
                  where table_name = 'clubs' and record_id = 'c0000000-0000-0000-0000-000000000001'
                    and action = 'update' and actor_club_id = 'c0000000-0000-0000-0000-000000000001' and actor_member_id is null
                    and before_data ->> 'member_count' = '84' and after_data ->> 'member_count' = '90'),
         'FAIL: 대표자 수정 이력이 없음';

  insert into public.clubs (university, name) values ('테스트대학교', '테스트동아리') returning id into v_club;
  update public.clubs set status = 'provisional', registered_on = current_date where id = v_club;
  assert (select status from public.clubs where id = v_club) = 'provisional', 'FAIL: 관리자 상태 변경';

  insert into public.members (name, club_id) values ('테스트 대표', v_club) returning id into v_member;

  -- scope 검사
  begin
    insert into public.role_assignments (member_id, role_id) values (v_member, v_rep);
    raise exception 'FAIL: 동아리 없이 대표자 배정';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  insert into public.role_assignments (member_id, role_id, club_id) values (v_member, v_rep, v_club);

  -- 현직 대표자 중복 방지
  begin
    insert into public.role_assignments (member_id, role_id, club_id)
    values ('b0000000-0000-0000-0000-000000000020', v_rep, v_club);
    raise exception 'FAIL: 현직 대표자 2명';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 대표자 교체 함수
  perform public.replace_representative(v_club, 'b0000000-0000-0000-0000-000000000020', current_date, '테스트');
  assert (select representative_id from public.v_club_overview where id = v_club) = 'b0000000-0000-0000-0000-000000000020',
         'FAIL: 대표자 교체 후 v_club_overview';
  assert (select count(*) from public.role_assignments where club_id = v_club and role_id = v_rep) = 2,
         'FAIL: 역대 대표자 기록 보존';

  -- 팀 신설 → 배정 → 폐지 시 배정 자동 종료 → 폐지된 팀에 배정 불가
  insert into public.teams (name, sort_order) values ('행정팀', 60) returning id into v_team;
  insert into public.role_assignments (member_id, role_id, team_id, start_on)
  values (v_member, v_tm, v_team, current_date - 10);
  update public.teams set closed_on = current_date - 1 where id = v_team;
  assert (select end_on from public.role_assignments where team_id = v_team) = current_date - 1,
         'FAIL: 팀 폐지 시 배정 종료';
  begin
    insert into public.role_assignments (member_id, role_id, team_id) values (v_member, v_tm, v_team);
    raise exception 'FAIL: 폐지된 팀에 배정';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 팀 이름 변경은 이력에 이전 명칭이 남는다
  update public.teams set name = '이벤트팀' where name = '행사팀' and closed_on is null;
  assert exists (select 1 from public.change_logs where table_name = 'teams' and action = 'update'
                    and before_data ->> 'name' = '행사팀' and after_data ->> 'name' = '이벤트팀'),
         'FAIL: 팀 명칭 변경 이력';

  -- 징계 만료일 기본값
  insert into public.sanctions (club_id, kind, imposed_on) values (v_club, 'caution', '2026-01-10');
  insert into public.sanctions (club_id, kind, imposed_on) values (v_club, 'warning', '2026-01-10');
  assert (select expires_on from public.sanctions where club_id = v_club and kind = 'caution') = '2027-01-10', 'FAIL: 주의 만료일';
  assert (select expires_on from public.sanctions where club_id = v_club and kind = 'warning') = '2028-01-10', 'FAIL: 경고 만료일';

  -- 비활성 처리 시 동아리 범위 배정 종료
  update public.clubs set status = 'inactive' where id = v_club;
  assert not exists (select 1 from public.v_current_assignments where club_id = v_club and end_on is null),
         'FAIL: 비활성 동아리 배정 종료';

  raise notice 'PASS 관리자: 등록·배정·팀 관리·징계·트리거';
end $$;

-- =====================================================================
-- 동아리 자체 회장단: 대표자는 자기 동아리만, 운영진은 열람만
-- =====================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
do $$
declare n int;
begin
  insert into public.club_officers (club_id, name, title, contact)
  values ('c0000000-0000-0000-0000-000000000001', '테스트 회장', '회장', '010-0000-0000');
  begin
    insert into public.club_officers (club_id, name) values ('c0000000-0000-0000-0000-000000000002', 'x');
    raise exception 'FAIL: 대표자가 다른 동아리 회장단을 추가함';
  exception when insufficient_privilege then null;
  end;
  update public.club_officers set title = 'x' where club_id = 'c0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  assert n = 0, 'FAIL: 대표자가 다른 동아리 회장단을 수정함';
  raise notice 'PASS 동아리 회장단: 대표자는 자기 동아리만 수정';
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
do $$
declare n int;
begin
  assert (select count(*) from public.club_officers) >= 3, 'FAIL: 운영진 회장단 열람';
  delete from public.club_officers;
  get diagnostics n = row_count;
  assert n = 0, 'FAIL: 운영진이 회장단을 삭제함';
  raise notice 'PASS 동아리 회장단: 운영진은 열람만';
end $$;

-- =====================================================================
-- 대표자회의를 만들면 정등록·가등록 동아리 전체가 '결석'으로 들어간다
-- =====================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare v_id uuid;
begin
  insert into public.meetings (kind, held_on, title) values ('representatives', current_date, '테스트 회의') returning id into v_id;
  assert (select count(*) from public.attendances where meeting_id = v_id and club_id is not null)
       = (select count(*) from public.clubs where status in ('full', 'provisional')), 'FAIL: 동아리별 출결 행 생성';
  assert (select array_agg(member_id order by member_id) from public.attendances where meeting_id = v_id and club_id is null)
       = array['b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002']::uuid[], 'FAIL: 회장단 출결 행 생성';
  assert not exists (select 1 from public.attendances where meeting_id = v_id and status <> 'absent'), 'FAIL: 기본값은 결석';
  assert (select member_id from public.attendances where meeting_id = v_id and club_id = 'c0000000-0000-0000-0000-000000000001')
       = 'b0000000-0000-0000-0000-000000000004', 'FAIL: 당시 대표자 기록';
  assert (select member_id from public.attendances where meeting_id = v_id and club_id = 'c0000000-0000-0000-0000-000000000007') is null,
         'FAIL: 대표자 공석 동아리';
  begin
    insert into public.attendances (meeting_id, club_id) values (v_id, 'c0000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: 같은 회의에 같은 동아리 2행';
  exception when unique_violation then null;
  end;
  begin
    update public.attendances set status = 'proxy' where meeting_id = v_id;
    raise exception 'FAIL: proxy 상태 허용됨';
  exception when check_violation then null;
  end;
  raise notice 'PASS 대표자회의 출결 자동 생성';
end $$;

-- =====================================================================
-- 연락처 파기 (관리자, 김하늘 회장)
-- =====================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  -- 파기 대상: 오세훈(2024-05 종료), 노태현(2025-02 종료). 류하은(2026-06 종료)은 아직 아님
  assert (select array_agg(name order by name) from public.v_contact_purge_candidates) = array['노태현', '오세훈'],
         'FAIL: 파기 대상 목록';

  -- 노태현의 연락처가 이력에 남아 있는 상태를 만든다
  update public.members set phone = '010-2222-0018' where id = 'b0000000-0000-0000-0000-000000000018';
  assert exists (select 1 from public.change_logs where record_id = 'b0000000-0000-0000-0000-000000000018'
                    and after_data ->> 'phone' = '010-2222-0018'), 'FAIL: 사전 조건';

  n := public.purge_expired_contacts();
  assert n = 2, format('FAIL: 파기 건수 %s', n);
  assert (select count(*) from public.members
           where id in ('b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000018')
             and phone is null and email is null and contact_purged_at is not null) = 2,
         'FAIL: 연락처가 지워지지 않음';
  assert not exists (select 1 from public.change_logs
                      where table_name = 'members'
                        and record_id in ('b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000018')
                        and (before_data ?| array['phone', 'email'] or after_data ?| array['phone', 'email'])),
         'FAIL: 이력에 연락처가 남아 있음';
  assert (select count(*) from public.change_logs where action = 'purge') = 2, 'FAIL: purge 기록';
  assert (select name from public.members where id = 'b0000000-0000-0000-0000-000000000018') = '노태현',
         'FAIL: 이름은 남아야 함';
  assert (select count(*) from public.v_assignments where member_id = 'b0000000-0000-0000-0000-000000000018') = 1,
         'FAIL: 역할 이력은 남아야 함';
  assert (select count(*) from public.v_contact_purge_candidates) = 0, 'FAIL: 파기 후 대상이 남음';

  perform public.log_contact_export('{"group":"team"}'::jsonb, 12);
  assert exists (select 1 from public.change_logs where action = 'export' and actor_member_id = public.current_member_id()),
         'FAIL: 내보내기 기록';

  raise notice 'PASS 연락처 파기·내보내기 기록';
end $$;

-- =====================================================================
-- 관리자 계정 (구성원·동아리 연결 없음): 전체 권한, 일반 관리자는 관리자 계정을 다룰 수 없다
-- =====================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000008';
do $$
begin
  assert public.is_admin() and public.is_staff() and public.is_super_admin(), 'FAIL: 관리자 계정 권한';
  assert (select count(*) from public.members) >= 21, 'FAIL: 관리자 계정 members 열람';
  assert (select count(*) from public.change_logs) > 0, 'FAIL: 관리자 계정 변경 이력 열람';
  assert (public.get_my_access() ->> 'kind') = 'admin', 'FAIL: get_my_access kind';
  update public.clubs set note = '관리자 계정 수정' where id = 'c0000000-0000-0000-0000-000000000002';
  assert exists (select 1 from public.change_logs where table_name = 'clubs' and actor_username = 'admin'
                    and actor_member_id is null and actor_club_id is null), 'FAIL: 관리자 계정 처리자 기록';
  raise notice 'PASS 관리자 계정: 전체 권한, 처리자 아이디 기록';
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
begin
  assert not public.can_manage_account('00000000-0000-0000-0000-000000000008'), 'FAIL: 팀장이 관리자 계정을 관리';
  assert public.can_manage_account('00000000-0000-0000-0000-000000000004'), 'FAIL: 팀장이 대표자 계정을 관리 못함';
  begin
    perform public.admin_remove_account('00000000-0000-0000-0000-000000000008');
    raise exception 'FAIL: 팀장이 관리자 계정을 삭제';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_register_account(gen_random_uuid(), 'admin2', 'admin');
    raise exception 'FAIL: 팀장이 관리자 계정을 만듦';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 관리자 계정은 관리자 계정만 관리';
end $$;

-- =====================================================================
-- 계정 관리: 관리자만 accounts 행을 만들고 지울 수 있고, 처리자가 이력에 남는다
-- =====================================================================
reset role;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'newstaff@test.local');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
begin
  perform public.admin_register_account('11111111-1111-1111-1111-111111111111', 'NewStaff', 'staff', 'b0000000-0000-0000-0000-000000000016', null);
  assert (select username from public.accounts where auth_user_id = '11111111-1111-1111-1111-111111111111') = 'newstaff', 'FAIL: 계정 생성';
  begin
    perform public.admin_register_account(gen_random_uuid(), 'pixellab2', 'club', null, 'c0000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: 동아리에 계정 2개';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  assert exists (select 1 from public.change_logs where table_name = 'accounts' and action = 'insert'
                    and actor_member_id = 'b0000000-0000-0000-0000-000000000001'), 'FAIL: 계정 생성 이력';
  perform public.mark_password_changed('11111111-1111-1111-1111-111111111111');
  begin
    perform public.admin_remove_account(auth.uid());
    raise exception 'FAIL: 자기 계정 삭제';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.admin_remove_account('11111111-1111-1111-1111-111111111111');
  assert not exists (select 1 from public.accounts where auth_user_id = '11111111-1111-1111-1111-111111111111'), 'FAIL: 계정 삭제';
  raise notice 'PASS 계정 관리: 관리자 전용, 이력 기록';
end $$;

-- 계정이 연결되지 않은 로그인 사용자는 아무것도 볼 수 없다
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  assert public.get_my_access() is null, 'FAIL: 계정 없는 사용자 접근 정보';
  assert (select count(*) from public.clubs) = 0, 'FAIL: 계정 없는 사용자가 clubs를 봄';
  raise notice 'PASS 계정 없는 로그인 사용자: 조회 불가';
end $$;

rollback;
