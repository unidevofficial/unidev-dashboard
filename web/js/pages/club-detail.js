// 동아리 상세 (/#/clubs/:id)
import { sb, q, rpc, qMut, lookups, invalidate } from '../api.js';
import {
  html, setHtml, on, statusBadge, badge, fmtDate, fmtPeriod, today, clubLabel, opts, sortKo,
  SANCTION_KIND, ATTENDANCE, MEETING_KIND, openForm, confirmDialog, toast, showError,
} from '../ui.js';
import { editClubForm, createMemberForm, memberPickOptions, assignRoleForm, endAssignmentForm } from '../forms.js';

export async function render(el, { id }, ctx) {
  const [club] = await q(sb.from('v_club_overview').select('*').eq('id', id));
  if (!club) {
    setHtml(el, html`<div class="denied"><h1>동아리를 찾을 수 없습니다</h1><p><a href="#/clubs">목록으로</a></p></div>`);
    return;
  }
  const [clubAssigns, clubMembers, attendances, sanctions, officers, [account]] = await Promise.all([
    q(sb.from('v_assignments').select('*').eq('club_id', id).order('start_on', { ascending: false })),
    q(sb.from('members').select('id,name,phone,email').eq('club_id', id).order('name')),
    q(sb.from('attendances').select('*').eq('club_id', id)),
    q(sb.from('sanctions').select('*').eq('club_id', id).order('imposed_on', { ascending: false })),
    q(sb.from('club_officers').select('*').eq('club_id', id).order('sort_order').order('created_at')),
    q(sb.from('accounts').select('username').eq('club_id', id)), // 관리자·해당 계정에게만 보인다
  ]);
  const memberIds = clubMembers.map((m) => m.id);
  const [memberAssigns, meetings] = await Promise.all([
    memberIds.length ? q(sb.from('v_current_assignments').select('*').in('member_id', memberIds)) : [],
    attendances.length ? q(sb.from('meetings').select('*').in('id', [...new Set(attendances.map((a) => a.meeting_id))])) : [],
  ]);
  const proxyIds = attendances.map((a) => a.member_id).filter(Boolean);
  const repIds = clubAssigns.map((a) => a.member_id);
  const contactIds = [...new Set([...repIds, ...proxyIds])];
  const contacts = contactIds.length ? await q(sb.from('members').select('id,name,phone,email,contact_purged_at').in('id', contactIds)) : [];
  const contactById = Object.fromEntries(contacts.map((m) => [m.id, m]));
  const meetingById = Object.fromEntries(meetings.map((m) => [m.id, m]));

  const canEdit = ctx.isAdmin || ctx.representsClub(id);
  const reps = clubAssigns.filter((a) => a.role_code === 'representative');
  const otherClubRoles = clubAssigns.filter((a) => a.role_code !== 'representative');
  const staffRows = sortKo(clubMembers.filter((m) => memberAssigns.some((a) => a.member_id === m.id)), (m) => m.name);
  const t = today();

  const contactCell = (mid) => {
    const m = contactById[mid];
    if (!m) return '';
    if (m.contact_purged_at) return html`<span class="muted small">연락처 파기됨</span>`;
    return html`${m.phone ? html`<a href="tel:${m.phone}">${m.phone}</a>` : ''}${m.phone && m.email ? html`<br>` : ''}${m.email ? html`<a href="mailto:${m.email}">${m.email}</a>` : ''}`;
  };

  setHtml(el, html`
    <div class="crumb"><a href="#/clubs">동아리</a> / ${club.university}</div>
    <div class="page-head">
      <div><h1>${club.name} ${statusBadge(club.status)}</h1><div class="sub">${club.university}</div></div>
      <div class="page-actions">
        ${canEdit ? html`<button class="btn" data-edit>정보 수정</button>` : ''}
        ${ctx.isAdmin ? html`<button class="btn primary" data-replace-rep>${club.representative_id ? '대표자 교체' : '대표자 지정'}</button>` : ''}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>기본 정보</h2>${ctx.representsClub(id) && !ctx.isAdmin ? html`<span class="hint">내 동아리 · 직접 수정 가능</span>` : ''}</div>
        <div class="card-body">
          <dl class="kv">
            <dt>등록 구분</dt><dd>${statusBadge(club.status)}</dd>
            <dt>등록일</dt><dd>${fmtDate(club.registered_on) || '—'}</dd>
            <dt>회원 수</dt><dd>${club.member_count != null ? `${club.member_count}명` : '—'}</dd>
            <dt>공식 이메일</dt><dd>${club.official_email ? html`<a href="mailto:${club.official_email}">${club.official_email}</a>` : '—'}</dd>
            <dt>SNS</dt><dd>${club.sns_url ? html`<a href="${/^https?:\/\//.test(club.sns_url) ? club.sns_url : `https://${club.sns_url}`}" target="_blank" rel="noopener noreferrer">${club.sns_url}</a>` : '—'}</dd>
            <dt>비고</dt><dd style="white-space:pre-wrap">${club.note || '—'}</dd>
            ${ctx.isAdmin || ctx.representsClub(id) ? html`<dt>대표자 계정</dt><dd>${account ? html`<span class="mono">${account.username}</span>` : html`<span class="muted small">없음${ctx.isAdmin ? html` · <a href="#/accounts">로그인 계정</a>에서 만들 수 있습니다` : ''}</span>`}</dd>` : ''}
          </dl>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>대표자</h2></div>
        <div class="card-body">
          ${club.representative_id ? html`
            <div class="row"><a href="#/members/${club.representative_id}"><strong>${club.representative_name}</strong></a>
              <span class="badge ok">현직</span><span class="muted small">${fmtDate(club.representative_since)}부터</span></div>
            <div style="margin-top:6px">${contactCell(club.representative_id)}</div>`
          : html`<div class="notice">현직 대표자가 없습니다.</div>`}
          ${otherClubRoles.filter((a) => a.is_current).length ? html`
            <h3 style="margin-top:16px">대리인 등</h3>
            <ul class="list-plain">${otherClubRoles.filter((a) => a.is_current).map((a) => html`
              <li class="row"><a href="#/members/${a.member_id}">${a.member_name}</a> ${badge('info', a.role_name)}
                <span class="muted small">${fmtPeriod(a.start_on, a.end_on)}</span>
                <span class="spacer"></span>
                ${ctx.isAdmin ? html`<button class="btn xs" data-end="${a.id}">종료</button>` : ''}
              </li>`)}</ul>` : ''}
          ${ctx.isAdmin ? html`<div style="margin-top:12px"><button class="btn sm" data-add-proxy>대리인 지정</button></div>` : ''}

          <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
            <div class="row"><h3>동아리 회장단</h3><span class="muted small">동아리 자체 직책 · UNIDEV 역할과 별개</span></div>
            ${officers.length ? html`<table class="table" style="margin-top:6px"><tbody>
              ${officers.map((o) => html`<tr>
                <td class="muted" style="width:90px;padding-left:0">${o.title || '-'}</td>
                <td><strong>${o.name}</strong></td>
                <td class="wrap">${o.contact || '-'}</td>
              </tr>`)}</tbody></table>`
            : html`<div class="muted small" style="margin-top:6px">${canEdit ? "등록된 정보가 없습니다. '정보 수정'에서 추가할 수 있습니다." : '등록된 정보가 없습니다.'}</div>`}
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>대표자·대리인 이력</h2><span class="hint">역대 기록 포함</span></div>
      <div class="card-body flush table-wrap">
        ${clubAssigns.length ? html`<table class="table">
          <thead><tr><th>역할</th><th>이름</th><th>기간</th><th>연락처</th>${ctx.isAdmin ? html`<th></th>` : ''}</tr></thead>
          <tbody>${clubAssigns.map((a) => html`<tr>
            <td>${a.role_name} ${a.is_current ? badge('ok', '현직') : ''}</td>
            <td><a href="#/members/${a.member_id}">${a.member_name}</a></td>
            <td>${fmtPeriod(a.start_on, a.end_on)}</td>
            <td class="small">${contactCell(a.member_id)}</td>
            ${ctx.isAdmin ? html`<td>${a.is_current || (a.end_on ?? '9999') >= t ? html`<button class="btn xs" data-end="${a.id}">종료</button>` : ''}</td>` : ''}
          </tr>`)}</tbody></table>` : html`<div class="empty">기록이 없습니다.</div>`}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>소속 운영진과 팀 배정</h2><span class="hint">이 동아리 소속 구성원 중 현직 역할이 있는 사람</span></div>
      <div class="card-body flush table-wrap">
        ${staffRows.length ? html`<table class="table">
          <thead><tr><th>이름</th><th>현재 역할</th><th>팀</th></tr></thead>
          <tbody>${staffRows.map((m) => {
            const list = memberAssigns.filter((a) => a.member_id === m.id);
            return html`<tr>
              <td><a href="#/members/${m.id}">${m.name}</a></td>
              <td><div class="chips">${list.map((a) => html`<span class="chip ${a.role_is_admin ? 'admin' : ''}">${a.role_name}</span>`)}</div></td>
              <td>${list.filter((a) => a.team_name).map((a) => a.team_name).join(', ') || '-'}</td>
            </tr>`;
          })}</tbody></table>` : html`<div class="empty">현직 운영진이 없습니다.</div>`}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>출결 이력</h2></div>
        <div class="card-body flush table-wrap">
          ${attendances.length ? html`<table class="table">
            <thead><tr><th>회의</th><th>출결</th><th>참석 대표자·대리인</th><th>사유</th></tr></thead>
            <tbody>${[...attendances].sort((a, b) => (meetingById[b.meeting_id]?.held_on ?? '').localeCompare(meetingById[a.meeting_id]?.held_on ?? '')).map((a) => {
              const mt = meetingById[a.meeting_id] ?? {};
              return html`<tr>
                <td><a href="#/meetings/${a.meeting_id}">${fmtDate(mt.held_on)} ${mt.title ?? MEETING_KIND[mt.kind] ?? ''}</a></td>
                <td>${badge(a.status, ATTENDANCE[a.status])}</td>
                <td class="small">${a.proxy_name ? `대리: ${a.proxy_name}` : (contactById[a.member_id]?.name ?? '-')}</td>
                <td class="wrap small muted">${a.reason ?? ''}</td>
              </tr>`;
            })}</tbody></table>` : html`<div class="empty">출결 기록이 없습니다.</div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>징계 이력</h2>${ctx.isAdmin ? html`<button class="btn sm" data-add-sanction>징계 기록</button>` : ''}</div>
        <div class="card-body flush table-wrap">
          ${sanctions.length ? html`<table class="table">
            <thead><tr><th>종류</th><th>부과일</th><th>만료일</th><th>근거</th>${ctx.isAdmin ? html`<th></th>` : ''}</tr></thead>
            <tbody>${sanctions.map((s) => html`<tr>
              <td>${badge(s.kind, SANCTION_KIND[s.kind])} ${s.expires_on && s.expires_on < t ? badge('muted', '만료') : ''}</td>
              <td>${fmtDate(s.imposed_on)}</td>
              <td>${fmtDate(s.expires_on) || '—'}</td>
              <td class="wrap small">${s.basis ?? ''}${s.note ? html`<div class="muted">${s.note}</div>` : ''}</td>
              ${ctx.isAdmin ? html`<td><button class="btn xs" data-edit-sanction="${s.id}">수정</button></td>` : ''}
            </tr>`)}</tbody></table>` : html`<div class="empty">징계 기록이 없습니다.</div>`}
        </div>
      </div>
    </div>`);

  // ------------------------------------------------------------------
  // 동작
  // ------------------------------------------------------------------
  const guard = (fn) => async (...args) => { try { await fn(...args); } catch (e) { showError(e); } };

  on(el, 'click', '[data-edit]', guard(async () => {
    const r = await editClubForm(club, { admin: ctx.isAdmin, officers });
    if (r) { toast('저장했습니다.'); ctx.reload(); }
  }));

  on(el, 'click', '[data-replace-rep]', guard(async () => {
    const memberOpts = await memberPickOptions();
    const result = await openForm({
      title: club.representative_id ? '대표자 교체' : '대표자 지정',
      description: (club.representative_id
        ? `현 대표자 ${club.representative_name}의 배정은 시작일 전날로 종료되고, 새 대표자 배정이 추가됩니다.`
        : '새 대표자 배정을 추가합니다.') + ' ※ 변경 전 반드시 회장단에게 연락 부탁드립니다.',
      fields: [
        { name: 'mode', label: '새 대표자', type: 'select', required: true, value: 'existing',
          options: [{ value: 'existing', label: '등록된 구성원 중에서 선택' }, { value: 'new', label: '새 구성원으로 등록' }] },
        { name: 'member_id', label: '구성원', type: 'pick', options: memberOpts, required: true, showIf: (v) => v.mode === 'existing' },
        { name: 'start_on', label: '시작일', type: 'date', value: today(), required: true },
      ],
      submitLabel: '다음',
      onSubmit: async (v) => v,
    });
    if (!result) return;
    let memberId = result.member_id;
    if (result.mode === 'new') {
      const m = await createMemberForm({ club_id: id, university: club.university });
      if (!m) return;
      memberId = m.id;
    }
    await rpc('replace_representative', { p_club_id: id, p_member_id: memberId, p_start_on: result.start_on });
    invalidate();
    toast('대표자를 반영했습니다.');
    ctx.reload();
  }));

  on(el, 'click', '[data-add-proxy]', guard(async () => {
    const r = await assignRoleForm({ club_id: id, role_code: 'proxy', scope: 'club' }, { title: '대리인 지정 (제16조 제3항)' });
    if (r) { toast('배정했습니다.'); ctx.reload(); }
  }));

  on(el, 'click', '[data-end]', guard(async (_e, btn) => {
    const a = clubAssigns.find((x) => x.id === btn.dataset.end);
    const r = await endAssignmentForm(a);
    if (r) { toast('종료일을 입력했습니다.'); ctx.reload(); }
  }));

  const sanctionForm = (s = {}) => openForm({
    title: s.id ? '징계 수정' : '징계 기록',
    description: '만료일을 비워 두면 주의 1년, 경고 2년으로 자동 계산됩니다. (제53조 제3항, 제54조 제3항)',
    fields: [
      { name: 'kind', label: '종류', type: 'select', options: opts(SANCTION_KIND), value: s.kind, required: true },
      { name: 'imposed_on', label: '부과일', type: 'date', value: s.imposed_on ?? today(), required: true },
      { name: 'expires_on', label: '만료일', type: 'date', value: s.expires_on },
      { name: 'basis', label: '근거', value: s.basis, placeholder: '예: 2026-10 정기 대표자회의 의결' },
      { name: 'note', label: '비고', type: 'textarea', value: s.note },
    ],
    onSubmit: async (v) => (s.id
      ? qMut(sb.from('sanctions').update(v).eq('id', s.id))
      : q(sb.from('sanctions').insert({ ...v, club_id: id }).select())),
  });

  on(el, 'click', '[data-add-sanction]', guard(async () => {
    if (await sanctionForm()) { toast('기록했습니다.'); ctx.reload(); }
  }));
  on(el, 'click', '[data-edit-sanction]', guard(async (_e, btn) => {
    const s = sanctions.find((x) => x.id === btn.dataset.editSanction);
    if (await sanctionForm(s)) { toast('저장했습니다.'); ctx.reload(); }
  }));
}
