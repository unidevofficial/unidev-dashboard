// 접속 설정. 클라이언트에는 Supabase 공개 키(anon key)만 넣는다.
// service_role 키는 절대 이 파일이나 저장소에 넣지 않는다. (소스는 공개된다고 가정)
//
// loginDomain: 로그인 아이디를 Supabase Auth의 이메일 형식(아이디@도메인)으로 바꿀 때 붙이는 값.
//   실제로 메일을 보내지 않는다. Edge Function의 LOGIN_DOMAIN, 로컬 .env의 LOGIN_DOMAIN과 같아야 한다.
window.UNIDEV_CONFIG = {
  // localhost에서 열면 사용: npm run dev 가 띄운 로컬 PostgREST + 로그인 흉내
  local: {
    mode: 'local',
    supabaseUrl: window.location.origin,
    supabaseAnonKey: 'local-dev-anon-key',
    loginDomain: 'unidev.local',
  },
  // GitHub Pages 등 그 밖의 주소에서 사용: Supabase 프로젝트 정보로 바꾼다
  production: {
    mode: 'supabase',
    supabaseUrl: 'https://qirttqspgudlwerkmokj.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcnR0cXNwZ3VkbHdlcmttb2tqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTMxMzIsImV4cCI6MjEwNzQ4OTEzMn0.gSlcowMpvukZDHVSAEZzkZXhzOkdsaMKgC2ZSRzoqyM',
    loginDomain: 'unidev.local',
  },
};
