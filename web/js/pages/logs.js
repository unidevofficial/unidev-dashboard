// 변경 이력 (/#/logs) — 관리자 전용 (RLS에서도 관리자만 조회 가능)
import { sb, q, lookups } from '../api.js';
import { html, setHtml, on, fmtDateTime, clubLabel, sortKo, TABLE_LABEL, LOG_ACTION, addDays, showError } from '../ui.js';
import { logRecordLabel, actionBadge, tableLabel, diffTable, actorLabel } from '../log-format.js';

const PAGE = 50;

export async function render(el, _params, ctx) {
  const [members, roles, clubs] = await Promise.all([lookups.members(), lookups.roles(), lookups.clubs()]);
  const names = {
    members: Object.fromEntries(members.map((m) => [m.id, m.name])),
    roles: Object.fromEntries(roles.map((r) => [r.id, r.name])),
    clubs: Object.fromEntries(clubs.map((c) => [c.id, clubLabel(c)])),
  };
  const state = { table: '', action: '', from: '', to: '', actor: '', rows: [], done: false, open: new Set() };

  setHtml(el, html`
    <div class="page-head">
      <div><h1>변경 이력</h1><div class="sub">모든 추가·수정·삭제와 연락처 내보내기·파기 기록</div></div>
    </div>
    <div class="card">
      <div class="toolbar" data-filters>
        <select data-f="table"><option value="">모든 대상</option>${Object.entries(TABLE_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
        <select data-f="action"><option value="">모든 작업</option>${Object.entries(LOG_ACTION).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
        <label class="row small">기간 <input type="date" data-f="from"> ~ <input type="date" data-f="to"></label>
        <select data-f="actor"><option value="">모든 처리자</option><option value="system">시스템(직접 SQL 등)</option>
          <optgroup label="운영진">${sortKo(members, (m) => m.name).map((m) => html`<option value="${m.id}">${m.name}</option>`)}</optgroup>
          <optgroup label="대표자 계정">${clubs.map((c) => html`<option value="club:${c.id}">${c.name}</option>`)}</optgroup></select>
      </div>
      <div class="table-wrap" data-list></div>
    </div>`);

  const listEl = el.querySelector('[data-list]');

  async function load(reset) {
    if (reset) { state.rows = []; state.done = false; state.open.clear(); }
    let qb = sb.from('change_logs').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
    if (state.table) qb = qb.eq('table_name', state.table);
    if (state.action) qb = qb.eq('action', state.action);
    if (state.from) qb = qb.gte('created_at', new Date(`${state.from}T00:00:00`).toISOString());
    if (state.to) qb = qb.lt('created_at', new Date(`${addDays(state.to, 1)}T00:00:00`).toISOString());
    if (state.actor === 'system') qb = qb.is('actor_member_id', null).is('actor_club_id', null);
    else if (state.actor.startsWith('club:')) qb = qb.eq('actor_club_id', state.actor.slice(5));
    else if (state.actor) qb = qb.eq('actor_member_id', state.actor);
    const rows = await q(qb.range(state.rows.length, state.rows.length + PAGE - 1));
    state.rows.push(...rows);
    state.done = rows.length < PAGE;
    draw();
  }

  const recordLink = (l) => {
    const label = logRecordLabel(l, names) || l.record_id;
    if (l.action === 'export' || l.action === 'delete') return label;
    if (l.table_name === 'clubs') return html`<a href="#/clubs/${l.record_id}">${label}</a>`;
    if (l.table_name === 'members') return html`<a href="#/members/${l.record_id}">${label}</a>`;
    if (l.table_name === 'meetings') return html`<a href="#/meetings/${l.record_id}">${label}</a>`;
    return label;
  };

  function draw() {
    setHtml(listEl, state.rows.length ? html`
      <table class="table">
        <thead><tr><th>시각</th><th>대상</th><th>작업</th><th>내용</th><th>처리자</th><th></th></tr></thead>
        <tbody>${state.rows.map((l) => html`
          <tr>
            <td class="small">${fmtDateTime(l.created_at)}</td>
            <td>${tableLabel(l.table_name)}</td>
            <td>${actionBadge(l.action)}</td>
            <td class="wrap">${recordLink(l)}</td>
            <td>${l.actor_member_id || l.actor_club_id ? actorLabel(l, names) : html`<span class="muted">시스템</span>`}</td>
            <td><button class="btn xs ghost" data-toggle="${l.id}">${state.open.has(l.id) ? '접기' : '상세'}</button></td>
          </tr>
          ${state.open.has(l.id) ? html`<tr class="log-detail"><td colspan="6">${diffTable(l)}</td></tr>` : ''}`)}
        </tbody>
      </table>
      ${state.done ? '' : html`<div class="empty"><button class="btn sm" data-more>더 보기</button></div>`}`
      : html`<div class="empty">조건에 맞는 이력이 없습니다.</div>`);
  }

  el.querySelector('[data-filters]').addEventListener('change', (e) => {
    const k = e.target.dataset.f;
    if (!k) return;
    state[k] = e.target.value;
    load(true).catch(showError);
  });
  on(el, 'click', '[data-more]', () => load(false).catch(showError));
  on(el, 'click', '[data-toggle]', (_e, b) => {
    const id = Number(b.dataset.toggle);
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    draw();
  });

  await load(true);
}
