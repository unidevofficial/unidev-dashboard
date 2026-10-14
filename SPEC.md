# UNIDEV 통합 정보 관리 대시보드 — 기획 명세

UNIDEV(전국대학생게임개발동아리연합회) 내부 정보 관리용 웹 대시보드의 기획 명세다.
구현 작업은 이 문서를 기준으로 진행하며, 요구사항이 바뀌면 이 문서를 먼저 고친다.

## 1. 목적

- 동아리, 구성원, 팀(조직) 정보를 하나의 원본으로 관리한다.
- 대표자 교체, 팀 신설·명칭 변경, 팀원 이동 같은 변경을 이력으로 남긴다.
- 운영진 간 연락처(전화번호·이메일)를 로그인한 내부 인원에게만 공유한다.

배경: 소속 동아리 29개, 회원 약 1,800명. 동아리 등록, 대표자 교체(회칙 제18조 제2항), 대리인 파견(제16조 제3항), 팀 구성 변경(제26조 제2항)이 연중 수시로 발생한다. 임기는 매년 3월부터 다음 해 2월까지다.

## 2. 기술 구성

| 영역 | 선택 |
|---|---|
| 화면 | 정적 사이트, GitHub Pages 배포 |
| 백엔드 | Supabase (PostgreSQL, Auth, 행 단위 보안 정책 RLS) |
| 개발 DB | 로컬 PostgreSQL. 완성 후 Supabase로 일괄 이전 |

### 구현 원칙

1. **권한은 전부 DB의 RLS에서 강제한다.** GitHub Pages는 정적 호스팅이고 클라이언트가 Supabase에 직접 접속하므로, 화면에서 버튼을 숨기는 것은 사용 편의일 뿐 권한 통제가 아니다.
2. **로컬 DB를 Supabase와 맞춘다.** 로컬 PostgreSQL에는 Supabase의 `auth` 스키마와 `anon`·`authenticated` 역할이 없다. 로컬 전용 준비 스크립트에서 다음을 만들어 정책 SQL을 수정 없이 이전할 수 있게 한다.
   - `anon`, `authenticated` 역할
   - `auth.uid()` 함수: `current_setting('request.jwt.claim.sub', true)::uuid`를 반환 (Supabase와 같은 방식)
   - 테스트할 때는 `set local role authenticated; set local request.jwt.claim.sub = '<uuid>';`로 사용자를 흉내 낸다.
3. **마이그레이션 파일 관리**
   - `db/migrations/NNNN_설명.sql`: 순번을 붙여 관리하고, Supabase 이전 시 그대로 적용한다.
   - `db/local/`: 로컬 전용 준비 스크립트. 이전 대상에서 제외한다.
   - `db/seed/`: 역할 종류, 현행 팀 등 초기 데이터.
4. **비밀 키**: 클라이언트에는 Supabase 공개 키(anon key)만 넣는다. `service_role` 키는 저장소에 절대 포함하지 않는다. GitHub 무료 요금제에서는 공개 저장소만 Pages 배포가 가능하므로 소스는 공개된다고 가정한다.
5. **라우팅**: GitHub Pages는 서버 측 라우팅이 없으므로 해시 라우팅(`/#/clubs`)을 쓴다.

## 3. 역할과 권한

### 역할 종류 (`roles` 테이블, 행 추가로 확장)

| code | 이름 | 범위 | 관리자 여부 |
|---|---|---|---|
| `president` | 회장 | org | O |
| `vice_president` | 부회장 | org | O |
| `team_lead` | 팀장 | team | O |
| `team_member` | 팀원 | team | |
| `representative` | 대표자 | club | |
| `proxy` | 대리인 | club | |
| `staff` | 운영진 | org | |

### 로그인 계정 (`accounts` 테이블)

아이디·비밀번호로 로그인한다. 계정은 두 종류다.

