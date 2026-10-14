// 구성원 상세 (/#/members/:id)
import { sb, q, qMut, invalidate, lookups } from '../api.js';
import {
  html, setHtml, on, badge, fmtDate, fmtDateTime, fmtPeriod, today, clubLabel,
  confirmDialog, toast, showError,
} from '../ui.js';
import { editMemberForm, assignRoleForm, endAssignmentForm } from '../forms.js';

export async function render(el, { id }, ctx) {
  const [[member], history, clubs, [account]] = await Promise.all([
    q(sb.from('members').select('*').eq('id', id)),
    q(sb.from('v_assignments').select('*').eq('member_id', id).order('start_on', { ascending: false })),
    lookups.clubs(),
    q(sb.from('accounts').select('username').eq('member_id', id)), // 관리자·본인에게만 보인다
  ]);
  if (!member) {
    setHtml(el, html`<div class="denied"><h1>구성원을 찾을 수 없습니다</h1><p><a href="#/members">목록으로</a></p></div>`);
    return;
  }
  const club = clubs.find((c) => c.id === member.club_id);
  const isSelf = member.id === ctx.memberId;
  // 대표자(동아리) 계정은 자기 동아리 현직 대표자의 이름·연락처를 고칠 수 있다
  const isMyClubRep = ctx.isClub && history.some((a) => a.is_current && a.role_code === 'representative' && a.club_id === ctx.clubId);
  const canEdit = ctx.isAdmin || isSelf || isMyClubRep;
  const current = history.filter((a) => a.is_current);
  const teamsNow = current.filter((a) => a.team_id);
  const t = today();

  setHtml(el, html`
    <div class="crumb"><a href="#/members">구성원</a></div>
    <div class="page-head">
      <div>
        <h1>${member.name} ${isSelf ? badge('info', '나') : ''}</h1>
        <div class="sub">${club ? html`<a href="#/clubs/${club.id}">${clubLabel(club)}</a>` : '-'}</div>
      </div>
      <div class="page-actions">
        ${canEdit ? html`<button class="btn" data-edit>${isSelf && !ctx.isAdmin ? '내 정보 수정' : isMyClubRep && !ctx.isAdmin ? '대표자 정보 수정' : '정보 수정'}</button>` : ''}
        ${ctx.isAdmin ? html`<button class="btn primary" data-assign>역할 배정</button>` : ''}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>연락처</h2>
          ${canEdit && !member.contact_purged_at ? html`<button class="btn sm" data-verify>연락처 확인함</button>` : ''}</div>
        <div class="card-body">
          ${member.contact_purged_at ? html`<div class="notice">보유 기간 경과로 ${fmtDateTime(member.contact_purged_at)}에 연락처를 파기했습니다.</div>` : html`
            <dl class="kv">
              <dt>전화번호</dt><dd>${member.phone ? html`<a href="tel:${member.phone}">${member.phone}</a>` : html`<span class="muted">미입력</span>`}</dd>
              <dt>이메일</dt><dd>${member.email ? html`<a href="mailto:${member.email}">${member.email}</a>` : html`<span class="muted">미입력</span>`}</dd>
              <dt>최종 확인일</dt><dd>${fmtDate(member.contact_verified_on) || html`<span class="muted">기록 없음</span>`}</dd>
              ${ctx.isAdmin || isSelf ? html`<dt>로그인 계정</dt><dd>${account ? html`<span class="mono">${account.username}</span>` : html`<span class="muted small">없음${ctx.isAdmin ? html` · <a href="#/accounts">로그인 계정</a>에서 만들 수 있습니다` : ''}</span>`}</dd>` : ''}
            </dl>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>현재 역할·소속 팀</h2></div>
        <div class="card-body">
          ${current.length ? html`<ul class="list-plain">${current.map((a) => html`
            <li class="row">
              <span class="chip ${a.role_is_admin ? 'admin' : ''}">${a.role_name}</span>
              ${a.team_name ? html`<a href="#/org">${a.team_name}</a>` : ''}
              ${a.club_id ? html`<a href="#/clubs/${a.club_id}">${a.club_name}</a>` : ''}
              <span class="muted small">${fmtDate(a.start_on)}부터</span>
            </li>`)}</ul>` : html`<div class="muted">현재 맡은 역할이 없습니다.</div>`}
          ${teamsNow.length ? html`<div class="small muted" style="margin-top:10px">소속 팀: ${teamsNow.map((a) => a.team_name).join(', ')}</div>` : ''}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>역할 이력</h2><span class="hint">기간이 표시된 전체 배정 기록</span></div>
      <div class="card-body flush table-wrap">
        ${history.length ? html`<table class="table">
          <thead><tr><th>역할</th><th>대상</th><th>기간</th><th>비고</th>${ctx.isAdmin ? html`<th></th>` : ''}</tr></thead>
          <tbody>${history.map((a) => html`<tr>
            <td>${a.role_name} ${a.is_current ? badge('ok', '현직') : a.start_on > t ? badge('info', '예정') : ''}</td>
            <td>${a.team_name ?? (a.club_id ? html`<a href="#/clubs/${a.club_id}">${a.club_name}</a>` : '-')}</td>
            <td>${fmtPeriod(a.start_on, a.end_on)}</td>
            <td class="wrap small muted">${a.note ?? ''}</td>
            ${ctx.isAdmin ? html`<td class="actions">
              ${!a.end_on || a.end_on >= t ? html`<button class="btn xs" data-end="${a.id}">종료</button>` : ''}
              <button class="btn xs ghost" data-del="${a.id}" title="잘못 입력한 기록 삭제">삭제</button></td>` : ''}
          </tr>`)}</tbody></table>` : html`<div class="empty">역할 기록이 없습니다.</div>`}
      </div>
    </div>`);

  const guard = (fn) => async (...args) => { try { await fn(...args); } catch (e) { showError(e); } };

  on(el, 'click', '[data-edit]', guard(async () => {
    if (await editMemberForm(member, { admin: ctx.isAdmin, clubRep: isMyClubRep && !ctx.isAdmin })) { toast('저장했습니다.'); ctx.reload(); }
  }));
  on(el, 'click', '[data-verify]', guard(async () => {
    await qMut(sb.from('members').update({ contact_verified_on: today() }).eq('id', id));
    invalidate();
    toast('연락처 확인일을 오늘로 기록했습니다.');
    ctx.reload();
  }));
  on(el, 'click', '[data-assign]', guard(async () => {
    if (await assignRoleForm({ member_id: id }, { title: `${member.name} 역할 배정` })) { toast('배정했습니다.'); ctx.reload(); }
  }));
  on(el, 'click', '[data-end]', guard(async (_e, btn) => {
    const a = history.find((x) => x.id === btn.dataset.end);
    if (await endAssignmentForm(a)) { toast('종료일을 입력했습니다.'); ctx.reload(); }
  }));
  on(el, 'click', '[data-del]', guard(async (_e, btn) => {
    const a = history.find((x) => x.id === btn.dataset.del);
    const ok = await confirmDialog(
      `${a.role_name} (${fmtPeriod(a.start_on, a.end_on)}) 기록을 삭제합니다. 역할이 끝난 경우에는 삭제하지 말고 '종료'를 쓰세요. 삭제 내역은 변경 이력에 남습니다.`,
      { title: '배정 기록 삭제', confirmLabel: '삭제', danger: true },
    );
    if (!ok) return;
    await qMut(sb.from('role_assignments').delete().eq('id', a.id));
    invalidate();
    toast('삭제했습니다.');
    ctx.reload();
  }));
}
