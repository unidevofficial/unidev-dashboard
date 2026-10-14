// 데이터 접근과 로그인
//   - 로컬(localhost): npm run dev 의 PostgREST(/rest/v1)와 로그인 흉내(/auth/v1, /functions/v1)
//   - 배포(GitHub Pages): Supabase (PostgREST + Auth + Edge Function)
// 어느 쪽이든 화면 코드는 같은 supabase-js를 쓴다. 권한 통제는 DB의 RLS가 한다.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { sortClubs } from './ui.js';

const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const config = isLocalHost ? window.UNIDEV_CONFIG.local : window.UNIDEV_CONFIG.production;
export const isLocal = config.mode === 'local';

export const sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'unidev.auth' },
});

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD = 8;
const toEmail = (username) => `${username.trim().toLowerCase()}@${config.loginDomain}`;

// ---------------------------------------------------------------------
// 로그인 (아이디·비밀번호)
// ---------------------------------------------------------------------
export const auth = {
  async getSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  // 세션이 끊기면(만료·다른 탭에서 로그아웃) 호출
  onSignedOut(callback) {
    sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') callback(); });
  },

  async signIn(username, password) {
    const { error } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
    if (error) {
      if (/invalid login credentials/i.test(error.message)) throw new Error('아이디 또는 비밀번호가 맞지 않습니다.');
      throw error;
    }
  },

  async signOut() {
    await sb.auth.signOut();
  },

  async changePassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
    await rpc('mark_password_changed');
  },

  // 로컬 전용: 개발용 계정 목록과 빠른 로그인 (비밀번호 없이)
  async devAccounts() {
    const r = await fetch('/dev/accounts');
    if (!r.ok) throw new Error((await r.json()).message);
    return r.json();
  },
  async devQuickLogin(username) {
    const r = await fetch('/dev/quick-login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username }),
    });
    if (!r.ok) throw new Error((await r.json()).message);
    const s = await r.json();
    const { error } = await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
    if (error) throw error;
  },
};

// 계정 관리 (관리자): Edge Function 'admin-accounts' (로컬은 개발 서버가 흉내)
export async function adminAccounts(body) {
  const { data, error } = await sb.functions.invoke('admin-accounts', { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error ?? message; } catch { /* 본문이 JSON이 아님 */ }
    throw new Error(message);
  }
  return data;
}

// ---------------------------------------------------------------------
// 쿼리 도우미
// ---------------------------------------------------------------------
// 오류가 있으면 던지고 data를 돌려준다
export async function q(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}

// 전체 행 조회: Supabase는 한 번에 최대 1,000행(기본값)만 돌려주므로 나눠 받는다
//   qAll(() => sb.from('members').select('*').order('name'))
export async function qAll(makeBuilder, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeBuilder().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

// update/delete: RLS로 걸러져 0건이 되면 조용히 성공하므로, 결과 행 수로 확인한다
export async function qMut(builder) {
  const { data, error } = await builder.select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('권한이 없거나 대상을 찾을 수 없습니다.');
  return data;
}

export async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

// 로그인한 계정의 권한 요약
export const loadAccess = () => rpc('get_my_access');

// 자주 쓰는 목록 (화면 간 공유, 짧게 캐시)
const cache = new Map();
export function cached(key, loader, ttl = 30_000) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = loader().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { t: Date.now(), p });
  return p;
}
export const invalidate = () => cache.clear();

export const lookups = {
  roles: () => cached('roles', () => q(sb.from('roles').select('*').order('sort_order'))),
  teams: () => cached('teams', () => q(sb.from('teams').select('*').order('sort_order').order('name'))),
  clubs: () => cached('clubs', async () => sortClubs(await q(sb.from('clubs').select('id,university,name,status')))),
  members: () => cached('members', () => qAll(() => sb.from('members').select('id,name,university,club_id').order('name').order('id'))),
};
