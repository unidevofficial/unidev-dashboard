-- 0002 권한 판별 함수와 트리거 (SPEC.md 4절 "트리거와 함수")
--
-- 현직의 정의: start_on <= current_date and (end_on is null or end_on >= current_date)
--   (SPEC의 end_on 조건에, 다음 임기를 미리 등록한 배정이 앞당겨 현직으로 잡히지 않도록 start_on 조건을 더했다)
--
-- 권한 판별 함수는 security definer로 두어 RLS 정책 안에서 재귀 없이 호출되게 하고,
-- search_path를 비워 모든 객체를 스키마까지 적어 참조한다.

-- ---------------------------------------------------------------------
-- 권한 판별
--   로그인 계정(accounts)은 운영진 개인 계정(kind='staff') 또는 동아리 대표자 계정(kind='club')이다.
-- ---------------------------------------------------------------------
-- 운영진 계정으로 로그인했으면 연결된 구성원 id
create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select a.member_id
    from public.accounts a
   where auth.uid() is not null
     and a.auth_user_id = auth.uid()
     and a.kind = 'staff'
$$;

-- 대표자 계정으로 로그인했으면 연결된 동아리 id
create or replace function public.current_club_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select a.club_id
    from public.accounts a
   where auth.uid() is not null
     and a.auth_user_id = auth.uid()
     and a.kind = 'club'
$$;

-- 열람 권한: 현직 역할이 있는 운영진 계정, 또는 정등록·가등록 동아리의 대표자 계정
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
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

-- 관리자: 운영진 계정이고 현직 is_admin 역할(회장·부회장·팀장)이 있음
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
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

-- 해당 동아리의 대표자 계정으로 로그인했는지 (동아리가 정등록·가등록일 때만)
create or replace function public.represents_club(p_club_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.accounts a
      join public.clubs c on c.id = a.club_id
     where auth.uid() is not null
       and a.auth_user_id = auth.uid()
       and a.kind = 'club'
       and a.club_id = p_club_id
       and c.status in ('full', 'provisional')
  )
$$;

-- 대표자 계정으로 로그인했고, 이 구성원이 자기 동아리의 현직 대표자인지 (대표자 연락처 수정용)
create or replace function public.is_my_club_rep(p_member_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.role_assignments ra
      join public.roles r on r.id = ra.role_id
     where r.code = 'representative'
       and ra.member_id = p_member_id
       and ra.club_id = public.current_club_id()
       and public.represents_club(ra.club_id)
       and ra.start_on <= current_date
       and (ra.end_on is null or ra.end_on >= current_date)
  )
$$;

-- ---------------------------------------------------------------------
-- updated_at 갱신
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger clubs_set_updated_at   before update on public.clubs   for each row execute function public.set_updated_at();
create trigger members_set_updated_at before update on public.members for each row execute function public.set_updated_at();
create trigger teams_set_updated_at   before update on public.teams   for each row execute function public.set_updated_at();
create trigger club_officers_set_updated_at before update on public.club_officers for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 변경 이력 기록
--   트리거 인자: 기본 키 컬럼 이름들 (생략하면 'id')
-- ---------------------------------------------------------------------
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row    jsonb;
  v_id     text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after  := to_jsonb(new); end if;

  -- 값이 실제로 바뀌지 않은 update는 기록하지 않는다
  if tg_op = 'UPDATE' and (v_before - 'updated_at') = (v_after - 'updated_at') then
    return null;
  end if;

  v_row := coalesce(v_after, v_before);
  if tg_nargs = 0 then
    v_id := v_row ->> 'id';
  else
    select string_agg(v_row ->> a.col, ':' order by a.ord)
      into v_id
      from unnest(tg_argv) with ordinality as a(col, ord);
  end if;

  insert into public.change_logs (table_name, record_id, action, before_data, after_data, actor_member_id, actor_club_id)
  values (tg_table_name, v_id, lower(tg_op), v_before, v_after, public.current_member_id(), public.current_club_id());

  return null;
end
$$;

