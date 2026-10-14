-- 0008 대표자(동아리) 계정이 자기 동아리의 대표자 이력을 관리한다
--   - 자기 동아리의 '대표자' 역할 배정만 추가·수정·삭제 (대리인·팀·다른 동아리 배정은 관리자만)
--   - 새 대표자를 등록할 수 있도록 자기 동아리 소속 구성원 추가 허용
--   - 처리 내역은 변경 이력에 대표자 계정으로 남는다

-- 이 배정이 '대표자' 역할인지
create or replace function public.is_representative_role(p_role_id smallint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.roles where id = p_role_id and code = 'representative')
$$;

revoke execute on function public.is_representative_role(smallint) from public, anon;
grant execute on function public.is_representative_role(smallint) to authenticated;

create policy role_assignments_club_insert on public.role_assignments for insert to authenticated
  with check (public.represents_club(club_id) and public.is_representative_role(role_id));
create policy role_assignments_club_update on public.role_assignments for update to authenticated
  using (public.represents_club(club_id) and public.is_representative_role(role_id))
  with check (public.represents_club(club_id) and public.is_representative_role(role_id));
create policy role_assignments_club_delete on public.role_assignments for delete to authenticated
  using (public.represents_club(club_id) and public.is_representative_role(role_id));

create policy members_club_insert on public.members for insert to authenticated
  with check (public.represents_club(club_id));
