-- 현행 팀 (SPEC.md 8절). 팀 이름은 이 시드에만 둔다. 코드에서는 teams.id로 참조한다.
insert into public.teams (name, sort_order)
select v.name, v.sort_order
  from (values
    ('행사팀',   10),
    ('소통팀',   20),
    ('홍보팀',   30),
    ('디자인팀', 40),
    ('재무팀',   50)
  ) as v(name, sort_order)
 where not exists (
   select 1 from public.teams t where t.name = v.name and t.closed_on is null
 );
