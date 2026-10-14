# UNIDEV 통합 정보 관리 대시보드

기획 명세는 [SPEC.md](SPEC.md). 정적 사이트(GitHub Pages) + Supabase(PostgreSQL·Auth·RLS) 구성이며,
개발은 로컬 PostgreSQL에서 하고 완성 후 Supabase로 옮긴다.

## 폴더 구성

| 경로 | 내용 | Supabase 이전 |
|---|---|---|
| `db/migrations/` | 스키마·트리거·뷰·RPC·RLS (`NNNN_설명.sql`) | **그대로 적용** |
| `db/seed/` | 역할 종류, 현행 팀 | **적용** |
| `db/local/00_supabase_compat.sql` | 로컬에 Supabase의 `anon`·`authenticated`·`service_role` 역할과 `auth.uid()` 등을 만든다 | 제외 |
| `db/local/90_sample_data.sql` | 화면 확인용 가상 데이터 | 제외 |
| `db/local/tests/` | RLS·트리거 검증 테스트 | 제외 |
| `web/` | 화면 (빌드 없는 정적 사이트, 해시 라우팅) | GitHub Pages로 배포 |
| `scripts/` | 로컬 DB·개발 서버 스크립트 | — |
| `tools/postgrest.exe` | 로컬용 PostgREST (Supabase가 쓰는 REST 서버, 저장소에 포함하지 않음) | — |

## 로컬 개발

