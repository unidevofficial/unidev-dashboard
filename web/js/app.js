// 앱 진입점: 로그인 확인 → 권한 요약 → 해시 라우팅 (/#/clubs)
import { auth, loadAccess, invalidate, isLocal, MIN_PASSWORD } from './api.js';
import { html, raw, setHtml, showError, openForm, toast } from './ui.js';

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  clubs: '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/>',
  members: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.5 4.5 4.5"/>',
  org: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2.5" y="16" width="6" height="5" rx="1"/><rect x="15.5" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M5.5 16v-4h13v4"/>',
  contacts: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 17.5c.9-2 2.5-3 4.5-3s3.6 1 4.5 3"/>',
  meetings: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  logs: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  accounts: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const NAV = [
  { path: '/', label: '현황 요약', icon: 'home' },
  { path: '/clubs', label: '동아리', icon: 'clubs' },
  { path: '/members', label: '구성원', icon: 'members' },
  { path: '/org', label: '조직도·팀', icon: 'org' },
  { path: '/contacts', label: '연락망', icon: 'contacts' },
  { path: '/meetings', label: '회의·출결', icon: 'meetings' },
  { path: '/logs', label: '변경 이력', icon: 'logs', admin: true },
  { path: '/accounts', label: '로그인 계정', icon: 'accounts', admin: true },
];

const ROUTES = [
  { pattern: '/', page: () => import('./pages/dashboard.js') },
  { pattern: '/clubs', page: () => import('./pages/clubs.js') },
  { pattern: '/clubs/:id', page: () => import('./pages/club-detail.js') },
  { pattern: '/members', page: () => import('./pages/members.js') },
  { pattern: '/members/:id', page: () => import('./pages/member-detail.js') },
  { pattern: '/org', page: () => import('./pages/org.js') },
  { pattern: '/contacts', page: () => import('./pages/contacts.js') },
  { pattern: '/meetings', page: () => import('./pages/meetings.js') },
  { pattern: '/meetings/:id', page: () => import('./pages/meeting-detail.js') },
  { pattern: '/logs', page: () => import('./pages/logs.js'), admin: true },
  { pattern: '/accounts', page: () => import('./pages/accounts.js'), admin: true },
];

const app = document.getElementById('app');
let ctx = null;

function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  return h.split('?')[0] || '/';
}
export function navigate(path) {
  location.hash = `#${path}`;
}