| 종류 | 대상 | 소유 |
|---|---|---|
| 운영진 계정 (`kind='staff'`) | 회장·부회장·팀장·운영진 | 개인. 구성원(`members`) 1명에 연결 |
| 대표자 계정 (`kind='club'`) | 가입 동아리 | 동아리. 동아리(`clubs`) 1개에 연결하고, 그 동아리의 현직 대표자가 관리한다. 대표자가 바뀌어도 계정은 동아리에 남고, 관리자가 비밀번호를 재설정해 새 대표자에게 넘긴다 |
| 관리자 계정 (`kind='admin'`) | 연합회 공용 관리 | 구성원·동아리에 연결하지 않는다. 모든 권한을 가지며 구성원 목록·조직도·연락망·출석부 어디에도 나타나지 않는다. 관리자 계정의 생성·재설정·삭제는 관리자 계정만 한다 |

- 공개 가입은 없다. 계정 생성·비밀번호 재설정·삭제는 관리자만 한다 (`service_role` 키가 필요하므로 Supabase Edge Function `admin-accounts`로 처리).
- 각자 로그인한 뒤 자기 비밀번호를 바꿀 수 있다.
- Supabase Auth는 이메일 형식의 식별자가 필요하므로 아이디를 `아이디@<로그인 도메인>`으로 바꿔 저장한다. 실제로 메일을 보내지 않는다.

### 권한 등급

- **관리자**: 관리자 계정, 또는 운영진 계정으로 로그인했고 연결된 구성원이 `is_admin` 역할(회장·부회장·팀장)을 현재 맡고 있음
- **운영진**: 운영진 계정으로 로그인했고, 연결된 구성원이 현재 역할을 하나 이상 맡고 있음
- **대표자**: 대표자 계정으로 로그인했고, 연결된 동아리가 정등록·가등록 상태임. 운영진과 같은 열람 권한에 더해 자기 동아리 정보·동아리 회장단·현직 대표자 연락처를 수정할 수 있음
- 현재 역할이 없는 운영진 계정, 심사 중·비활성 동아리의 대표자 계정은 로그인하더라도 아무것도 볼 수 없다.

| 기능 | 관리자 | 운영진 | 대표자 |
|---|---|---|---|
| 동아리·구성원·조직도·연락처 열람 | O | O | O |
| 본인 정보 수정 (대표자 계정은 현직 대표자의 이름·연락처) | O | O | O |
| 자기 비밀번호 변경 | O | O | O |
| 자기 동아리 정보 수정 (직접 반영, 이력 기록) | O | | O |
| 동아리 등록·상태 변경 | O | | |
| 구성원 등록, 역할 배정·종료 | O | | |
| 팀 신설·명칭 변경·폐지 | O | | |
| 출결·징계 기록 | O | | |
| 연락처 내보내기 | O | | |
| 변경 이력 열람 | O | | |
| 보유 기간이 지난 연락처 파기 | O | | |
| 로그인 계정 생성·비밀번호 재설정·삭제 | O | | |

대표자가 수정할 수 있는 동아리 항목은 `name`, `member_count`, `official_email`, `sns_url`, `note`로 한정한다. `status`와 `registered_on`은 트리거로 막아 관리자만 바꿀 수 있게 한다.

## 4. 데이터 구조

### 설계 원칙

- **역할은 기간을 가진 배정 기록으로 관리한다.** 역할을 사람이나 동아리 컬럼에 두지 않는다. 역할이 끝나면 `end_on`을 채우고 새 기록을 추가하므로, 역대 대표자와 팀원을 조회할 수 있다.
- **팀은 이름이 아니라 `id`로 참조한다.** 현재 팀은 행사팀, 소통팀, 홍보팀, 디자인팀, 재무팀이며 시드 데이터로만 넣는다. 코드에 팀 이름을 하드코딩하지 않는다.
  - 명칭 변경: `teams.name`만 수정한다. 배정 기록은 그대로이고, 이전 명칭은 변경 이력에 남는다.
  - 신설: `teams`에 행을 추가한다. (예: 행정팀)
  - 폐지·통합: `closed_on`을 입력하고 소속 배정에 종료일을 넣는다. 과거 기록은 보존된다.
  - 팀 내 직책 추가(예: 부팀장): `roles`에 `scope='team'` 행을 추가한다.
