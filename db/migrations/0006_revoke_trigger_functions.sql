-- 0006 트리거 전용 함수는 API(/rest/v1/rpc)로 호출할 수 없게 한다
--   Supabase는 public 스키마 함수에 authenticated 실행 권한을 기본으로 직접 부여하므로
--   (0005의 'revoke ... from public'으로는 회수되지 않음) 트리거 함수의 권한을 따로 회수한다.
--   트리거는 실행 권한과 관계없이 동작한다.
revoke execute on function
  public.set_updated_at(),
  public.log_change(),
  public.check_assignment_scope(),
  public.guard_club_admin_fields(),
  public.end_club_assignments_on_inactive(),
  public.guard_member_self_fields(),
  public.end_team_assignments_on_close(),
  public.create_meeting_attendances(),
  public.set_sanction_expiry()
from authenticated, anon, public;