필요: Node.js 20.12 이상, PostgreSQL 17 실행 파일(`C:\Program Files\PostgreSQL\17\bin`), `tools/postgrest.exe`
([PostgREST 릴리스](https://github.com/PostgREST/postgrest/releases)의 windows-x86-64 zip).

```bash
npm run db:init
```
처음 한 번만 실행한다. 프로젝트 전용 PostgreSQL 데이터 폴더(`.pgdata/`, 포트 54329)를 만들고 접속 정보를 `.env`에 기록한다.
시스템에 설치된 PostgreSQL 서비스는 건드리지 않는다.

```bash
npm run db:start
```
```bash
npm run db:reset
```
DB를 지우고 호환 스크립트 → 마이그레이션 → 시드 → 가상 데이터 순으로 다시 만든다. (`db:reset:empty`는 가상 데이터 제외)

```bash
npm run db:test
```
```bash
npm run dev
```
http://localhost:5173 에서 로그인 화면이 열린다. 아이디·비밀번호로 로그인하거나, 아래 "로컬 개발용 빠른 로그인" 목록에서 계정을 골라 바로 들어갈 수 있다.
로컬 개발용 계정의 비밀번호는 모두 `.env`의 `DEV_ACCOUNT_PASSWORD`다.

개발 서버는 PostgREST를 띄워 `/rest/v1`으로 연결하고, Supabase Auth(`/auth/v1`)와 계정 관리 Edge Function(`/functions/v1/admin-accounts`)을
흉내 낸다([scripts/local-auth.mjs](scripts/local-auth.mjs)). 그래서 화면 코드는 로컬과 Supabase에서 똑같이 동작한다.

### 실제 명단(기초 데이터) 불러오기

실제 개인정보는 저장소에 올리지 않는다. 원본 xlsx와 거기서 만든 SQL(`db/private/`)은 `.gitignore` 대상이다.

```bash
npm run db:import
```
`UNIDEV 가입 동아리 현황 및 대표자 구성.xlsx`를 읽어 `db/private/10_roster.sql`(동아리·구성원·역할 배정)과
`db/private/local/90_dev_accounts.sql`(로컬 전용 개발용 로그인 계정: 운영진 개인 계정, 동아리마다 대표자 계정)을 만들고, 확인이 필요한 항목을 출력한다.
`npm run db:reset`은 `db/private`가 있으면 실제 명단을, 없으면 가상 데이터를 넣는다. (`db:reset:sample`은 항상 가상 데이터)
`npm run db:test`는 별도 DB(`unidev_test`)에 가상 데이터를 넣어 실행하므로 개발 DB를 건드리지 않는다.

비고 칸의 변경 기록(대표자 교체, 팀장 교체, 부팀장 임명, 명칭 변경)은 역할 이력으로 옮긴다.
시작일을 알 수 없는 배정은 임기 시작일(2026-03-01)로 넣고 근거 칸에 "시작일 미상"을 남긴다.

로컬에서 사용자를 흉내 내어 SQL로 확인하려면:

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';  -- 가상 데이터의 픽셀랩 대표자 계정
select * from clubs;
rollback;
```

## Supabase로 이전

1. Supabase 프로젝트를 만들고 SQL Editor에서 `db/migrations/*.sql`, `db/seed/*.sql`을 번호 순서대로 실행한다.
   `npm run db:bundle`로 한 파일(`dist/supabase_init.sql`)로 합쳐 한 번에 실행해도 된다.
   이어서 `db/private/10_roster.sql`(실제 명단)을 실행한다. `npm run db:bundle -- --with-data`로 함께 묶을 수도 있다.
   `db/private/local/`은 로컬 전용이므로 적용하지 않는다.
   (Supabase CLI를 쓴다면 `supabase/migrations/`에 복사해 `supabase db push`)
2. Authentication 설정 (아이디·비밀번호 로그인)
   - Sign In / Providers → Email: 켜 두되 **Confirm email은 끈다** (실제 메일을 보내지 않는다)
   - **Allow new users to sign up은 끈다** (계정은 관리자만 만든다)
3. 계정 관리 Edge Function 배포 (Supabase CLI)
   ```bash
   supabase functions deploy admin-accounts
   ```
   ```bash
   supabase secrets set LOGIN_DOMAIN=unidev.local ALLOWED_ORIGIN=https://<계정>.github.io
   ```
4. `web/config.js`의 `production`에 프로젝트 URL과 **anon key만** 넣고, `loginDomain`을 위 `LOGIN_DOMAIN`과 같게 둔다. `service_role` 키는 절대 넣지 않는다.
5. 첫 관리자 계정 (SPEC 9절): Authentication → Users → Add user에서 이메일 `<아이디>@<LOGIN_DOMAIN>`, 비밀번호, Auto Confirm으로 사용자를 만든 뒤 SQL Editor에서 실행한다.
   (회장이 명단에 이미 있고 `president` 배정이 들어 있다고 가정)

   ```sql
   insert into accounts (auth_user_id, username, kind, member_id)
   values ((select id from auth.users where email = '<아이디>@<LOGIN_DOMAIN>'), '<아이디>', 'staff',
           (select id from members where name = '<회장 이름>'));
   ```
   이후의 계정은 그 관리자가 화면의 **로그인 계정** 메뉴에서 만든다.
6. 저장소 Settings → Pages → Source를 GitHub Actions로 바꾸면 `.github/workflows/pages.yml`이 `web/`을 배포한다.

### 로그인 계정

- **운영진 계정**: 회장·부회장·팀장·운영진 개인 계정. 구성원 1명에 연결된다.
- **대표자 계정**: 동아리 계정. 동아리 1개에 연결되고 현직 대표자가 관리한다. 대표자가 바뀌면 관리자가 비밀번호를 재설정해 새 대표자에게 넘긴다.
- 관리자가 계정을 만들거나 비밀번호를 재설정하면 임시 비밀번호가 한 번 표시된다. 각자 로그인 후 **비밀번호 변경**으로 바꾼다.

## 권한 설계 요약

- 모든 권한은 DB의 RLS·트리거에서 강제한다. 화면의 버튼 표시는 편의일 뿐이다.
- 비로그인(`anon`)은 어떤 테이블도 읽을 수 없다. 현직 역할이 없는 운영진 계정, 정등록·가등록이 아닌 동아리의 대표자 계정도 아무 행도 보이지 않는다.
- 뷰는 모두 `security_invoker`라서 조회하는 사람의 RLS가 그대로 적용된다.
- 대표자 계정의 동아리·현직 대표자 정보 수정, 본인 정보 수정은 트리거가 허용 항목만 통과시킨다.
- 로그인 계정(`accounts`)은 관리자 전용 DB 함수로만 기록되고, Auth 사용자 생성·삭제는 Edge Function이 `service_role` 키로 처리한다.
- `change_logs`는 트리거와 security definer 함수만 쓴다. 연락처 파기 시 이력 속 전화번호·이메일도 지운다.