- **대표자 연락처를 동아리 테이블에 중복 저장하지 않는다.** 대표자 이메일·전화번호는 현직 대표자 배정을 거쳐 `members`에서 가져온다. 동아리 공식 이메일은 `clubs.official_email`에 따로 둔다.
- 회칙 개정안(대표자와 운영진 분리, 팀장 자격을 운영진 전원으로 확대)이 의결되어도 스키마는 바꾸지 않는다. 검증 규칙(트리거)만 조정한다.

### 스키마 초안

```sql
create extension if not exists pgcrypto;

-- 동아리
create table clubs (
  id             uuid primary key default gen_random_uuid(),
  university     text not null,
  name           text not null,
  status         text not null default 'pending'
                 check (status in ('pending','full','provisional','inactive')),
                 -- 심사 중 / 정등록 / 가등록 / 비활성(등록 취소·제명)
  registered_on  date,
  member_count   integer,
  official_email text,          -- 동아리 공식 이메일 (대표자 이메일과 별개)
  sns_url        text,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (university, name)
);

-- 구성원
create table members (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  university          text,
  club_id             uuid references clubs(id) on delete set null,
  phone               text,          -- 선택 (비워둘 수 있음)
  email               text,          -- 선택 (비워둘 수 있음)
  contact_verified_on date,          -- 연락처 최종 확인일
  contact_purged_at   timestamptz,   -- 보유 기간 경과로 연락처를 파기한 시각
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 팀 (명칭·개수 가변)
create table teams (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,            -- 업무 범위
  sort_order     integer not null default 0,
  established_on date,
  closed_on      date,            -- null이면 활동 중
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index teams_active_name_uq on teams (name) where closed_on is null;

-- 역할 종류
create table roles (
  id         smallserial primary key,
  code       text not null unique,
  name       text not null,
  scope      text not null check (scope in ('org','club','team')),
  is_admin   boolean not null default false,
  sort_order integer not null default 0
);

-- 역할 배정 (기간 기록)
create table role_assignments (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references members(id) on delete cascade,
  role_id    smallint not null references roles(id),
  club_id    uuid references clubs(id),   -- scope='club'일 때 필수
  team_id    uuid references teams(id),   -- scope='team'일 때 필수
  start_on   date not null default current_date,
  end_on     date,                        -- null이면 현직
  basis      text,                        -- 근거 (예: '2026-10 정기 대표자회의 의결')
  note       text,
  created_at timestamptz not null default now(),
  check (end_on is null or end_on >= start_on)
);

-- 회의와 출결
create table meetings (
  id       uuid primary key default gen_random_uuid(),
  kind     text not null check (kind in ('representatives','executives','team')),
  team_id  uuid references teams(id),     -- kind='team'일 때
  held_on  date not null,
  title    text,
  note     text
);

-- 출결: 대표자회의는 동아리 단위(club_id), 운영진·팀 회의는 개인 단위(member_id)
create table attendances (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references meetings(id) on delete cascade,
  club_id         uuid references clubs(id),     -- 대표자회의: 출결 대상 동아리
  member_id       uuid references members(id),   -- 대표자회의: 회의 당시 대표자 / 그 밖의 회의: 출결 대상자
  status          text not null default 'absent' check (status in ('present','absent','excused')),
  proxy_name      text,                          -- 대리 참석자 이름 (구성원 등록 없이 자유 입력, 출결 구분과 별개)
  reason          text,
  check (club_id is not null or member_id is not null)
);
-- 회의마다 동아리 1행 (대표자회의), 개인 1행 (그 밖의 회의)
create unique index attendances_club_uq   on attendances (meeting_id, club_id) where club_id is not null;
create unique index attendances_member_uq on attendances (meeting_id, member_id) where club_id is null;

-- 동아리 자체 회장단 (UNIDEV 구성원·역할과 별개인 참고 정보. 직책명이 동아리마다 달라 자유 입력)
create table club_officers (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id) on delete cascade,
  name       text not null,
  title      text,          -- 예: 회장, 부회장, 학회장
  contact    text,          -- 전화번호·이메일 등 자유 입력
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 동아리 징계 (제51조~제55조)
create table sanctions (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id),
  kind       text not null check (kind in ('caution','warning','expulsion')),
  imposed_on date not null,
  expires_on date,   -- 주의 1년, 경고 2년 (제53조 제3항, 제54조 제3항). 트리거로 기본값 계산
  basis      text,
  note       text
);

-- 로그인 계정 (운영진 개인 계정 또는 동아리 대표자 계정)
create table accounts (
  auth_user_id        uuid primary key references auth.users(id) on delete cascade,
  username            text not null unique,   -- 로그인 아이디 (영문 소문자·숫자·._-)
  kind                text not null check (kind in ('staff','club','admin')),
  member_id           uuid unique references members(id) on delete cascade,  -- kind='staff'
  club_id             uuid unique references clubs(id) on delete cascade,    -- kind='club'
  password_changed_at timestamptz,
  created_at          timestamptz not null default now(),
  check ((kind = 'staff') = (member_id is not null)),
  check ((kind = 'club')  = (club_id is not null))
);

-- 변경 이력 (모든 테이블에 트리거로 자동 기록)
create table change_logs (
  id              bigserial primary key,
  table_name      text not null,
  record_id       text not null,
  action          text not null check (action in ('insert','update','delete','export','purge')),
  before_data     jsonb,
  after_data      jsonb,
  actor_member_id uuid,          -- 운영진 계정으로 처리한 경우
  actor_club_id   uuid,          -- 대표자(동아리) 계정으로 처리한 경우
  actor_username  text,          -- 처리한 계정의 아이디 (관리자 계정 구분용)
  created_at      timestamptz not null default now()
);
```

