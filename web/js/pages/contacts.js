// 연락망 (/#/contacts)
//   현직 역할이 있는 사람을 역할·팀·동아리 단위로 묶어 본다. 이메일 일괄 복사, 관리자 CSV 내보내기.
import { sb, qAll, rpc, lookups } from '../api.js';
import { html, setHtml, on, maskPhone, clubLabel, compareClubName, sortKo, copyText, downloadCsv, toast, today, showError } from '../ui.js';

const GROUPS = [['role', '역할별'], ['team', '팀별'], ['club', '동아리별']];

export async function render(el, _params, ctx) {
  const [assigns, members, clubs] = await Promise.all([
    qAll(() => sb.from('v_current_assignments').select('id,member_id,role_id,role_name,role_sort_order,team_id,team_name,team_sort_order,club_id,club_name,club_university').order('id')),
    qAll(() => sb.from('members').select('id,name,university,club_id,phone,email,contact_purged_at').order('id')),
    lookups.clubs(),
  ]);
  const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));
  const staffIds = [...new Set(assigns.map((a) => a.member_id))];
  const rolesOf = (mid) => assigns.filter((a) => a.member_id === mid);
  const roleLabel = (a) => [a.team_name, a.club_name, a.role_name].filter(Boolean).join(' ');

  const state = { group: 'role', term: '', showPhone: false, collapsed: new Set() };

  function buildGroups() {
    const map = new Map(); // key → { label, order, ids:Set }
    const add = (key, label, order, mid) => {
      if (!map.has(key)) map.set(key, { key, label, order, ids: new Set() });
      map.get(key).ids.add(mid);
    };
    if (state.group === 'role') {
      for (const a of assigns) add(`r${a.role_id}`, a.role_name, a.role_sort_order, a.member_id);
    } else if (state.group === 'team') {
      for (const mid of staffIds) {
        const teamsOf = rolesOf(mid).filter((a) => a.team_id);
        if (teamsOf.length) for (const a of teamsOf) add(`t${a.team_id}`, a.team_name, a.team_sort_order, mid);
        else add('none', '-', 1e9, mid);
      }
    } else {
      for (const mid of staffIds) {
        const c = clubById[memberById[mid]?.club_id];
        add(c ? `c${c.id}` : 'none', c ? clubLabel(c) : '-', c ? 0 : 1, mid);
      }
    }
    const term = state.term.toLowerCase();
    const groups = [...map.values()].map((g) => ({
      ...g,
      people: sortKo([...g.ids].map((id) => memberById[id]).filter(Boolean)
        .filter((m) => !term || [m.name, m.email, clubLabel(clubById[m.club_id]), ...rolesOf(m.id).map(roleLabel)]
          .some((v) => (v ?? '').toLowerCase().includes(term))), (m) => m.name),
    })).filter((g) => g.people.length);
    groups.sort((a, b) => a.order - b.order || compareClubName(a.label, b.label));
    return groups;
  }

  setHtml(el, html`
    <div class="page-head">
      <div><h1>연락망</h1><div class="sub">현직 운영진 ${staffIds.length}명 · 운영 목적 외 사용 금지 (회칙 제60조 제3항 제3호)</div></div>
      <div class="page-actions">
        <button class="btn" data-copy-all>보이는 이메일 전체 복사</button>
        ${ctx.isAdmin ? html`<button class="btn primary" data-export>CSV 내보내기</button>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="segmented" data-groups></div>
        <input type="search" placeholder="이름·소속·역할 검색" data-search>
        <span class="spacer"></span>
        <label class="row small"><input type="checkbox" data-show-phone> 전화번호 전체 표시</label>
      </div>
      <div data-list></div>
    </div>`);

  const listEl = el.querySelector('[data-list]');
  let groups = [];

  function draw() {
    groups = buildGroups();
    setHtml(el.querySelector('[data-groups]'), html`${GROUPS.map(([k, l]) => html`<button class="${state.group === k ? 'on' : ''}" data-group="${k}">${l}</button>`)}`);
    setHtml(listEl, groups.length ? html`${groups.map((g) => html`
      <div class="card-head" style="background:var(--surface-2)">
        <h3>${g.label} <span class="muted small">${g.people.length}명</span></h3>
        <button class="btn xs" data-copy="${g.key}">이메일 복사</button>
      </div>
      <div class="table-wrap"><table class="table"><tbody>
        ${g.people.map((m) => html`<tr>
          <td style="width:140px"><a href="#/members/${m.id}">${m.name}</a></td>
          <td class="wrap"><div class="chips">${rolesOf(m.id).map((a) => html`<span class="chip">${roleLabel(a)}</span>`)}</div></td>
          <td class="muted small">${clubLabel(clubById[m.club_id])}</td>
          <td class="mono">${m.contact_purged_at ? '' : state.showPhone ? (m.phone ? html`<a href="tel:${m.phone}">${m.phone}</a>` : '') : maskPhone(m.phone)}</td>
          <td>${m.email ? html`<a href="mailto:${m.email}">${m.email}</a>` : ''}</td>
        </tr>`)}
      </tbody></table></div>`)}` : html`<div class="empty">조건에 맞는 사람이 없습니다.</div>`);
  }
  draw();

  const emailsOf = (people) => [...new Set(people.map((m) => m.email).filter(Boolean))];
  const copyEmails = async (people) => {
    const list = emailsOf(people);
    if (!list.length) return toast('복사할 이메일이 없습니다.');
    await copyText(list.join(', '));
    toast(`이메일 ${list.length}개를 복사했습니다.`);
  };

  on(el, 'click', '[data-group]', (_e, b) => { state.group = b.dataset.group; draw(); });
  el.querySelector('[data-search]').addEventListener('input', (e) => { state.term = e.target.value.trim(); draw(); });
  el.querySelector('[data-show-phone]').addEventListener('change', (e) => { state.showPhone = e.target.checked; draw(); });
  on(el, 'click', '[data-copy]', (_e, b) => copyEmails(groups.find((g) => g.key === b.dataset.copy)?.people ?? []));
  on(el, 'click', '[data-copy-all]', () => copyEmails(groups.flatMap((g) => g.people)));

  on(el, 'click', '[data-export]', async () => {
    const rows = [['구분', '이름', '역할', '소속 동아리', '전화번호', '이메일']];
    let count = 0;
    for (const g of groups) {
      for (const m of g.people) {
        rows.push([g.label, m.name, rolesOf(m.id).map(roleLabel).join(' / '), clubLabel(clubById[m.club_id]), m.phone ?? '', m.email ?? '']);
        count += 1;
      }
    }
    try {
      // 내보내기 사실을 먼저 기록하고(실패하면 내보내지 않음) 파일을 만든다
      await rpc('log_contact_export', { p_filter: { group: state.group, term: state.term || null }, p_count: count });
      downloadCsv(`unidev_연락망_${state.group}_${today()}.csv`, rows);
      toast(`${count}건을 내보냈습니다. 내보내기 기록이 변경 이력에 남았습니다.`);
    } catch (e) { showError(e); }
  });
}
