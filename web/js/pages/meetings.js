// 회의·출결 목록 (/#/meetings) — 열람은 운영진, 기록은 관리자
import { sb, q, qAll, lookups } from '../api.js';
import { html, setHtml, on, fmtDate, MEETING_KIND, opts, today, openForm, showError, badge } from '../ui.js';

export async function render(el, _params, ctx) {
  const [meetings, attendances, teams] = await Promise.all([
    q(sb.from('meetings').select('*').order('held_on', { ascending: false })),
    qAll(() => sb.from('attendances').select('id,meeting_id,status').order('id')),
    lookups.teams(),
  ]);
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const stats = (mid) => {
    const list = attendances.filter((a) => a.meeting_id === mid);
    return { total: list.length, present: list.filter((a) => a.status === 'present').length };
  };

  setHtml(el, html`
    <div class="page-head">
      <div><h1>회의·출결</h1><div class="sub">대표자회의·운영진회의·팀 회의 출결 기록</div></div>
      <div class="page-actions">${ctx.isAdmin ? html`<button class="btn primary" data-create>회의 등록</button>` : ''}</div>
    </div>
    <div class="card"><div class="table-wrap">
      ${meetings.length ? html`<table class="table">
        <thead><tr><th>날짜</th><th>종류</th><th>제목</th><th class="num">출석 / 기록</th></tr></thead>
        <tbody>${meetings.map((m) => {
          const s = stats(m.id);
          return html`<tr class="clickable" data-id="${m.id}">
            <td>${fmtDate(m.held_on)}</td>
            <td>${badge('info', MEETING_KIND[m.kind])} ${m.team_id ? teamById[m.team_id]?.name ?? '' : ''}</td>
            <td><a href="#/meetings/${m.id}">${m.title || '(제목 없음)'}</a></td>
            <td class="num">${s.present} / ${s.total}</td>
          </tr>`;
        })}</tbody></table>` : html`<div class="empty">등록된 회의가 없습니다.</div>`}
    </div></div>`);

  on(el, 'click', 'tr[data-id]', (e, t) => { if (!e.target.closest('a')) ctx.navigate(`/meetings/${t.dataset.id}`); });
  on(el, 'click', '[data-create]', async () => {
    try {
      const r = await openForm({
        title: '회의 등록',
        description: '대표자회의를 만들면 정등록·가등록 동아리 전체가 결석으로 들어갑니다. 회의 중 출석을 체크하세요.',
        fields: [
          { name: 'kind', label: '종류', type: 'select', options: opts(MEETING_KIND), value: 'representatives', required: true },
          { name: 'team_id', label: '팀', type: 'select', required: true, showIf: (v) => v.kind === 'team',
            options: teams.filter((t) => !t.closed_on).map((t) => ({ value: t.id, label: t.name })) },
          { name: 'held_on', label: '날짜', type: 'date', value: today(), required: true },
          { name: 'title', label: '제목', placeholder: '예: 2026 하반기 정기 대표자회의' },
          { name: 'note', label: '비고', type: 'textarea' },
        ],
        submitLabel: '등록',
        onSubmit: async (v) => (await q(sb.from('meetings').insert({ ...v, team_id: v.team_id ?? null }).select()))[0],
      });
      if (r) ctx.navigate(`/meetings/${r.id}`);
    } catch (e) { showError(e); }
  });
}