create trigger clubs_log            after insert or update or delete on public.clubs            for each row execute function public.log_change();
create trigger members_log          after insert or update or delete on public.members          for each row execute function public.log_change();
create trigger teams_log            after insert or update or delete on public.teams            for each row execute function public.log_change();
create trigger roles_log            after insert or update or delete on public.roles            for each row execute function public.log_change();
create trigger role_assignments_log after insert or update or delete on public.role_assignments for each row execute function public.log_change();
create trigger meetings_log         after insert or update or delete on public.meetings         for each row execute function public.log_change();
create trigger attendances_log      after insert or update or delete on public.attendances      for each row execute function public.log_change();
create trigger sanctions_log        after insert or update or delete on public.sanctions        for each row execute function public.log_change();
create trigger club_officers_log    after insert or update or delete on public.club_officers    for each row execute function public.log_change();
create trigger accounts_log         after insert or update or delete on public.accounts         for each row execute function public.log_change('auth_user_id');

-- ---------------------------------------------------------------------
-- 역할 배정 검증
--   - 역할 scope에 맞게 club_id·team_id가 채워졌는지
--   - 폐지된 팀에는 새로 배정할 수 없음
--   - 현직 중복 방지: 동아리별 현직 대표자 1인, 팀별 현직 팀장 1인 (end_on is null 기준)
--   회칙 개정 시 이 함수의 규칙만 조정한다.
-- ---------------------------------------------------------------------
create or replace function public.check_assignment_scope() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_scope text;
  v_code  text;
  v_name  text;
begin
  select r.scope, r.code, r.name into v_scope, v_code, v_name
    from public.roles r where r.id = new.role_id;

  if v_scope = 'org' and (new.club_id is not null or new.team_id is not null) then
    raise exception '% 역할은 동아리나 팀을 지정하지 않습니다.', v_name;
  elsif v_scope = 'club' and (new.club_id is null or new.team_id is not null) then
    raise exception '% 역할은 동아리를 지정해야 합니다.', v_name;
  elsif v_scope = 'team' and (new.team_id is null or new.club_id is not null) then
    raise exception '% 역할은 팀을 지정해야 합니다.', v_name;
  end if;

  if new.team_id is not null
     and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id)
     and exists (select 1 from public.teams t where t.id = new.team_id and t.closed_on is not null) then
    raise exception '폐지된 팀에는 배정할 수 없습니다.';
  end if;

  if new.end_on is null then
    if v_code = 'representative' and exists (
         select 1 from public.role_assignments ra
          where ra.role_id = new.role_id and ra.club_id = new.club_id
            and ra.end_on is null and ra.id <> new.id) then
      raise exception '이 동아리에는 이미 현직 대표자가 있습니다. 기존 대표자의 종료일을 먼저 입력하세요.';
    end if;
    if v_code = 'team_lead' and exists (
         select 1 from public.role_assignments ra
          where ra.role_id = new.role_id and ra.team_id = new.team_id
            and ra.end_on is null and ra.id <> new.id) then
      raise exception '이 팀에는 이미 현직 팀장이 있습니다. 기존 팀장의 종료일을 먼저 입력하세요.';
    end if;
  end if;

  return new;
end
$$;

create trigger role_assignments_check_scope
  before insert or update on public.role_assignments
  for each row execute function public.check_assignment_scope();

-- ---------------------------------------------------------------------
-- 동아리: 관리자가 아니면 허용된 항목만 수정
--   대표자가 고칠 수 있는 항목: name, member_count, official_email, sns_url, note
--   (status, registered_on, university 등은 관리자만)
-- ---------------------------------------------------------------------
create or replace function public.guard_club_admin_fields() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_editable text[] := array['name', 'member_count', 'official_email', 'sns_url', 'note', 'updated_at'];
begin
  -- current_user는 요청한 역할(anon/authenticated). 마이그레이션·service_role은 검사하지 않는다.
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if (to_jsonb(new) - v_editable) is distinct from (to_jsonb(old) - v_editable) then
      raise exception '등록 구분(status)·등록일·대학은 관리자만 변경할 수 있습니다.';
    end if;
  end if;
  return new;
end
$$;

create trigger clubs_guard_admin_fields
  before update on public.clubs
  for each row execute function public.guard_club_admin_fields();