### 트리거와 함수

| 이름 | 역할 |
|---|---|
| `set_updated_at()` | `updated_at` 갱신 |
| `log_change()` | 모든 테이블의 insert/update/delete를 `change_logs`에 기록. 처리자는 `current_member_id()` 또는 `current_club_id()` |
| `check_assignment_scope()` | 역할의 `scope`에 맞게 `club_id`·`team_id`가 채워졌는지 검사. 폐지된 팀에는 배정 불가 |
| 현직 중복 방지 | 동아리별 현직 대표자 1인, 팀별 현직 팀장 1인 (`end_on is null` 기준) |
| `guard_club_admin_fields()` | 관리자가 아니면 `clubs.status`, `registered_on` 변경을 거부 |
| `create_meeting_attendances()` | 대표자회의를 만들면 정등록·가등록 동아리 전체와 현직 회장·부회장의 출결 행을 '결석'으로 만든다. 동아리 행에는 당시 대표자를 함께 기록 |
| `set_sanction_expiry()` | `expires_on`이 비어 있으면 종류에 따라 기본값 입력 |
| `current_member_id()` | 로그인한 운영진 계정의 `members.id` |
| `current_club_id()` | 로그인한 대표자 계정의 `clubs.id` |
| `is_staff()` | 열람 권한: 현직 역할이 있는 운영진 계정, 또는 정등록·가등록 동아리의 대표자 계정 |
| `is_admin()` | 운영진 계정이고 현직 `is_admin` 역할이 있는지 |
| `represents_club(club_id)` | 해당 동아리의 대표자 계정인지 |
| `is_my_club_rep(member_id)` | 대표자 계정으로 로그인했고, 그 구성원이 자기 동아리의 현직 대표자인지 |
| `purge_expired_contacts()` | 6절의 보유 기간 기준으로 연락처 파기 (관리자 전용) |

현직의 정의: `end_on is null or end_on >= current_date`

### RLS 정책 요약

