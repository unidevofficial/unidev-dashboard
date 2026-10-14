// 로컬 개발 전용: Supabase Auth(GoTrue)와 Edge Function 'admin-accounts'를 흉내 낸다.
//   화면(supabase-js)은 로컬과 배포 환경에서 같은 코드로 동작한다.
//   - POST /auth/v1/token?grant_type=password       아이디(이메일 형식)·비밀번호 로그인
//   - POST /auth/v1/token?grant_type=refresh_token  세션 갱신
//   - GET  /auth/v1/user, PUT /auth/v1/user         사용자 조회, 비밀번호 변경
//   - POST /auth/v1/logout
//   - POST /functions/v1/admin-accounts             계정 생성·비밀번호 재설정·삭제 (관리자)
//   - GET  /dev/accounts, POST /dev/quick-login     개발용 빠른 로그인 (비밀번호 없이)
// 비밀번호는 로컬 auth.users에 bcrypt(pgcrypto)로 저장한다. (db/local/00_supabase_compat.sql)
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pgEnv, psqlPath } from './lib.mjs';

const ACCESS_TTL = 3600;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MIN_PASSWORD = 8;

export function createLocalAuth(env, { pgrstUrl }) {
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const now = () => Math.floor(Date.now() / 1000);

  function signJwt(payload) {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    const sig = createHmac('sha256', env.JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  function verifyJwt(token) {
    const [h, b, sig] = String(token || '').split('.');
    if (!h || !b || !sig) return null;
    const expected = createHmac('sha256', env.JWT_SECRET).update(`${h}.${b}`).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    return payload.exp && payload.exp > now() ? payload : null;
  }

  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const serviceToken = () => signJwt({ role: 'service_role', iat: now(), exp: now() + 60 });

  // psql로 한 줄 JSON을 돌려받는 SQL 실행. 값은 psql 변수(:'name')로 넘겨 SQL 주입을 막는다.
  function sql(query, vars = {}) {
    const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', env.PGDATABASE];
    for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v ?? ''}`);
    const r = spawnSync(psqlPath(env), args, { input: query, env: pgEnv(env, { PGCLIENTENCODING: 'UTF8' }), encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stderr || 'psql 실패').trim());
    const out = r.stdout.trim();
    return out ? JSON.parse(out) : null;
  }

  async function rpc(fn, args, token) {
    const r = await fetch(`${pgrstUrl}/rpc/${fn}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw Object.assign(new Error(data?.message || r.statusText), { status: r.status });
    return data;
  }

  // ------------------------------------------------------------------
  // 세션
  // ------------------------------------------------------------------
  const refreshTokens = new Map(); // refresh_token → user id (서버를 다시 켜면 사라진다)

  const userJson = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    created_at: u.created_at, updated_at: u.updated_at, last_sign_in_at: u.last_sign_in_at,
  });

  function issueSession(u) {
    const iat = now();
    const access = signJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat, exp: iat + ACCESS_TTL });
    const refresh = randomBytes(24).toString('base64url');
    refreshTokens.set(refresh, u.id);
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: iat + ACCESS_TTL, refresh_token: refresh, user: userJson(u) };
  }

  const USER_COLS = `json_build_object('id', id, 'email', email, 'created_at', created_at, 'updated_at', updated_at, 'last_sign_in_at', last_sign_in_at)`;
  const findUser = (id) => sql(`select ${USER_COLS} from auth.users where id = :'id'::uuid`, { id });

  async function handleAuth(req, res, url, body, sendJson) {
    const authError = (_res, status, code, msg) =>
      sendJson(res, status, { code: status, error_code: code, msg, error: code, error_description: msg });
    const path = url.pathname.slice('/auth/v1'.length);

    if (path === '/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = sql(`update auth.users set last_sign_in_at = now()
                        where lower(email) = lower(:'email') and encrypted_password = crypt(:'password', encrypted_password)
                        returning ${USER_COLS}`, { email: body.email, password: body.password });
        if (!u) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
        return sendJson(res, 200, issueSession(u));
      }
      if (grant === 'refresh_token') {
        const id = refreshTokens.get(body.refresh_token);
        if (!id) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        refreshTokens.delete(body.refresh_token);
        const u = findUser(id);
        if (!u) return authError(res, 400, 'user_not_found', 'User not found');
        return sendJson(res, 200, issueSession(u));
      }
      return authError(res, 400, 'unsupported_grant_type', 'unsupported grant_type');
    }

    const claims = verifyJwt(bearer(req));
    if (path === '/logout') {
      return sendJson(res, 204, null);
    }
    if (path === '/user') {
      if (!claims?.sub) return authError(res, 401, 'bad_jwt', 'invalid JWT');
      if (req.method === 'PUT') {
        if (body.password != null) {
          if (String(body.password).length < MIN_PASSWORD) return authError(res, 422, 'weak_password', `Password should be at least ${MIN_PASSWORD} characters.`);
          sql(`update auth.users set encrypted_password = crypt(:'password', gen_salt('bf')), updated_at = now() where id = :'id'::uuid`,
            { id: claims.sub, password: body.password });
        }
      }
      const u = findUser(claims.sub);
      return u ? sendJson(res, 200, userJson(u)) : authError(res, 404, 'user_not_found', 'User not found');
    }
    return authError(res, 404, 'not_found', 'Not found');
  }

  // ------------------------------------------------------------------
  // Edge Function 'admin-accounts' (supabase/functions/admin-accounts/index.ts와 같은 계약)
  // ------------------------------------------------------------------
  async function handleAdminAccounts(req, res, body, sendJson) {
    const fail = (status, message) => sendJson(res, status, { error: message });
    const token = bearer(req);
    if (!verifyJwt(token)?.sub) return fail(401, '로그인이 필요합니다.');
    if (!(await rpc('is_admin', {}, token))) return fail(403, '계정 관리는 관리자만 할 수 있습니다.');

    const { action } = body;
    try {
      if (action === 'create') {
        const username = String(body.username || '').trim().toLowerCase();
        if (!USERNAME_RE.test(username)) return fail(400, '아이디는 영문 소문자·숫자로 시작하는 3~32자(영문 소문자·숫자·._-)여야 합니다.');
        if (String(body.password || '').length < MIN_PASSWORD) return fail(400, `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`);
        const email = `${username}@${env.LOGIN_DOMAIN}`;
        if (sql(`select to_json(true) from auth.users where lower(email) = lower(:'email')`, { email })) return fail(409, '이미 사용 중인 아이디입니다.');
        const user = sql(`insert into auth.users (email, encrypted_password) values (:'email', crypt(:'password', gen_salt('bf')))
                          returning json_build_object('id', id)`, { email, password: body.password });
        try {
          await rpc('admin_register_account', {
            p_auth_user_id: user.id, p_username: username, p_kind: body.kind,
            p_member_id: body.member_id ?? null, p_club_id: body.club_id ?? null,
          }, token);
        } catch (e) {
          sql(`delete from auth.users where id = :'id'::uuid returning to_json(id)`, { id: user.id });
          return fail(400, e.message);
        }
        return sendJson(res, 200, { auth_user_id: user.id });
      }
      if (action === 'reset_password') {
        if (String(body.password || '').length < MIN_PASSWORD) return fail(400, `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`);
        if (!(await rpc('can_manage_account', { p_auth_user_id: body.auth_user_id }, token))) return fail(403, '이 계정의 비밀번호를 재설정할 권한이 없습니다.');
        const ok = sql(`update auth.users set encrypted_password = crypt(:'password', gen_salt('bf')), updated_at = now()
                         where id = :'id'::uuid returning to_json(true)`, { id: body.auth_user_id, password: body.password });
        if (!ok) return fail(404, '계정을 찾을 수 없습니다.');
        await rpc('mark_password_changed', { p_auth_user_id: body.auth_user_id }, token);
        return sendJson(res, 200, { ok: true });
      }
      if (action === 'delete') {
        await rpc('admin_remove_account', { p_auth_user_id: body.auth_user_id }, token);
        sql(`delete from auth.users where id = :'id'::uuid returning to_json(true)`, { id: body.auth_user_id });
        return sendJson(res, 200, { ok: true });
      }
      return fail(400, `알 수 없는 작업: ${action}`);
    } catch (e) {
      return fail(e.status && e.status < 500 ? e.status : 500, e.message);
    }
  }

  // ------------------------------------------------------------------
  // 개발용 빠른 로그인 (로컬 전용, 비밀번호를 화면에 노출하지 않는다)
  // ------------------------------------------------------------------
  async function devAccounts() {
    const r = await fetch(`${pgrstUrl}/accounts?select=auth_user_id,username,kind,member_id,club_id,members(name),clubs(name)&order=kind.desc,username`,
      { headers: { authorization: `Bearer ${serviceToken()}` } });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).map((a) => ({ username: a.username, kind: a.kind, label: a.members?.name ?? a.clubs?.name ?? (a.kind === 'admin' ? '관리자' : '') }));
  }

  function devQuickLogin(username) {
    const u = sql(`select ${USER_COLS} from auth.users where lower(email) = lower(:'email')`, { email: `${username}@${env.LOGIN_DOMAIN}` });
    return u ? issueSession(u) : null;
  }

  return { handleAuth, handleAdminAccounts, devAccounts, devQuickLogin };
}