-- 동아리가 비활성(등록 취소·제명)이 되면 그 동아리 범위의 현직 배정을 일괄 종료
create or replace function public.end_club_assignments_on_inactive() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'inactive' and old.status <> 'inactive' then
    update public.role_assignments ra
       set end_on = greatest(ra.start_on, current_date),
           note   = concat_ws(' / ', nullif(ra.note, ''), '동아리 비활성화로 자동 종료')
     where ra.club_id = new.id
       and (ra.end_on is null or ra.end_on > current_date);
  end if;
  return null;
end
$$;

create trigger clubs_end_assignments_on_inactive
  after update of status on public.clubs
  for each row execute function public.end_club_assignments_on_inactive();

-- ---------------------------------------------------------------------
-- 구성원: 관리자가 아니면(본인 수정) 이름과 연락처만 수정
-- ---------------------------------------------------------------------
create or replace function public.guard_member_self_fields() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_editable text[] := array['name', 'phone', 'email', 'contact_verified_on', 'updated_at'];
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if (to_jsonb(new) - v_editable) is distinct from (to_jsonb(old) - v_editable) then
      raise exception '본인 정보는 이름과 연락처만 수정할 수 있습니다.';
    end if;
  end if;
  return new;
end
$$;

create trigger members_guard_self_fields
  before update on public.members
  for each row execute function public.guard_member_self_fields();

-- ---------------------------------------------------------------------
-- 팀 폐지: closed_on이 입력되면 소속 배정에 종료일을 넣는다 (과거 기록은 보존)
-- ---------------------------------------------------------------------
create or replace function public.end_team_assignments_on_close() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.closed_on is not null and old.closed_on is null then
    update public.role_assignments ra
       set end_on = greatest(ra.start_on, new.closed_on),
           note   = concat_ws(' / ', nullif(ra.note, ''), '팀 폐지로 자동 종료')
     where ra.team_id = new.id
       and (ra.end_on is null or ra.end_on > new.closed_on);
  end if;
  return null;
end
$$;

create trigger teams_end_assignments_on_close
  after update of closed_on on public.teams
  for each row execute function public.end_team_assignments_on_close();

-- ---------------------------------------------------------------------
-- 대표자회의를 만들면 정등록·가등록 동아리 전체와 회장·부회장의 출결 행을 '결석'으로 만든다.
-- 회의 당시 현직 대표자를 member_id에 함께 기록한다. (회의 중 출석으로 바꿔 체크)
-- ---------------------------------------------------------------------
create or replace function public.create_meeting_attendances() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.kind = 'representatives' then
    insert into public.attendances (meeting_id, club_id, member_id, status)
    select new.id, c.id,
           (select ra.member_id
              from public.role_assignments ra
              join public.roles r on r.id = ra.role_id
             where r.code = 'representative'
               and ra.club_id = c.id
               and ra.start_on <= new.held_on
               and (ra.end_on is null or ra.end_on >= new.held_on)
             order by ra.start_on desc
             limit 1),
           'absent'
      from public.clubs c
     where c.status in ('full', 'provisional');

    -- 회장·부회장(회장단)도 개인 단위로 출결 대상에 넣는다
    insert into public.attendances (meeting_id, member_id, status)
    select distinct new.id, ra.member_id, 'absent'
      from public.role_assignments ra
      join public.roles r on r.id = ra.role_id
     where r.scope = 'org' and r.is_admin
       and ra.start_on <= new.held_on
       and (ra.end_on is null or ra.end_on >= new.held_on);
  end if;
  return null;
end
$$;

create trigger meetings_create_attendances
  after insert on public.meetings
  for each row execute function public.create_meeting_attendances();

-- ---------------------------------------------------------------------
-- 징계 만료일 기본값: 주의 1년(제53조 제3항), 경고 2년(제54조 제3항)
-- ---------------------------------------------------------------------
create or replace function public.set_sanction_expiry() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.expires_on is null then
    new.expires_on := case new.kind
      when 'caution' then (new.imposed_on + interval '1 year')::date
      when 'warning' then (new.imposed_on + interval '2 years')::date
      else null
    end;
  end if;
  return new;
end
$$;

create trigger sanctions_set_expiry
  before insert or update on public.sanctions
  for each row execute function public.set_sanction_expiry();
