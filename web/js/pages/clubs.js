// 동아리 목록 (/#/clubs)
import { sb, qAll } from '../api.js';
import { html, setHtml, on, statusBadge, CLUB_STATUS, sortClubs, showError } from '../ui.js';
import { createClubForm } from '../forms.js';

const FILTERS = [['all', '전체'], ['full', '정등록'], ['provisional', '가등록'], ['pending', '심사 중'], ['inactive', '비활성']];

export async function render(el, _params, ctx) {
  const clubs = sortClubs(
    await qAll(() => sb.from('v_club_overview').select('id,university,name,status,registered_on,member_count,representative_id,representative_name').order('id')),
  );
  const state = { filter: 'active', term: '' };

  setHtml(el, html`
    <div class="page-head">
      <div><h1>동아리</h1><div class="sub">소속 동아리 ${clubs.filter((c) => c.status !== 'inactive').length}개 (비활성 제외)</div></div>
      <div class="page-actions">${ctx.isAdmin ? html`<button class="btn primary" data-create>동아리 등록</button>` : ''}</div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" placeholder="동아리명·대학·대표자 검색" data-search>
        <div class="segmented" data-filters></div>
      </div>
      <div class="table-wrap" data-list></div>
    </div>`);

  const listEl = el.querySelector('[data-list]');
  const filtersEl = el.querySelector('[data-filters]');

  function draw() {
    const counts = { all: clubs.length, active: clubs.filter((c) => c.status !== 'inactive').length };
    for (const s of Object.keys(CLUB_STATUS)) counts[s] = clubs.filter((c) => c.status === s).length;
    const segs = [['active', '활동'], ...FILTERS];
    setHtml(filtersEl, html`${segs.map(([k, label]) => html`<button class="${state.filter === k ? 'on' : ''}" data-filter="${k}">${label}<span class="n">${counts[k]}</span></button>`)}`);

    const term = state.term.toLowerCase();
    const rows = clubs.filter((c) => {
      if (state.filter === 'active' && c.status === 'inactive') return false;
      if (!['all', 'active'].includes(state.filter) && c.status !== state.filter) return false;
      if (!term) return true;
      return [c.university, c.name, c.representative_name].some((v) => (v ?? '').toLowerCase().includes(term));
    });
    setHtml(listEl, rows.length ? html`
      <table class="table">
        <thead><tr><th>동아리명</th><th>대학</th><th>등록 구분</th><th>현직 대표자</th><th class="num">회원 수</th></tr></thead>
        <tbody>${rows.map((c) => html`
          <tr class="clickable" data-id="${c.id}">
            <td><a href="#/clubs/${c.id}"><strong>${c.name}</strong></a></td>
            <td class="muted">${c.university}</td>
            <td>${statusBadge(c.status)}</td>
            <td>${c.representative_name ?? html`<span class="badge warn">공석</span>`}</td>
            <td class="num">${c.member_count ?? ''}</td>
          </tr>`)}</tbody>
      </table>` : html`<div class="empty">조건에 맞는 동아리가 없습니다.</div>`);
  }
  draw();

  el.querySelector('[data-search]').addEventListener('input', (e) => { state.term = e.target.value.trim(); draw(); });
  on(el, 'click', '[data-filter]', (_e, t) => { state.filter = t.dataset.filter; draw(); });
  on(el, 'click', 'tr[data-id]', (e, t) => { if (!e.target.closest('a')) ctx.navigate(`/clubs/${t.dataset.id}`); });
  on(el, 'click', '[data-create]', async () => {
    try {
      const row = await createClubForm();
      if (row) ctx.navigate(`/clubs/${row.id}`);
    } catch (e) { showError(e); }
  });
}
