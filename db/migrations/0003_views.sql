-- 0003 조회용 뷰
--
-- 모든 뷰는 security_invoker로 만들어, 조회하는 사용자의 RLS가 그대로 적용되게 한다.
-- (기본값인 security definer 뷰는 소유자 권한으로 실행되어 RLS를 우회한다)

-- 전체 배정 기록 + 이름 (역대 기록 조회용). is_current로 현직 여부 표시
create view public.v_assignments with (security_invoker = true) as
select ra.id,
       ra.member_id,
       m.name          as member_name,
       m.university    as member_university,
       m.club_id       as member_club_id,
       ra.role_id,
       r.code          as role_code,
       r.name          as role_name,
       r.scope         as role_scope,
       r.is_admin      as role_is_admin,
       r.sort_order    as role_sort_order,
       ra.club_id,
       c.university    as club_university,
       c.name          as club_name,
       ra.team_id,
       t.name          as team_name,
       t.sort_order    as team_sort_order,
       ra.start_on,
       ra.end_on,
       ra.basis,
       ra.note,
       ra.created_at,
       (ra.start_on <= current_date and (ra.end_on is null or ra.end_on >= current_date)) as is_current
  from public.role_assignments ra
  join public.members m on m.id = ra.member_id
  join public.roles r   on r.id = ra.role_id
  left join public.clubs c on c.id = ra.club_id
  left join public.teams t on t.id = ra.team_id;

-- 현직 배정 + 구성원·역할·동아리·팀 이름
create view public.v_current_assignments with (security_invoker = true) as
select * from public.v_assignments where is_current;

-- 동아리 + 현직 대표자 이름·전화번호·이메일 + 공식 이메일
create view public.v_club_overview with (security_invoker = true) as
select c.*,
       rep.assignment_id  as representative_assignment_id,
       rep.member_id      as representative_id,
       rep.name           as representative_name,
       rep.phone          as representative_phone,
       rep.email          as representative_email,
       rep.start_on       as representative_since,
       (select count(distinct ca.member_id)
          from public.v_current_assignments ca
          join public.members mm on mm.id = ca.member_id
         where mm.club_id = c.id) as staff_count
  from public.clubs c
  left join lateral (
    select ca.id as assignment_id, ca.member_id, m.name, m.phone, m.email, ca.start_on
      from public.v_current_assignments ca
      join public.members m on m.id = ca.member_id
     where ca.club_id = c.id and ca.role_code = 'representative'
     order by ca.start_on desc, ca.end_on desc nulls first, ca.created_at desc
     limit 1
  ) rep on true;

-- 활동 중인 팀별 팀장·팀원 (팀원이 없는 팀도 한 행으로 나온다)
create view public.v_org_chart with (security_invoker = true) as
select t.id           as team_id,
       t.name         as team_name,
       t.description  as team_description,
       t.sort_order   as team_sort_order,
       t.established_on,
       ca.id          as assignment_id,
       ca.member_id,
       ca.member_name,
       ca.member_club_id,
       c.university   as member_club_university,
       c.name         as member_club_name,
       ca.role_id,
       ca.role_code,
       ca.role_name,
       ca.role_sort_order,
       ca.start_on
  from public.teams t
  left join public.v_current_assignments ca on ca.team_id = t.id
  left join public.clubs c on c.id = ca.member_club_id
 where t.closed_on is null;

-- 연락처 파기 대상 (SPEC 6절): 현직 역할이 없고, 마지막 종료일이 1년 이상 지났으며, 아직 파기하지 않은 구성원
-- 관리자에게만 행이 보인다.
create view public.v_contact_purge_candidates with (security_invoker = true) as
select m.id,
       m.name,
       m.university,
       m.club_id,
       (m.phone is not null) as has_phone,
       (m.email is not null) as has_email,
       last.last_end_on
  from public.members m
  join lateral (
    select max(ra.end_on) as last_end_on
      from public.role_assignments ra
     where ra.member_id = m.id
  ) last on true
 where public.is_admin()
   and m.contact_purged_at is null
   and last.last_end_on is not null
   and last.last_end_on <= (current_date - interval '1 year')::date
   and not exists (
     select 1 from public.role_assignments ra
      where ra.member_id = m.id
        and (ra.end_on is null or ra.end_on >= current_date)
   );
