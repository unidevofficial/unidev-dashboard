// Supabase Edge Function: 로그인 계정 관리 (관리자 전용)
//   POST { action: 'create', kind: 'staff'|'club'|'admin', username, password, member_id?, club_id? } → { auth_user_id }
//   POST { action: 'reset_password', auth_user_id, password }                              → { ok }
//   POST { action: 'delete', auth_user_id }                                                → { ok }
//
// Supabase Auth 사용자 생성·삭제·비밀번호 변경에는 service_role 키가 필요하므로 이 함수가 처리한다.
// accounts 행은 호출한 관리자 본인의 권한으로 DB 함수(admin_register_account 등)를 불러 기록한다.
// (DB에서도 is_admin()을 다시 확인하고, 변경 이력에 처리자가 남는다)
//
// 배포:  supabase functions deploy admin-accounts
// 비밀값(선택): supabase secrets set LOGIN_DOMAIN=unidev.local ALLOWED_ORIGIN=https://<계정>.github.io
//        (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동으로 넣는다)
//
// 로컬 개발에서는 scripts/local-auth.mjs가 같은 계약으로 흉내 낸다. 둘을 함께 고칠 것.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// web/config.js의 loginDomain과 같아야 한다. 비밀값을 설정하지 않으면 기본값을 쓴다.
const LOGIN_DOMAIN = Deno.env.get('LOGIN_DOMAIN') ?? 'unidev.local';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MIN_PASSWORD = 8;

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  // 호출한 사용자의 권한으로 DB에 접속하는 클라이언트 (RLS·is_admin 확인용)
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_admin');
  if (adminErr || !isAdmin) return json(403, { error: '계정 관리는 관리자만 할 수 있습니다.' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' });
  }
  const password = String(body.password ?? '');

  try {
    switch (body.action) {
      case 'create': {
        const username = String(body.username ?? '').trim().toLowerCase();
        if (!USERNAME_RE.test(username)) return json(400, { error: '아이디는 영문 소문자·숫자로 시작하는 3~32자(영문 소문자·숫자·._-)여야 합니다.' });
        if (password.length < MIN_PASSWORD) return json(400, { error: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.` });

        const { data, error } = await admin.auth.admin.createUser({
          email: `${username}@${LOGIN_DOMAIN}`,
          password,
          email_confirm: true, // 실제 메일을 보내지 않는다
        });
        if (error) {
          const taken = /already|registered|exists/i.test(error.message);
          return json(taken ? 409 : 400, { error: taken ? '이미 사용 중인 아이디입니다.' : error.message });
        }
        const authUserId = data.user.id;
        const { error: regErr } = await userClient.rpc('admin_register_account', {
          p_auth_user_id: authUserId,
          p_username: username,
          p_kind: body.kind,
          p_member_id: body.member_id ?? null,
          p_club_id: body.club_id ?? null,
        });
        if (regErr) {
          await admin.auth.admin.deleteUser(authUserId);
          return json(400, { error: regErr.message });
        }
        return json(200, { auth_user_id: authUserId });
      }

      case 'reset_password': {
        if (password.length < MIN_PASSWORD) return json(400, { error: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.` });
        const id = String(body.auth_user_id ?? '');
        const { data: canManage } = await userClient.rpc('can_manage_account', { p_auth_user_id: id });
        if (!canManage) return json(403, { error: '이 계정의 비밀번호를 재설정할 권한이 없습니다.' });
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) return json(400, { error: error.message });
        await userClient.rpc('mark_password_changed', { p_auth_user_id: id });
        return json(200, { ok: true });
      }

      case 'delete': {
        const id = String(body.auth_user_id ?? '');
        const { error: rmErr } = await userClient.rpc('admin_remove_account', { p_auth_user_id: id });
        if (rmErr) return json(400, { error: rmErr.message });
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: `알 수 없는 작업: ${body.action}` });
    }
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
