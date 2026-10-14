// 구성원 목록 (/#/members)
import { sb, qAll, lookups } from '../api.js';
import { html, setHtml, on, maskPhone, clubLabel, sortKo, showError } from '../ui.js';
import { createMemberForm } from '../forms.js';

const PAGE = 200;

export async function render(el, _params, ctx) {
  const [members, assigns, roles, teams, clubs] = await Promise.all([
    qAll(() => sb.from('members').select('id,name,university,club_id,phone,email,contact_purged_at').order('name').order('id')),
    qAll(() => sb.from('v_current_assignments').select('id,member_id,role_id,role_name,role_is_admin,role_sort_order,team_id,team_name,club_id,club_name').order('id')),
    lookups.roles(),
    lookups.teams(),
    lookups.clubs(),
  ]);
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));
  const assignsOf = new Map();
  for (const a of assigns) {
    if (!assignsOf.has(a.member_id)) assignsOf.set(a.member_id, []);
    assignsOf.get(a.member_id).push(a);
  }
  for (const list of assignsOf.values()) list.sort((a, b) => a.role_sort_order - b.role_sort_order);
  const sorted = sortKo(members, (m) => m.name);

  const state = { term: '', role: '', team: '', club: '', currentOnly: true, shown: PAGE };

  setHtml(el, html`
    <div class="page-head">
      <div><h1>구성원</h1><div class="sub">전체 ${members.length}명 · 현직 역할 보유 ${assignsOf.size}명</div></div>
      <div class="page-actions">${ctx.isAdmin ? html`<button class="btn primary" data-create>구성원 등록</button>` : ''}</div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" placeholder="이름·대학·이메일 검색" data-f="term">
        <select data-f="role"><option value="">모든 역할</option>${roles.map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select>
        <select data-f="team"><option value="">모든 팀</option>${teams.filter((t) => !t.closed_on).map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select>
        <select data-f="club"><option value="">모든 동아리</option>${clubs.map((c) => html`<option value="${c.id}">${clubLabel(c)}</option>`)}</select>
        <label class="row small"><input type="checkbox" data-f="currentOnly" checked> 현직 역할 보유자만</label>
      </div>
      <div class="table-wrap" data-list></div>
    </div>`);

  const listEl = el.querySelector('[data-list]');

  function filtered() {
    const term = state.term.toLowerCase();
    return sorted.filter((m) => {
      const list = assignsOf.get(m.id) ?? [];
      if (state.currentOnly && !list.length) return false;
      if (state.role && !list.some((a) => String(a.role_id) === state.role)) return false;
      if (state.team && !list.some((a) => a.team_id === state.team)) return false;
      if (state.club && m.club_id !== state.club && !list.some((a) => a.club_id === state.club)) return false;
      if (term && ![m.name, m.university, m.email, clubLabel(clubById[m.club_id])].some((v) => (v ?? '').toLowerCase().includes(term))) return false;
      return true;
    });
  }

  function draw() {
    const rows = filtered();
    setHtml(listEl, rows.length ? html`
      <table class="table">
        <thead><tr><th>이름</th><th>소속</th><th>현재 역할</th><th>전화번호</th><th>이메일</th></tr></thead>
        <tbody>${rows.slice(0, state.shown).map((m) => {
          const list = assignsOf.get(m.id) ?? [];
          return html`<tr class="clickable" data-id="${m.id}">
            <td><a href="#/members/${m.id}">${m.name}</a></td>
            <td>${clubLabel(clubById[m.club_id]) || '-'}</td>
            <td class="wrap"><div class="chips">${list.length
              ? list.map((a) => html`<span class="chip ${a.role_is_admin ? 'admin' : ''}">${[a.team_name, a.club_id && a.club_id !== m.club_id ? a.club_name : null, a.role_name].filter(Boolean).join(' ')}</span>`)
              : html`<span class="muted small">없음</span>`}</div></td>
            <td class="mono">${m.contact_purged_at ? html`<span class="muted small">파기됨</span>` : maskPhone(m.phone)}</td>
            <td>${m.email ?? ''}</td>
          </tr>`;
        })}</tbody>
      </table>
      ${rows.length > state.shown ? html`<div class="empty"><button class="btn sm" data-more>더 보기 (${rows.length - state.shown}명 남음)</button></div>` : ''}`
      : html`<div class="empty">조건에 맞는 구성원이 없습니다.</div>`);
  }
  draw();

  el.querySelector('.toolbar').addEventListener('input', (e) => {
    const key = e.target.dataset.f;
    if (!key) return;
    state[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
    state.shown = PAGE;
    draw();
  });
  on(el, 'click', '[data-more]', () => { state.shown += PAGE; draw(); });
  on(el, 'click', 'tr[data-id]', (e, t) => { if (!e.target.closest('a')) ctx.navigate(`/members/${t.dataset.id}`); });
  on(el, 'click', '[data-create]', async () => {
    try {
      const row = await createMemberForm();
      if (row) ctx.navigate(`/members/${row.id}`);
    } catch (e) { showError(e); }
  });
}
