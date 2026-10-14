-- 0009 '대리인' 역할 폐지
--   대리 참석은 회의 하나에만 해당하므로 출석부(attendances.proxy_name)에 이름만 적고,
--   동아리 정보(역할 배정)로는 다루지 않는다.
delete from public.role_assignments where role_id in (select id from public.roles where code = 'proxy');
delete from public.roles where code = 'proxy';
