// 로그인 (/#/login) — 아이디·비밀번호
import { auth, isLocal } from '../api.js';
import { html, setHtml, on, showError, errorMessage } from '../ui.js';

const NOTICE = html`
  <div class="login-notice">
    <strong>개인정보 이용 수칙</strong><br>
    이 시스템의 연락처는 UNIDEV 운영 목적으로만 운영진에게 공개됩니다.
    개인정보를 무단으로 유출하거나 목적 외로 이용하는 행위는
    <strong>회칙 제60조 제3항 제3호</strong>에 따른 활동 제한 사유입니다.
    연락처는 모든 역할이 끝나고 1년이 지나면 삭제됩니다.
  </div>`;

export async function render(el, _params, { onSignedIn }) {
  setHtml(el, html`
    <div class="login-wrap">
      <div class="card login-card">
        <div class="brand"><div class="brand-mark">U</div><div><div class="brand-name">UNIDEV 대시보드</div><div class="brand-sub">전국대학생게임개발동아리연합회 내부 정보 관리</div></div></div>
        <form data-login autocomplete="on">
          <label for="username" class="small muted">아이디</label>
          <input id="username" name="username" required autocomplete="username" autocapitalize="none" spellcheck="false">
          <label for="password" class="small muted">비밀번호</label>
          <input id="password" name="password" type="password" required autocomplete="current-password">
          <div class="form-error" hidden></div>
          <button class="btn primary" type="submit">로그인</button>
          <div class="muted small">운영진은 개인 계정, 동아리 대표자는 동아리 계정으로 로그인합니다. 계정 발급·비밀번호 재설정은 관리자에게 문의하세요.</div>
        </form>
        ${isLocal ? html`
          <div class="divider">로컬 개발용 빠른 로그인</div>
          <div class="dev-users" data-dev-users><div class="muted small">계정 목록을 불러오는 중…</div></div>` : ''}
        ${NOTICE}
      </div>
    </div>`);

  const form = el.querySelector('[data-login]');
  const errBox = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await auth.signIn(form.username.value, form.password.value);
      onSignedIn();
    } catch (err) {
      errBox.textContent = errorMessage(err);
      errBox.hidden = false;
      btn.disabled = false;
    }
  });
  form.username.focus();

  if (!isLocal) return;
  const box = el.querySelector('[data-dev-users]');
  try {
    const accounts = await auth.devAccounts();
    setHtml(box, accounts.length
      ? html`${accounts.map((a) => html`
          <button class="btn dev-user" data-username="${a.username}">
            <span>${a.label} <span class="r">${a.username}</span></span>
            <span class="r">${a.kind === 'club' ? '대표자 계정' : '운영진 계정'}</span>
          </button>`)}`
      : html`<div class="muted small">계정이 없습니다. npm run db:reset 으로 데이터를 넣으세요.</div>`);
    on(box, 'click', '[data-username]', async (_e, t) => {
      try {
        await auth.devQuickLogin(t.dataset.username);
        onSignedIn();
      } catch (err) { showError(err); }
    });
  } catch (err) {
    setHtml(box, html`<div class="form-error">개발 서버에서 계정 목록을 가져오지 못했습니다: ${err.message}</div>`);
  }
}
