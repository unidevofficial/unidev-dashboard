-- 역할 종류 (SPEC.md 3절). 새 직책은 행을 추가해 확장한다. (예: 부팀장 → scope='team')
insert into public.roles (code, name, scope, is_admin, sort_order) values
  ('president',      '회장',   'org',  true,  10),
  ('vice_president', '부회장', 'org',  true,  20),
  ('team_lead',      '팀장',   'team', true,  30),
  ('vice_team_lead', '부팀장', 'team', false, 35),
  ('team_member',    '팀원',   'team', false, 40),
  ('representative', '대표자', 'club', false, 50),
  ('staff',          '운영진', 'org',  false, 70)
on conflict (code) do update
  set name = excluded.name, scope = excluded.scope,
      is_admin = excluded.is_admin, sort_order = excluded.sort_order;
