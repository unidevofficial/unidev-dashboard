-- 0001 기본 테이블 (SPEC.md 4절 스키마)

create extension if not exists pgcrypto;

-- 동아리
create table public.clubs (
  id             uuid primary key default gen_random_uuid(),
  university     text not null,
  name           text not null,
  status         text not null default 'pending'
                 check (status in ('pending','full','provisional','inactive')),
                 -- 심사 중 / 정등록 / 가등록 / 비활성(등록 취소·제명)
  registered_on  date,
  member_count   integer check (member_count is null or member_count >= 0),
  official_email text,          -- 동아리 공식 이메일 (대표자 이메일과 별개)
  sns_url        text,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (university, name)
);

-- 구성원
create table public.members (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  university          text,
  club_id             uuid references public.clubs(id) on delete set null,
  phone               text,          -- 선택 (비워둘 수 있음)
  email               text,          -- 선택 (비워둘 수 있음)
  contact_verified_on date,          -- 연락처 최종 확인일
  contact_purged_at   timestamptz,   -- 보유 기간 경과로 연락처를 파기한 시각
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index members_club_id_idx on public.members (club_id);

-- 로그인 계정: 운영진 개인 계정(kind='staff', 구성원 1명) 또는 동아리 대표자 계정(kind='club', 동아리 1개)
--   대표자 계정은 동아리 소유이고 현직 대표자가 관리한다. 계정 생성·삭제는 관리자 전용 함수로만 한다.
create table public.accounts (
  auth_user_id        uuid primary key references auth.users(id) on delete cascade,
  username            text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  kind                text not null check (kind in ('staff', 'club')),
  member_id           uuid unique references public.members(id) on delete cascade,
  club_id             uuid unique references public.clubs(id) on delete cascade,
  password_changed_at timestamptz,
  created_at          timestamptz not null default now(),
  check ((kind = 'staff') = (member_id is not null)),
  check ((kind = 'club')  = (club_id is not null))
);

-- 팀 (명칭·개수 가변)
create table public.teams (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,            -- 업무 범위
  sort_order     integer not null default 0,
  established_on date,
  closed_on      date,            -- null이면 활동 중
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index teams_active_name_uq on public.teams (name) where closed_on is null;

-- 역할 종류
create table public.roles (
  id         smallserial primary key,
  code       text not null unique,
  name       text not null,
  scope      text not null check (scope in ('org','club','team')),
  is_admin   boolean not null default false,
  sort_order integer not null default 0
);

-- 역할 배정 (기간 기록)
create table public.role_assignments (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  role_id    smallint not null references public.roles(id),
  club_id    uuid references public.clubs(id),   -- scope='club'일 때 필수
  team_id    uuid references public.teams(id),   -- scope='team'일 때 필수
  start_on   date not null default current_date,
  end_on     date,                               -- null이면 현직
  basis      text,                               -- 근거 (예: '2026-10 정기 대표자회의 의결')
  note       text,
  created_at timestamptz not null default now(),
  check (end_on is null or end_on >= start_on)
);
create index role_assignments_member_idx on public.role_assignments (member_id);
create index role_assignments_club_idx   on public.role_assignments (club_id);
create index role_assignments_team_idx   on public.role_assignments (team_id);

-- 회의와 출결
create table public.meetings (
  id       uuid primary key default gen_random_uuid(),
  kind     text not null check (kind in ('representatives','executives','team')),
  team_id  uuid references public.teams(id),     -- kind='team'일 때
  held_on  date not null,
  title    text,
  note     text,
  check ((kind = 'team') = (team_id is not null))
);

-- 출결: 대표자회의는 동아리 단위(club_id), 운영진·팀 회의는 개인 단위(member_id)
create table public.attendances (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references public.meetings(id) on delete cascade,
  club_id         uuid references public.clubs(id),     -- 대표자회의: 출결 대상 동아리
  member_id       uuid references public.members(id),   -- 대표자회의: 회의 당시 대표자 / 그 밖의 회의: 출결 대상자
  status          text not null default 'absent' check (status in ('present','absent','excused')),
  proxy_name      text,                                 -- 대리 참석자 이름 (구성원 등록 없이 자유 입력, 출결 구분과 별개)
  reason          text,
  check (club_id is not null or member_id is not null)
);
create unique index attendances_club_uq   on public.attendances (meeting_id, club_id) where club_id is not null;
create unique index attendances_member_uq on public.attendances (meeting_id, member_id) where club_id is null;
create index attendances_club_idx on public.attendances (club_id);

-- 동아리 자체 회장단 (UNIDEV 구성원·역할과 별개인 참고 정보. 직책명이 동아리마다 달라 자유 입력)
create table public.club_officers (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  name       text not null,
  title      text,          -- 예: 회장, 부회장, 학회장
  contact    text,          -- 전화번호·이메일 등 자유 입력
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index club_officers_club_idx on public.club_officers (club_id);

-- 동아리 징계 (제51조~제55조)
create table public.sanctions (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id),
  kind       text not null check (kind in ('caution','warning','expulsion')),
  imposed_on date not null,
  expires_on date,   -- 주의 1년, 경고 2년 (제53조 제3항, 제54조 제3항). 트리거로 기본값 계산
  basis      text,
  note       text
);
create index sanctions_club_idx on public.sanctions (club_id);

-- 변경 이력 (모든 테이블에 트리거로 자동 기록)
create table public.change_logs (
  id              bigserial primary key,
  table_name      text not null,
  record_id       text not null,
  action          text not null check (action in ('insert','update','delete','export','purge')),
  before_data     jsonb,
  after_data      jsonb,
  actor_member_id uuid,          -- 운영진 계정으로 처리한 경우
  actor_club_id   uuid,          -- 대표자(동아리) 계정으로 처리한 경우
  created_at      timestamptz not null default now()
);
create index change_logs_created_idx on public.change_logs (created_at desc);
create index change_logs_record_idx  on public.change_logs (table_name, record_id);