function matchRoute(path) {
  for (const r of ROUTES) {
    const keys = [];
    const re = new RegExp(`^${r.pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    const m = path.match(re);
    if (m) return { route: r, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

function renderShell() {
  const a = ctx.access;
  const roles = a.kind === 'club' ? ['대표자 계정'] : a.kind === 'admin' ? ['관리자 계정'] : [...new Set((a.roles || []).map((r) => r.name))];
  const myPage = a.kind === 'club' ? `#/clubs/${a.club_id}` : a.kind === 'admin' ? '#/accounts' : `#/members/${a.member_id}`;
  setHtml(app, html`
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">U</div><div><div class="brand-name">UNIDEV</div><div class="brand-sub">통합 정보 관리</div></div></div>
        <nav class="nav">
          ${NAV.filter((n) => !n.admin || a.is_admin).map((n) => html`<a href="#${n.path}" data-path="${n.path}">${raw(icon(n.icon))}<span>${n.label}</span></a>`)}
        </nav>
        <div class="sidebar-foot">
          ${isLocal ? html`<div class="env-badge">로컬 개발 DB</div>` : ''}
          <div class="me-name"><a href="${myPage}">${a.name}</a> <span class="muted small">${a.username}</span></div>
          <div class="me-roles">${roles.join(' · ')}${a.is_admin && a.kind !== 'admin' ? ' (관리자)' : ''}</div>
          <div class="row"><button class="btn sm" data-password>비밀번호 변경</button><button class="btn sm ghost" data-logout>로그아웃</button></div>
        </div>
      </aside>
      <div class="main">
        <div class="topbar"><button class="btn icon-btn ghost" data-menu aria-label="메뉴">${raw(icon('menu'))}</button><strong>UNIDEV</strong></div>
        <main class="content" id="page"></main>
      </div>
    </div>`);
  app.querySelector('[data-logout]').addEventListener('click', async () => {
    await auth.signOut();
    location.hash = '#/';
    location.reload();
  });
  app.querySelector('[data-password]').addEventListener('click', changePassword);
  const shell = app.querySelector('.shell');
  app.querySelector('[data-menu]').addEventListener('click', () => shell.classList.toggle('nav-open'));
  app.querySelector('.nav').addEventListener('click', () => shell.classList.remove('nav-open'));
}

function highlightNav(path) {
  for (const a of app.querySelectorAll('.nav a')) {
    const p = a.dataset.path;
    a.classList.toggle('active', p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`));
  }
}

let renderSeq = 0;
async function route() {
  if (!ctx) return;
  const path = currentPath();
  const pageEl = document.getElementById('page');
  const found = matchRoute(path);
  highlightNav(path);
  const seq = ++renderSeq;
  if (!found || (found.route.admin && !ctx.access.is_admin)) {
    setHtml(pageEl, html`<div class="denied"><h1>${found ? '관리자 전용 화면입니다' : '페이지를 찾을 수 없습니다'}</h1><p><a href="#/">현황 요약으로</a></p></div>`);
    return;
  }
  pageEl.innerHTML = '<div class="boot">불러오는 중…</div>';
  try {
    const mod = await found.route.page();
    if (seq !== renderSeq) return;
    const container = document.createElement('div');
    await mod.render(container, found.params, ctx);
    if (seq !== renderSeq) return;
    pageEl.replaceChildren(container);
    window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    showError(e);
    setHtml(pageEl, html`<div class="denied"><h1>화면을 불러오지 못했습니다</h1><p>${e.message ?? ''}</p></div>`);
  }
}

async function changePassword() {
  const r = await openForm({
    title: '비밀번호 변경',
    description: ctx.access.kind === 'club'
      ? '동아리 대표자 계정입니다. 대표자가 바뀌면 관리자에게 비밀번호 재설정을 요청하세요.'
      : null,
    fields: [
      { name: 'password', label: '새 비밀번호', type: 'password', required: true, help: `${MIN_PASSWORD}자 이상` },
      { name: 'confirm', label: '새 비밀번호 확인', type: 'password', required: true },
    ],
    submitLabel: '변경',
    onSubmit: async (v) => {
      if (v.password.length < MIN_PASSWORD) throw new Error(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`);
      if (v.password !== v.confirm) throw new Error('두 비밀번호가 다릅니다.');
      await auth.changePassword(v.password);
      return true;
    },
  });
  if (r) toast('비밀번호를 바꿨습니다.');
}

async function showLogin() {
  const mod = await import('./pages/login.js');
  app.replaceChildren();
  const container = document.createElement('div');
  app.appendChild(container);
  await mod.render(container, {}, { onSignedIn: start });
}

function showDenied(access) {
  const reason = !access ? '이 계정은 구성원이나 동아리에 연결되어 있지 않습니다. 관리자에게 문의하세요.'
    : access.kind === 'club' ? `${access.name}은(는) 현재 정등록·가등록 상태가 아니어서 정보를 볼 수 없습니다.`
    : `${access.name}님은 현재 맡고 있는 역할이 없어 정보를 볼 수 없습니다.`;
  setHtml(app, html`<div class="denied card" style="padding:32px">
    <h1>열람 권한이 없습니다</h1>
    <p>${reason}</p>
    <button class="btn" data-logout>로그아웃</button></div>`);
  app.querySelector('[data-logout]').addEventListener('click', async () => { await auth.signOut(); location.reload(); });
}

async function start() {
  invalidate();
  try {
    const session = await auth.getSession();
    if (!session) {
      ctx = null;
      return showLogin();
    }
    const access = await loadAccess();
    if (!access || !access.is_staff) {
      ctx = null;
      return showDenied(access);
    }
    ctx = {
      access,
      isAdmin: !!access.is_admin,
      memberId: access.member_id,
      isClub: access.kind === 'club',
      clubId: access.club_id,
      representsClub: (id) => access.kind === 'club' && access.club_id === id,
      navigate,
      reload: () => { invalidate(); route(); },
    };
    renderShell();
    route();
  } catch (e) {
    showError(e);
    if (/JWT|로그인/.test(e.message || '')) {
      await auth.signOut();
      return showLogin();
    }
    setHtml(app, html`<div class="denied"><h1>연결할 수 없습니다</h1><p>${e.message ?? String(e)}</p>
      ${isLocal ? html`<p class="muted small">로컬 개발 서버(npm run dev)와 PostgreSQL이 실행 중인지 확인하세요.</p>` : ''}</div>`);
  }
}

window.addEventListener('hashchange', route);
auth.onSignedOut(() => { if (ctx) start(); });
start();

