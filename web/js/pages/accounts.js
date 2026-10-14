// 로그인 계정 (/#/accounts) — 관리자 전용
//   운영진 계정: 회장·부회장·팀장·운영진 개인 계정 (구성원 1명)
//   대표자 계정: 동아리 계정 (동아리 1개, 현직 대표자가 관리)
import { sb, q, qAll, adminAccounts, invalidate, lookups, USERNAME_RE, MIN_PASSWORD } from '../api.js';
import {
  html, setHtml, on, fmtDateTime, clubLabel, sortKo, sortClubs, statusBadge,
  openForm, confirmDialog, toast, showError, copyText,
} from '../ui.js';

const CLUB_ROLES = new Set(['representative']);

// 읽기 쉬운 임시 비밀번호 (헷갈리는 글자 제외)
function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

export async function render(el, _params, ctx) {
  const [accounts, assigns, members, clubs] = await Promise.all([
    q(sb.from('accounts').select('*').order('username')),
    qAll(() => sb.from('v_current_assignments').select('member_id,role_code,role_name,role_sort_order,team_name').order('id')),
    lookups.members(),
    lookups.clubs(),
  ]);
  const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));
  const rolesOf = (mid) => assigns.filter((a) => a.member_id === mid).sort((a, b) => a.role_sort_order - b.role_sort_order);
  const staffRoleLabel = (mid) => rolesOf(mid).filter((a) => !CLUB_ROLES.has(a.role_code))
    .map((a) => [a.team_name, a.role_name].filter(Boolean).join(' ')).join(', ');

  const staffAccounts = sortKo(accounts.filter((a) => a.kind === 'staff'), (a) => memberById[a.member_id]?.name);
  const clubAccounts = sortClubs(accounts.filter((a) => a.kind === 'club'), (a) => clubById[a.club_id]?.name);
  const adminAccounts_ = accounts.filter((a) => a.kind === 'admin');
  const isSuper = ctx.access.kind === 'admin'; // 관리자 계정은 관리자 계정만 관리한다
  const hasAccount = new Set(accounts.map((a) => a.member_id ?? a.club_id));
  // 운영진 계정 대상: 대표자 외의 현직 역할이 있는 사람
  const staffIds = [...new Set(assigns.filter((a) => !CLUB_ROLES.has(a.role_code)).map((a) => a.member_id))];
  const staffWithout = sortKo(staffIds.filter((id) => !hasAccount.has(id)).map((id) => memberById[id]).filter(Boolean), (m) => m.name);
  const clubsWithout = clubs.filter((c) => c.status !== 'inactive' && !hasAccount.has(c.id));

  const accountRow = (a) => {
    const target = a.kind === 'staff'
      ? html`<a href="#/members/${a.member_id}">${memberById[a.member_id]?.name ?? '(알 수 없음)'}</a> <span class="muted small">${staffRoleLabel(a.member_id) || '현직 역할 없음'}</span>`
      : a.kind === 'club'
        ? html`<a href="#/clubs/${a.club_id}">${clubLabel(clubById[a.club_id])}</a> ${clubById[a.club_id] ? statusBadge(clubById[a.club_id].status) : ''}`
        : html`<span class="muted">전체 권한 · 구성원 정보에 나타나지 않음</span>`;
    const manageable = a.kind !== 'admin' || isSuper;
    return html`<tr>
      <td class="mono"><strong>${a.username}</strong></td>
      <td class="wrap">${target}</td>
      <td class="small muted">${fmtDateTime(a.password_changed_at) || '-'}</td>
      <td class="small muted">${fmtDateTime(a.created_at)}</td>
      <td class="actions">${manageable ? html`
        <button class="btn xs" data-reset="${a.auth_user_id}">비밀번호 재설정</button>
        ${a.auth_user_id === ctx.access.auth_user_id ? '' : html`<button class="btn xs ghost" data-delete="${a.auth_user_id}">삭제</button>`}` : ''}
      </td>
    </tr>`;
  };
  const table = (rows, empty) => (rows.length ? html`<table class="table">
      <thead><tr><th>아이디</th><th>연결</th><th>비밀번호 변경</th><th>생성</th><th></th></tr></thead>
      <tbody>${rows.map(accountRow)}</tbody></table>` : html`<div class="empty">${empty}</div>`);

  setHtml(el, html`
    <div class="page-head">
      <div><h1>로그인 계정</h1><div class="sub">운영진 개인 계정 ${staffAccounts.length}개 · 대표자(동아리) 계정 ${clubAccounts.length}개</div></div>
      <div class="page-actions">
        ${isSuper ? html`<button class="btn" data-create="admin">관리자 계정 만들기</button>` : ''}
        <button class="btn" data-create="club">대표자 계정 만들기</button>
        <button class="btn primary" data-create="staff">운영진 계정 만들기</button>
      </div>
    </div>

    ${staffWithout.length || clubsWithout.length ? html`
      <div class="notice info" style="margin-bottom:16px">
        ${staffWithout.length ? html`<div>계정이 없는 운영진 ${staffWithout.length}명: ${staffWithout.slice(0, 8).map((m) => m.name).join(', ')}${staffWithout.length > 8 ? ' …' : ''}</div>` : ''}
        ${clubsWithout.length ? html`<div>계정이 없는 동아리 ${clubsWithout.length}개: ${clubsWithout.slice(0, 8).map((c) => c.name).join(', ')}${clubsWithout.length > 8 ? ' …' : ''}</div>` : ''}
      </div>` : ''}

    <div class="card">
      <div class="card-head"><h2>운영진 계정</h2><span class="hint">회장·부회장·팀장·운영진 개인 계정</span></div>
      <div class="card-body flush table-wrap">${table(staffAccounts, '운영진 계정이 없습니다.')}</div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>대표자 계정</h2><span class="hint">동아리 소유 · 현직 대표자가 관리. 대표자가 바뀌면 비밀번호를 재설정해 넘깁니다</span></div>
      <div class="card-body flush table-wrap">${table(clubAccounts, '대표자 계정이 없습니다.')}</div>
    </div>
    ${adminAccounts_.length ? html`<div class="card" style="margin-top:16px">
      <div class="card-head"><h2>관리자 계정</h2><span class="hint">구성원·동아리에 연결되지 않은 전체 권한 계정 · 관리자 계정만 관리할 수 있습니다</span></div>
      <div class="card-body flush table-wrap">${table(adminAccounts_, '')}</div>
    </div>` : ''}`);

  const guard = (fn) => async (...args) => { try { await fn(...args); } catch (e) { showError(e); } };
  const byId = Object.fromEntries(accounts.map((a) => [a.auth_user_id, a]));
  const accountName = (a) => (a.kind === 'staff' ? memberById[a.member_id]?.name : a.kind === 'club' ? clubById[a.club_id]?.name : '관리자') ?? a.username;

  // 만든 뒤 아이디·비밀번호를 한 번 보여 준다 (전달용)
  async function showCredentials(title, username, password) {
    const text = `UNIDEV 대시보드 로그인\n아이디: ${username}\n비밀번호: ${password}\n(처음 로그인한 뒤 비밀번호를 바꿔 주세요)`;
    await openForm({
      title,
      description: `아이디 ${username} / 비밀번호 ${password} — 이 창을 닫으면 비밀번호를 다시 볼 수 없습니다. 당사자에게 전달하고 첫 로그인 뒤 바꾸도록 안내하세요.`,
      submitLabel: '복사하고 닫기',
      onSubmit: async () => { await copyText(text); return true; },
    });
  }

  on(el, 'click', '[data-create]', guard(async (_e, b) => {
    const kind = b.dataset.create;
    const options = kind === 'staff'
      ? staffWithout.map((m) => ({ value: m.id, label: `${m.name} · ${staffRoleLabel(m.id)}` }))
      : kind === 'club'
        ? clubsWithout.map((c) => ({ value: c.id, label: `${c.name}${c.status === 'pending' ? ' (심사 중)' : ''}` }))
        : null;
    if (options && !options.length) return toast(kind === 'staff' ? '계정이 없는 운영진이 없습니다.' : '계정이 없는 동아리가 없습니다.');
    const password = tempPassword();
    let created;
    const r = await openForm({
      title: { staff: '운영진 계정 만들기', club: '대표자(동아리) 계정 만들기', admin: '관리자 계정 만들기' }[kind],
      description: {
        staff: '개인 계정입니다. 대표자 외의 현직 역할이 있는 구성원만 고를 수 있습니다.',
        club: '동아리 소유 계정입니다. 현직 대표자에게 아이디·비밀번호를 전달합니다.',
        admin: '구성원·동아리에 연결되지 않는 전체 권한 계정입니다. 구성원 목록·조직도 등 어디에도 나타나지 않습니다.',
      }[kind],
      fields: [
        ...(options ? [{ name: 'target', label: kind === 'staff' ? '구성원' : '동아리', type: 'pick', options, required: true }] : []),
        { name: 'username', label: '아이디', required: true, placeholder: kind === 'staff' ? '예: hong.gildong' : '예: catdog',
          help: '이메일이 아니라 로그인 아이디입니다. 영문 소문자·숫자로 시작하는 3~32자 (영문 소문자·숫자·마침표·밑줄·하이픈). 연락용 이메일은 구성원 정보에 따로 적습니다.' },
        { name: 'password', label: '임시 비밀번호', value: password, required: true, help: `${MIN_PASSWORD}자 이상. 자동으로 만든 값을 그대로 써도 됩니다.` },
      ],
      submitLabel: '만들기',
      onSubmit: async (v) => {
        const username = v.username.toLowerCase();
        if (username.includes('@')) throw new Error(`이메일이 아니라 아이디를 넣어 주세요. 예: '${username.split('@')[0]}'`);
        if (!USERNAME_RE.test(username)) throw new Error('아이디 형식이 맞지 않습니다. 영문 소문자·숫자로 시작하는 3~32자이고, 영문 소문자·숫자·마침표·밑줄·하이픈만 쓸 수 있습니다.');
        if (v.password.length < MIN_PASSWORD) throw new Error(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`);
        await adminAccounts({
          action: 'create', kind, username, password: v.password,
          member_id: kind === 'staff' ? v.target : null,
          club_id: kind === 'club' ? v.target : null,
        });
        created = { username, password: v.password };
        return true;
      },
    });
    if (!r) return;
    invalidate();
    await showCredentials('계정을 만들었습니다', created.username, created.password);
    ctx.reload();
  }));

  on(el, 'click', '[data-reset]', guard(async (_e, b) => {
    const a = byId[b.dataset.reset];
    const password = tempPassword();
    let newPassword;
    const r = await openForm({
      title: `비밀번호 재설정 · ${a.username}`,
      description: a.kind === 'club'
        ? `${accountName(a)} 대표자 계정입니다. 대표자가 바뀌었다면 새 대표자에게 전달하세요.`
        : `${accountName(a)}님의 개인 계정입니다.`,
      fields: [{ name: 'password', label: '새 임시 비밀번호', value: password, required: true, help: `${MIN_PASSWORD}자 이상` }],
      submitLabel: '재설정',
      onSubmit: async (v) => {
        if (v.password.length < MIN_PASSWORD) throw new Error(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`);
        await adminAccounts({ action: 'reset_password', auth_user_id: a.auth_user_id, password: v.password });
        newPassword = v.password;
        return true;
      },
    });
    if (!r) return;
    await showCredentials('비밀번호를 재설정했습니다', a.username, newPassword);
    ctx.reload();
  }));

  on(el, 'click', '[data-delete]', guard(async (_e, b) => {
    const a = byId[b.dataset.delete];
    const ok = await confirmDialog(`${a.username} (${accountName(a)}) 계정을 삭제합니다. 이 아이디로 더 이상 로그인할 수 없습니다. 구성원·동아리 정보는 그대로 남습니다.`,
      { title: '계정 삭제', confirmLabel: '삭제', danger: true });
    if (!ok) return;
    await adminAccounts({ action: 'delete', auth_user_id: a.auth_user_id });
    toast('삭제했습니다.');
    ctx.reload();
  }));
}
