// 현황 요약 (/#/)
import { sb, q, qAll, rpc, lookups } from '../api.js';
import { html, setHtml, on, today, fmtDate, fmtDateTime, clubLabel, confirmDialog, toast, showError } from '../ui.js';
import { logRecordLabel, actionBadge, tableLabel, actorLabel } from '../log-format.js';

export async function render(el, _params, ctx) {
  const [clubs, assigns] = await Promise.all([
    qAll(() => sb.from('clubs').select('id,university,name,status').order('id')),
    qAll(() => sb.from('v_current_assignments').select('id,member_id,role_scope').order('id')),
  ]);
  const [purge, logs, members, roles] = ctx.isAdmin
    ? await Promise.all([
        q(sb.from('v_contact_purge_candidates').select('*').order('last_end_on')),
        q(sb.from('change_logs').select('*').order('created_at', { ascending: false }).limit(10)),
        lookups.members(),
        lookups.roles(),
      ])
    : [[], [], [], []];

  const names = {
    members: Object.fromEntries(members.map((m) => [m.id, m.name])),
    roles: Object.fromEntries(roles.map((r) => [r.id, r.name])),
    clubs: Object.fromEntries(clubs.map((c) => [c.id, clubLabel(c)])),
  };

  const countBy = (s) => clubs.filter((c) => c.status === s).length;
  // 운영진: 동아리 범위 역할(대표자·대리인)만 있는 사람은 뺀다
  const staffCount = new Set(assigns.filter((a) => a.role_scope !== 'club').map((a) => a.member_id)).size;

  setHtml(el, html`
    <div class="page-head">
      <div><h1>현황 요약</h1><div class="sub">${today()} 기준</div></div>
    </div>

    ${purge.length ? html`
      <div class="notice row" style="margin-bottom:16px">
        <span>보유 기간(역할 종료 후 1년)이 지난 연락처가 <strong>${purge.length}명</strong> 있습니다:
          ${purge.slice(0, 5).map((m, i) => html`${i ? ', ' : ''}<a href="#/members/${m.id}">${m.name}</a>`)}${purge.length > 5 ? ` 외 ${purge.length - 5}명` : ''}</span>
        <span class="spacer"></span>
        <button class="btn danger sm" data-purge>연락처 일괄 파기</button>
      </div>` : ''}

    <div class="grid grid-2">
      <div class="card stat"><div class="stat-label">등록 동아리</div>
        <div class="stat-value">${countBy('full') + countBy('provisional')}<small>개</small></div>
        <div class="stat-detail">정등록 ${countBy('full')} · 가등록 ${countBy('provisional')}${countBy('pending') ? ` · 심사 중 ${countBy('pending')}` : ''}</div></div>
      <div class="card stat"><div class="stat-label">운영진</div>
        <div class="stat-value">${staffCount}<small>명</small></div></div>
    </div>

      ${ctx.isAdmin ? html`
        <div class="card" style="margin-top:16px">
          <div class="card-head"><h2>최근 변경</h2><a class="small" href="#/logs">전체 이력</a></div>
          <div class="card-body flush">
            ${logs.length ? html`<table class="table"><tbody>
              ${logs.map((l) => html`<tr>
                <td class="muted small">${fmtDateTime(l.created_at)}</td>
                <td>${tableLabel(l.table_name)} ${actionBadge(l.action)}</td>
                <td class="wrap">${logRecordLabel(l, names)}</td>
                <td class="muted small">${actorLabel(l, names)}</td>
              </tr>`)}</tbody></table>`
            : html`<div class="empty">변경 이력이 없습니다.</div>`}
          </div>
        </div>` : ''}`);

  on(el, 'click', '[data-purge]', async (e) => {
    e.preventDefault();
    const ok = await confirmDialog(
      `${purge.length}명의 전화번호와 이메일을 삭제합니다. 변경 이력에 남은 연락처도 함께 지워지며 되돌릴 수 없습니다. 이름과 역할 이력은 남습니다. `
      + `(마지막 역할 종료: ${purge.map((m) => `${m.name} ${fmtDate(m.last_end_on)}`).join(', ')})`,
      { title: '연락처 일괄 파기', confirmLabel: '파기 실행', danger: true },
    );
    if (!ok) return;
    try {
      const n = await rpc('purge_expired_contacts');
      toast(`${n}명의 연락처를 파기했습니다.`);
      ctx.reload();
    } catch (err) { showError(err); }
  });
}