| 테이블 | select | insert/update/delete |
|---|---|---|
| clubs | `is_staff()` | 관리자. update는 `represents_club(id)`도 허용 (필드 제한은 트리거) |
| members | `is_staff()` | 관리자. update는 본인(`current_member_id()`)과 자기 동아리 현직 대표자(`is_my_club_rep(id)`)도 허용 (필드 제한은 트리거) |
| teams, roles, role_assignments | `is_staff()` | 관리자 |
| meetings, attendances, sanctions | `is_staff()` | 관리자 |
| club_officers | `is_staff()` | 관리자, 해당 동아리 대표자 |
| change_logs | 관리자 | 트리거만 기록 (직접 쓰기 불가) |
| accounts | 관리자, 본인 계정 | 관리자 전용 함수(`admin_register_account` 등)로만 |

### 조회용 뷰

- `v_current_assignments`: 현직 배정 + 구성원·역할·동아리·팀 이름
- `v_club_overview`: 동아리 + 현직 대표자 이름·전화번호·이메일 + 공식 이메일
- `v_org_chart`: 활동 중인 팀별 팀장·팀원
- `v_contact_purge_candidates`: 파기 대상 구성원

## 5. 화면 구성

| 경로 | 화면 | 내용 |
|---|---|---|
| `/#/login` | 로그인 | 아이디·비밀번호 (Supabase Auth) |
| `/#/accounts` | 로그인 계정 | 관리자 전용. 운영진·대표자 계정 목록, 생성, 비밀번호 재설정, 삭제 |
| `/#/` | 현황 요약 | 등록 동아리 수(정등록·가등록), 운영진 수(대표자·대리인 역할만 있는 사람 제외). 파기 대상 연락처가 있으면 안내와 일괄 파기 버튼(관리자). 최근 변경 10건(관리자) |
| `/#/clubs` | 동아리 목록 | 동아리명, 대학, 등록 구분, 현직 대표자, 회원 수. 동아리명 ABC순. 검색, 등록 구분별 분류 |
| `/#/clubs/:id` | 동아리 상세 | 기본 정보(공식 이메일 포함), 현직·역대 대표자와 연락처, 동아리 자체 회장단(이름·직책·연락처, 여러 명), 소속 운영진의 팀 배정, 출결·징계 이력. 관리자·해당 대표자는 바로 수정 |
| `/#/members` | 구성원 목록 | 이름, 소속, 현재 역할, 전화번호(일부 가림), 이메일. 역할·팀·동아리별 분류 |
| `/#/members/:id` | 구성원 상세 | 전체 연락처, 기간이 표시된 역할 이력, 소속 팀 |
| `/#/org` | 조직도·팀 관리 | 회장단 – 팀장 – 팀원 구조. 관리자는 팀 신설·명칭 변경·폐지, 팀원 배정·이동·종료 |
| `/#/meetings` | 회의·출결 | 회의 목록. 대표자회의 출결은 동아리 단위(출석·결석·사유 결석)로 기록하고 대표자 정보를 함께 표시. 대리 참석자는 출결과 별도로 이름을 텍스트로 입력. 회의를 만들면 모든 동아리와 회장·부회장이 '결석'으로 들어가 회의 중 출석을 체크. 대표자 전화번호는 표시하지 않음 |
| `/#/contacts` | 연락망 | 역할·팀·동아리 단위로 묶어 조회. 이메일 일괄 복사. 관리자는 CSV 내보내기(`change_logs`에 `export`로 기록) |
| `/#/logs` | 변경 이력 | 관리자 전용. 대상 테이블·기간·처리자별 조회, 변경 전후 비교 |

### 표기 원칙

- 학교 이름은 동아리 목록과 동아리 상세에서만 표시한다. 그 밖의 화면에서는 동아리 이름만 쓴다.
- 대표자도 팀 소속은 필수가 아니다. 팀이 없으면 '미배정'으로 따로 표시하지 않고 '-'로 둔다.
- 역할 배정의 근거(`basis`)는 화면에서 입력·표시하지 않는다.

## 6. 개인정보 보호

