// 회의 상세·출결 기록 (/#/meetings/:id)
//   대표자회의: 동아리 단위. 회의를 만들 때 모든 동아리가 '결석'으로 들어가고, 회의 중 출석을 체크한다.
//   운영진·팀 회의: 개인 단위.
//   대리 참석자는 출결 구분과 별개로 지정한다.
import { sb, q, qAll, qMut, lookups } from '../api.js';
import {
  html, setHtml, on, fmtDate, MEETING_KIND, ATTENDANCE, opts, clubLabel, compareClubName, sortKo, badge,
  openForm, confirmDialog, toast, showError,
} from '../ui.js';

export async function render(el, { id }, ctx) {
  const [[meeting], rows, clubs, teams, members] = await Promise.all([
    q(sb.from('meetings').select('*').eq('id', id)),
    q(sb.from('attendances').select('*').eq('meeting_id', id)),
    lookups.clubs(),
    lookups.teams(),
    lookups.members(),
  ]);
  if (!meeting) {
    setHtml(el, html`<div class="denied"><h1>회의를 찾을 수 없습니다</h1><p><a href="#/meetings">목록으로</a></p></div>`);
    return;
  }
  const byClub = meeting.kind === 'representatives';
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));
  const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
  const team = teams.find((t) => t.id === meeting.team_id);

  // 대표자회의: 회장단(개인 행)과 동아리 행으로 나눈다
  const execRows = byClub ? rows.filter((a) => !a.club_id) : [];
  const clubRows = byClub
    ? rows.filter((a) => a.club_id).sort((a, b) => compareClubName(clubById[a.club_id]?.name, clubById[b.club_id]?.name))
    : sortKo(rows, (a) => memberById[a.member_id]?.name);
  // 회장단 행에 표시할 직책 (회의 당시 기준)
  const execIds = execRows.map((a) => a.member_id);
  const execRoles = execIds.length
    ? await q(sb.from('v_assignments').select('member_id,role_name,role_sort_order,start_on,end_on')
      .in('member_id', execIds).eq('role_scope', 'org').eq('role_is_admin', true)
      .lte('start_on', meeting.held_on).or(`end_on.is.null,end_on.gte.${meeting.held_on}`))
    : [];
  const execRoleOf = (mid) => execRoles.filter((r) => r.member_id === mid).sort((a, b) => a.role_sort_order - b.role_sort_order)[0];
  execRows.sort((a, b) => (execRoleOf(a.member_id)?.role_sort_order ?? 99) - (execRoleOf(b.member_id)?.role_sort_order ?? 99));
  const count = (s) => rows.filter((a) => a.status === s).length;
  const proxyCount = rows.filter((a) => a.proxy_name).length;

  const statusCell = (a) => (ctx.isAdmin
    ? html`<div class="segmented">${Object.entries(ATTENDANCE).map(([k, v]) => html`<button type="button" class="${a.status === k ? 'on' : ''}" data-set="${a.id}" data-status="${k}">${v}</button>`)}</div>`
    : badge(a.status, ATTENDANCE[a.status]));
  const personCell = (mid) => {
    const p = memberById[mid];
    return p ? html`<a href="#/members/${p.id}">${p.name}</a>` : '-';
  };
  const restCells = (a) => html`
    <td>${statusCell(a)}</td>
    <td>${a.proxy_name || '-'}</td>
    <td class="wrap small">${a.reason ?? ''}</td>
    ${ctx.isAdmin ? html`<td class="actions">
      <button class="btn xs" data-edit="${a.id}">대리인·사유</button>
      <button class="btn xs ghost" data-del="${a.id}" title="이 회의의 출결 대상에서 제외">제외</button></td>` : ''}`;
  const colCount = ctx.isAdmin ? 6 : 5;
  const groupRow = (label) => html`<tr class="group-row"><td colspan="${colCount}">${label}</td></tr>`;

  setHtml(el, html`
    <div class="crumb"><a href="#/meetings">회의·출결</a></div>
    <div class="page-head">
      <div><h1>${meeting.title || MEETING_KIND[meeting.kind]}</h1>
        <div class="sub">${fmtDate(meeting.held_on)} · ${MEETING_KIND[meeting.kind]}${team ? ` · ${team.name}` : ''}</div></div>
      <div class="page-actions">${ctx.isAdmin ? html`
        <button class="btn" data-edit-meeting>회의 수정</button>
        ${byClub
          ? html`<button class="btn" data-fill>빠진 대상 추가</button>`
          : html`<button class="btn" data-fill>${meeting.kind === 'team' ? '팀원 일괄 추가' : '회장단·팀장 일괄 추가'}</button>
                 <button class="btn primary" data-add>참석 대상 추가</button>`}` : ''}</div>
    </div>
    ${meeting.note ? html`<div class="card card-body" style="margin-bottom:16px;white-space:pre-wrap">${meeting.note}</div>` : ''}
    <div class="row" style="margin-bottom:12px">
      ${Object.entries(ATTENDANCE).map(([k, v]) => html`<span class="badge ${k}">${v} <span data-count="${k}">${count(k)}</span></span>`)}
      ${proxyCount ? badge('info', `대리 참석 ${proxyCount}`) : ''}
      <span class="muted small">${byClub ? `회장단 ${execRows.length}명 · 동아리 ${clubRows.length}개` : `전체 ${rows.length}명`}</span>
    </div>
    <div class="card"><div class="table-wrap">
      ${rows.length ? html`<table class="table">
        <thead><tr>
          ${byClub ? html`<th>동아리 · 직책</th><th>대표자 · 이름</th>` : html`<th>이름</th><th>소속 동아리</th>`}
          <th>출결</th><th>대리 참석자</th><th>사유·비고</th>${ctx.isAdmin ? html`<th></th>` : ''}
        </tr></thead>
        <tbody>
          ${byClub && execRows.length ? html`${groupRow('회장단')}${execRows.map((a) => html`<tr>
            <td><span class="chip admin">${execRoleOf(a.member_id)?.role_name ?? '회장단'}</span></td>
            <td><strong>${personCell(a.member_id)}</strong></td>${restCells(a)}</tr>`)}` : ''}
          ${byClub && execRows.length ? groupRow(`동아리 ${clubRows.length}개`) : ''}
          ${clubRows.map((a) => html`<tr>
            ${byClub
              ? html`<td><a href="#/clubs/${a.club_id}"><strong>${clubLabel(clubById[a.club_id])}</strong></a></td><td>${personCell(a.member_id)}</td>`
              : html`<td>${personCell(a.member_id)}</td><td class="muted">${clubLabel(clubById[memberById[a.member_id]?.club_id]) || '-'}</td>`}
            ${restCells(a)}</tr>`)}
        </tbody></table>`
      : html`<div class="empty">출결 기록이 없습니다.${ctx.isAdmin ? (byClub ? " '빠진 대상 추가'로 동아리와 회장단을 불러오세요." : ' 위의 버튼으로 대상자를 추가하세요.') : ''}</div>`}
    </div></div>`);

  const guard = (fn) => async (...args) => { try { await fn(...args); } catch (e) { showError(e); } };
  const rowById = Object.fromEntries(rows.map((a) => [a.id, a]));

  // 대리인 후보: 해당 동아리 구성원을 앞에 둔다
  const pickOptions = (clubId) => {
    const label = (m) => `${m.name} · ${clubLabel(clubById[m.club_id]) || '-'}`;
    const mine = sortKo(members.filter((m) => clubId && m.club_id === clubId), (m) => m.name);
    const others = sortKo(members.filter((m) => !clubId || m.club_id !== clubId), (m) => m.name);
    return [...mine, ...others].map((m) => ({ value: m.id, label: label(m) }));
  };

  // 출결 빠른 체크
  on(el, 'click', '[data-set]', guard(async (_e, b) => {
    const a = rowById[b.dataset.set];
    if (a.status === b.dataset.status) return;
    await qMut(sb.from('attendances').update({ status: b.dataset.status }).eq('id', a.id));
    a.status = b.dataset.status;
    for (const sib of b.parentElement.children) sib.classList.toggle('on', sib === b);
    for (const k of Object.keys(ATTENDANCE)) el.querySelector(`[data-count="${k}"]`).textContent = count(k);
  }));

  on(el, 'click', '[data-edit]', guard(async (_e, b) => {
    const a = rowById[b.dataset.edit];
    const who = a.club_id ? clubLabel(clubById[a.club_id]) : memberById[a.member_id]?.name;
    const r = await openForm({
      title: `${who ?? ''} · 대리인·사유`,
      description: '대리 참석자는 출결 구분과 별개로 이름만 적습니다. 구성원으로 등록되어 있지 않아도 됩니다. 비워 두면 대리인 없음입니다.',
      fields: [
        { name: 'proxy_name', label: '대리 참석자 이름', value: a.proxy_name, placeholder: '예: 홍길동' },
        { name: 'reason', label: '사유·비고', value: a.reason },
      ],
      onSubmit: (v) => qMut(sb.from('attendances').update({ proxy_name: v.proxy_name ?? null, reason: v.reason ?? null }).eq('id', a.id)),
    });
    if (r) { toast('저장했습니다.'); ctx.reload(); }
  }));

  on(el, 'click', '[data-del]', guard(async (_e, b) => {
    const a = rowById[b.dataset.del];
    const who = a.club_id ? clubLabel(clubById[a.club_id]) : memberById[a.member_id]?.name;
    if (!(await confirmDialog(`${who ?? ''}을(를) 이 회의의 출결 대상에서 제외합니다.`, { title: '출결 대상 제외', confirmLabel: '제외', danger: true }))) return;
    await qMut(sb.from('attendances').delete().eq('id', a.id));
    toast('제외했습니다.');
    ctx.reload();
  }));

  on(el, 'click', '[data-add]', guard(async () => {
    const existing = new Set(rows.map((a) => a.member_id));
    const r = await openForm({
      title: '참석 대상 추가',
      fields: [{ name: 'member_id', label: '구성원', type: 'pick', required: true,
        options: pickOptions(null).filter((o) => !existing.has(o.value)) }],
      submitLabel: '추가',
      onSubmit: (v) => q(sb.from('attendances').insert({ meeting_id: id, member_id: v.member_id, status: 'absent' }).select()),
    });
    if (r) { toast('추가했습니다.'); ctx.reload(); }
  }));

  on(el, 'click', '[data-edit-meeting]', guard(async () => {
    const r = await openForm({
      title: '회의 수정',
      fields: [
        { name: 'held_on', label: '날짜', type: 'date', value: meeting.held_on, required: true },
        { name: 'title', label: '제목', value: meeting.title },
        { name: 'note', label: '비고', type: 'textarea', value: meeting.note },
      ],
      onSubmit: (v) => qMut(sb.from('meetings').update(v).eq('id', id)),
    });
    if (r) { toast('저장했습니다.'); ctx.reload(); }
  }));

  // 대표자회의: 아직 행이 없는 정등록·가등록 동아리를 '결석'으로 추가 (회의 생성 뒤 등록된 동아리 등)
  // 그 밖의 회의: 현직 대상자를 '결석'으로 일괄 추가
  on(el, 'click', '[data-fill]', guard(async () => {
    let toInsert;
    if (byClub) {
      const reps = await qAll(() => sb.from('v_current_assignments').select('member_id,club_id').eq('role_code', 'representative').order('id'));
      const repOf = Object.fromEntries(reps.map((r) => [r.club_id, r.member_id]));
      const have = new Set(rows.map((a) => a.club_id));
      toInsert = clubs.filter((c) => ['full', 'provisional'].includes(c.status) && !have.has(c.id))
        .map((c) => ({ meeting_id: id, club_id: c.id, member_id: repOf[c.id] ?? null, status: 'absent' }));
      const execs = await qAll(() => sb.from('v_current_assignments').select('member_id').eq('role_scope', 'org').eq('role_is_admin', true).order('id'));
      const haveExec = new Set(execRows.map((a) => a.member_id));
      for (const mid of new Set(execs.map((e) => e.member_id))) {
        if (!haveExec.has(mid)) toInsert.push({ meeting_id: id, member_id: mid, status: 'absent' });
      }
    } else {
      const makeQuery = () => {
        const qb = sb.from('v_current_assignments').select('member_id,team_id,role_is_admin').order('id');
        return meeting.kind === 'team' ? qb.eq('team_id', meeting.team_id) : qb.eq('role_is_admin', true);
      };
      const have = new Set(rows.map((a) => a.member_id));
      const ids = [...new Set((await qAll(makeQuery)).map((t) => t.member_id))].filter((m) => !have.has(m));
      toInsert = ids.map((m) => ({ meeting_id: id, member_id: m, status: 'absent' }));
    }
    if (!toInsert.length) return toast('추가할 대상이 없습니다.');
    const what = byClub ? `${toInsert.length}건(동아리·회장단)` : `${toInsert.length}명`;
    if (!(await confirmDialog(`${what}를 '결석'으로 추가합니다. 회의 중 출석을 체크하세요.`, { title: '일괄 추가', confirmLabel: '추가' }))) return;
    await q(sb.from('attendances').insert(toInsert).select());
    toast(`${what}를 추가했습니다.`);
    ctx.reload();
  }));
}
