// 조직도·팀 관리 (/#/org)
import { sb, q, qAll, qMut, rpc, lookups, invalidate } from '../api.js';
import {
  html, setHtml, on, badge, fmtDate, fmtPeriod, today, clubLabel, sortKo,
  openForm, confirmDialog, toast, showError,
} from '../ui.js';
import { assignRoleForm, endAssignmentForm } from '../forms.js';

export async function render(el, _params, ctx) {
  const [chart, assigns, teams, roles] = await Promise.all([
    qAll(() => sb.from('v_org_chart').select('*').order('team_sort_order').order('role_sort_order').order('member_name')),
    qAll(() => sb.from('v_current_assignments').select('*').order('role_sort_order').order('member_name')),
    q(sb.from('teams').select('*').order('sort_order').order('name')),
    lookups.roles(),
  ]);
  const activeTeams = teams.filter((t) => !t.closed_on);
  const closedTeams = teams.filter((t) => t.closed_on);
  const execs = assigns.filter((a) => a.role_scope === 'org' && a.role_is_admin);
  const otherOrg = assigns.filter((a) => a.role_scope === 'org' && !a.role_is_admin);
  const teamRoles = roles.filter((r) => r.scope === 'team');
  const peopleOf = (teamId) => chart.filter((r) => r.team_id === teamId && r.assignment_id);
  const assignById = Object.fromEntries(assigns.map((a) => [a.id, a]));

  const state = { bulkRole: '', bulkSelected: new Set() };

  setHtml(el, html`
    <div class="page-head">
      <div><h1>조직도·팀</h1><div class="sub">회장단 – 팀장 – 팀원 · 현직 기준</div></div>
      <div class="page-actions">
        ${ctx.isAdmin ? html`
          <button class="btn" data-assign-exec>회장단·운영진 배정</button>
          <button class="btn primary" data-new-team>팀 신설</button>` : ''}
      </div>
    </div>

    <div class="org-top">
      ${execs.length ? execs.map((a) => html`
        <div class="card person-card">
          <div class="role">${a.role_name}</div>
          <div class="name"><a href="#/members/${a.member_id}">${a.member_name}</a></div>
          <div class="club">${fmtDate(a.start_on)}부터</div>
          ${ctx.isAdmin ? html`<button class="btn xs ghost" data-end="${a.id}">종료</button>` : ''}
        </div>`) : html`<div class="notice">현직 회장단이 없습니다.</div>`}
    </div>
    <div class="org-connector"></div>

    <div class="grid grid-3">
      ${activeTeams.map((t) => {
        const people = peopleOf(t.id);
        return html`
        <div class="card team-card">
          <div class="card-head">
            <div><h2>${t.name} <span class="muted small">${new Set(people.map((p) => p.member_id)).size}명</span></h2>
              ${t.description ? html`<div class="team-desc">${t.description}</div>` : ''}</div>
            ${ctx.isAdmin ? html`<div class="row" style="flex-wrap:nowrap">
              <button class="btn xs" data-edit-team="${t.id}">수정</button>
              <button class="btn xs danger" data-close-team="${t.id}">폐지</button></div>` : ''}
          </div>
          <ul class="team-people">
            ${people.length ? people.map((p) => html`
              <li>
                ${p.role_code === 'team_lead' ? html`<span class="lead-tag">${p.role_name}</span>` : p.role_code !== 'team_member' ? html`<span class="chip">${p.role_name}</span>` : ''}
                <span class="who"><a href="#/members/${p.member_id}">${p.member_name}</a><small>${p.member_club_name ?? ''}</small></span>
                ${ctx.isAdmin ? html`<button class="btn xs ghost" data-move="${p.assignment_id}">이동</button><button class="btn xs ghost" data-end="${p.assignment_id}">종료</button>` : ''}
              </li>`) : html`<li class="muted small">배정된 사람이 없습니다.</li>`}
          </ul>
          ${ctx.isAdmin ? html`<div class="card-body" style="padding-top:10px;padding-bottom:12px"><button class="btn sm" data-add-to="${t.id}">+ 팀원 배정</button></div>` : ''}
        </div>`;
      })}
    </div>
    ${!activeTeams.length ? html`<div class="empty card">활동 중인 팀이 없습니다.</div>` : ''}

    ${otherOrg.length ? html`
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>기타 운영진 역할</h2></div>
        <div class="card-body"><div class="chips">${otherOrg.map((a) => html`<span class="chip"><a href="#/members/${a.member_id}">${a.member_name}</a> · ${a.role_name}</span>`)}</div></div>
      </div>` : ''}

    ${ctx.isAdmin ? html`
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>현직 배정 일괄 종료</h2><span class="hint">임기 종료(매년 2월) 시 종료할 배정을 골라 종료일을 한 번에 입력</span></div>
        <div class="toolbar">
          <select data-bulk-role><option value="">모든 역할</option>${roles.map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select>
          <label class="row small"><input type="checkbox" data-bulk-all> 보이는 항목 전체 선택</label>
          <span class="spacer"></span>
          <label class="row small">종료일 <input type="date" data-bulk-date value="${today()}"></label>
          <button class="btn danger sm" data-bulk-end>선택한 배정 종료</button>
        </div>
        <div class="table-wrap" data-bulk-list style="max-height:420px;overflow:auto"></div>
      </div>` : ''}

    ${closedTeams.length ? html`
      <details class="card" style="margin-top:16px">
        <summary class="card-head" style="cursor:pointer"><h2>폐지된 팀 <span class="muted small">${closedTeams.length}개</span></h2></summary>
        <div class="card-body flush"><table class="table"><thead><tr><th>팀</th><th>신설</th><th>폐지</th><th>업무 범위</th></tr></thead>
          <tbody>${closedTeams.map((t) => html`<tr><td>${t.name}</td><td>${fmtDate(t.established_on) || '—'}</td><td>${fmtDate(t.closed_on)}</td><td class="wrap muted small">${t.description ?? ''}</td></tr>`)}</tbody></table></div>
      </details>` : ''}
  `);

  // ------------------------------------------------------------------
  // 일괄 종료 목록
  // ------------------------------------------------------------------
  const bulkList = el.querySelector('[data-bulk-list]');
  const bulkVisible = () => assigns.filter((a) => !state.bulkRole || String(a.role_id) === state.bulkRole);
  function drawBulk() {
    if (!bulkList) return;
    const rows = bulkVisible();
    setHtml(bulkList, rows.length ? html`<table class="table">
      <thead><tr><th></th><th>이름</th><th>역할</th><th>대상</th><th>시작일</th><th>종료 예정</th></tr></thead>
      <tbody>${rows.map((a) => html`<tr>
        <td><input type="checkbox" data-bulk-id="${a.id}" ${state.bulkSelected.has(a.id) ? html`checked` : ''}></td>
        <td>${a.member_name}</td><td>${a.role_name}</td>
        <td>${a.team_name ?? a.club_name ?? '-'}</td>
        <td>${fmtDate(a.start_on)}</td><td>${fmtDate(a.end_on) || '—'}</td>
      </tr>`)}</tbody></table>` : html`<div class="empty">현직 배정이 없습니다.</div>`);
  }
  drawBulk();

  // ------------------------------------------------------------------
  // 동작
  // ------------------------------------------------------------------
  const guard = (fn) => async (...args) => { try { await fn(...args); } catch (e) { showError(e); } };
  const done = (msg) => { invalidate(); toast(msg); ctx.reload(); };

  const teamForm = (t = {}) => openForm({
    title: t.id ? '팀 정보 수정' : '팀 신설',
    description: t.id ? '명칭을 바꿔도 배정 기록은 그대로 유지되고, 이전 명칭은 변경 이력에 남습니다.' : null,
    fields: [
      { name: 'name', label: '팀 이름', value: t.name, required: true, placeholder: '예: 행정팀' },
      { name: 'description', label: '업무 범위', type: 'textarea', value: t.description },
      { name: 'sort_order', label: '표시 순서', type: 'number', value: t.sort_order ?? (Math.max(0, ...teams.map((x) => x.sort_order)) + 10) },
      ...(t.id ? [] : [{ name: 'established_on', label: '신설일', type: 'date', value: today() }]),
    ],
    onSubmit: async (v) => {
      v.sort_order ??= 0;
      return t.id ? qMut(sb.from('teams').update(v).eq('id', t.id)) : q(sb.from('teams').insert(v).select());
    },
  });

  on(el, 'click', '[data-new-team]', guard(async () => { if (await teamForm()) done('팀을 만들었습니다.'); }));
  on(el, 'click', '[data-edit-team]', guard(async (_e, b) => {
    if (await teamForm(teams.find((t) => t.id === b.dataset.editTeam))) done('저장했습니다.');
  }));
  on(el, 'click', '[data-close-team]', guard(async (_e, b) => {
    const t = teams.find((x) => x.id === b.dataset.closeTeam);
    const n = new Set(peopleOf(t.id).map((p) => p.member_id)).size;
    const r = await openForm({
      title: `${t.name} 폐지`,
      description: `폐지일을 입력하면 소속 배정 ${n}건에 종료일이 자동으로 들어갑니다. 과거 기록은 보존됩니다. 통합하는 경우 먼저 팀원을 새 팀으로 이동하세요.`,
      fields: [{ name: 'closed_on', label: '폐지일', type: 'date', value: today(), required: true }],
      submitLabel: '폐지',
      danger: true,
      onSubmit: (v) => qMut(sb.from('teams').update({ closed_on: v.closed_on }).eq('id', t.id)),
    });
    if (r) done('팀을 폐지했습니다.');
  }));

  on(el, 'click', '[data-add-to]', guard(async (_e, b) => {
    if (await assignRoleForm({ team_id: b.dataset.addTo, role_code: 'team_member', scope: 'team' }, { title: '팀원 배정' })) done('배정했습니다.');
  }));
  on(el, 'click', '[data-assign-exec]', guard(async () => {
    if (await assignRoleForm({ scope: 'org', role_code: 'president' }, { title: '회장단·운영진 배정' })) done('배정했습니다.');
  }));
  on(el, 'click', '[data-end]', guard(async (_e, b) => {
    if (await endAssignmentForm(assignById[b.dataset.end])) done('종료일을 입력했습니다.');
  }));

  on(el, 'click', '[data-move]', guard(async (_e, b) => {
    const a = assignById[b.dataset.move];
    const r = await openForm({
      title: '팀원 이동',
      description: `${a.member_name} · 현재 ${a.team_name} ${a.role_name}. 기존 배정은 이동일 전날로 종료되고 새 팀 배정이 추가됩니다.`,
      fields: [
        { name: 'team_id', label: '이동할 팀', type: 'select', required: true,
          options: activeTeams.filter((t) => t.id !== a.team_id).map((t) => ({ value: t.id, label: t.name })) },
        { name: 'role_id', label: '새 팀에서의 역할', type: 'select', required: true, value: a.role_id,
          options: teamRoles.map((x) => ({ value: x.id, label: x.name })) },
        { name: 'move_on', label: '이동일', type: 'date', value: today(), required: true },
      ],
      submitLabel: '이동',
      onSubmit: (v) => rpc('move_team_assignment', {
        p_assignment_id: a.id, p_new_team_id: v.team_id, p_move_on: v.move_on,
        p_new_role_id: Number(v.role_id),
      }),
    });
    if (r) done('이동했습니다.');
  }));

  // 일괄 종료
  el.querySelector('[data-bulk-role]')?.addEventListener('change', (e) => { state.bulkRole = e.target.value; drawBulk(); });
  el.querySelector('[data-bulk-all]')?.addEventListener('change', (e) => {
    for (const a of bulkVisible()) e.target.checked ? state.bulkSelected.add(a.id) : state.bulkSelected.delete(a.id);
    drawBulk();
  });
  on(el, 'change', '[data-bulk-id]', (_e, cb) => {
    cb.checked ? state.bulkSelected.add(cb.dataset.bulkId) : state.bulkSelected.delete(cb.dataset.bulkId);
  });
  on(el, 'click', '[data-bulk-end]', guard(async () => {
    const ids = [...state.bulkSelected];
    const endOn = el.querySelector('[data-bulk-date]').value;
    if (!ids.length) return toast('종료할 배정을 선택하세요.');
    if (!endOn) return toast('종료일을 입력하세요.');
    const early = ids.map((i) => assignById[i]).filter((a) => a.start_on > endOn);
    if (early.length) return toast(`종료일이 시작일보다 앞서는 배정이 있습니다: ${early.map((a) => a.member_name).join(', ')}`, 'error');
    const ok = await confirmDialog(`선택한 배정 ${ids.length}건의 종료일을 ${endOn}로 입력합니다.`, { title: '배정 일괄 종료', confirmLabel: '종료', danger: true });
    if (!ok) return;
    await qMut(sb.from('role_assignments').update({ end_on: endOn }).in('id', ids));
    done(`${ids.length}건을 종료했습니다.`);
  }));
}