- **수집 항목**: 이름, 소속 대학·동아리, 전화번호, 이메일. 그 밖의 개인정보는 수집하지 않는다. 정등록 심사용 회원 명부(제43조 제3항 제2호)는 이 시스템에 입력하지 않는다.
- **수집 동의**: 등록할 때 목적, 항목, 보유 기간, 열람 범위(운영진 전원)를 알리고 동의를 받는다.
- **표시**: 목록에서는 전화번호 일부를 가리고, 상세 화면에서만 전체를 보여준다.
- **보유 기간**: 모든 역할이 끝나고 1년이 지나면 전화번호와 이메일을 삭제한다. 이름과 역할 이력은 남긴다.
  - 대상: 현직 역할이 없고, 마지막 `end_on`이 1년 이상 지났으며, `contact_purged_at`이 null인 구성원
  - 관리자가 현황 화면에서 대상을 확인한 뒤 일괄 실행한다(`purge_expired_contacts()`).
  - **`change_logs`의 `before_data`·`after_data`에 남은 해당 구성원의 `phone`·`email`도 함께 지운다.** 지우지 않으면 이력을 통해 연락처가 남는다.
  - 파기 실행은 `change_logs`에 `purge`로 기록하되 연락처 값은 남기지 않는다.
- **이용 수칙**: 개인정보 무단 유출·악용은 회칙 제60조 제3항 제3호의 활동 제한 사유임을 로그인 화면이나 안내문에 명시한다.

## 7. 주요 처리 흐름

| 상황 | 처리 |
|---|---|
| 신규 동아리 | `clubs`를 `pending`으로 등록 → 대표자회의 의결 후 `full` 또는 `provisional` → 대표자 구성원 등록 및 `representative` 배정 |
| 대표자 교체 | 기존 배정의 `end_on` 입력 → 신임 구성원 등록(필요 시) → 새 `representative` 배정. 연락망과 동아리 화면에 자동 반영 |
| 대리인 참석 | `proxy` 배정, 또는 해당 회의 출결 행에 `proxy_name`으로 대리 참석자 이름 기록 (출결 구분과 별개) |
| 팀 신설·명칭 변경·폐지 | 4절 설계 원칙대로 처리 |
| 팀원 이동 | 기존 `team_member` 배정 종료 → 새 팀에 배정 |
| 등록 취소·제명 | `clubs.status='inactive'` → 소속 구성원의 club 범위 배정을 일괄 종료 |
| 임기 종료 | 관리자 화면에서 종료할 배정을 골라 `end_on`을 일괄 입력 → 새 임기 배정 등록 |

## 8. 확정 사항

| 항목 | 결정 |
|---|---|
| 연락처 열람 범위 | 운영진 전원 |
| 동아리 정보 수정 | 대표자 직접 수정, 변경 이력으로 추적 |
| 연락처 보유 기간 | 역할 종료 후 1년 |
| 배포·백엔드 | GitHub Pages + Supabase. 개발은 로컬 PostgreSQL에서 하고 일괄 이전 |
| 팀장 권한 | 회장단과 동일한 관리자 권한 |
| 현행 팀 | 행사팀, 소통팀, 홍보팀, 디자인팀, 재무팀 (시드 데이터, 변경 가능) |
| 일정·유지보수 | 이 문서의 범위에서 제외 |

## 9. 구현 전 확인할 사항

- 로그인 방식: 아이디·비밀번호 (확정). Supabase Auth 설정에서 공개 가입(Allow new users to sign up)과 이메일 확인을 끈다.
- 로그인 도메인: 아이디를 이메일 형식으로 바꿀 때 쓰는 도메인. `web/config.js`와 Edge Function 환경 변수에 같은 값을 넣는다. Supabase가 받아들이는 형식인지 이전할 때 확인한다.
- 첫 관리자 등록 방법: 최초 1회에 한해 Supabase 대시보드에서 사용자를 만들고, SQL로 `accounts` 행(운영진 계정)을 넣는다. 그 뒤의 계정은 화면에서 만든다.
