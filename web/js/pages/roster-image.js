// 운영위원 명단 이미지 (/#/roster-image) — 관리자(회장·부회장·팀장) 전용
//   회의 때 쓰는 "직책/동아리 · 이름" 표를 DB의 대표자 정보로 그려 PNG로 저장한다.
//   기준일의 현직 회장·부회장, 그리고 정등록·가등록 동아리와 그 날의 대표자를 넣는다.
//   /#/roster-image?meeting=<id> 로 열면 그 회의의 제목·날짜로 채운다.
import { sb, q, qAll, lookups } from '../api.js';
import { html, setHtml, on, today, MEETING_KIND, toast, showError } from '../ui.js';

const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const TITLE_KEY = 'unidev.rosterImage.title';

// 한글 이름 동아리 먼저(가나다), 그다음 영문 이름(ABC) — 기존 명단 이미지 순서
const isHangul = (s) => /^[가-힣]/.test(s ?? '');
function compareForRoster(a, b) {
  if (isHangul(a) !== isHangul(b)) return isHangul(a) ? -1 : 1;
  return isHangul(a) ? a.localeCompare(b, 'ko') : a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
}

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

export async function render(el, _params, ctx) {
  const meetingId = new URLSearchParams(location.hash.split('?')[1] ?? '').get('meeting');
  const [meeting] = meetingId ? await q(sb.from('meetings').select('*').eq('id', meetingId)) : [];

  const state = {
    line1: meeting ? `UNIDEV ${meeting.title || MEETING_KIND[meeting.kind]}` : (storage.get(TITLE_KEY) ?? 'UNIDEV 운영진 정기 회의'),
    line2: '운영위원 명단',
    date: meeting?.held_on ?? today(),
    withExecs: true,
  };

  setHtml(el, html`
    ${meeting ? html`<div class="crumb"><a href="#/meetings/${meeting.id}">회의·출결</a></div>` : html`<div class="crumb"><a href="#/meetings">회의·출결</a></div>`}
    <div class="page-head">
      <div><h1>명단 이미지</h1><div class="sub">동아리명과 대표자 이름으로 운영위원 명단 이미지를 만듭니다</div></div>
      <div class="page-actions">
        <button class="btn" data-copy>이미지 복사</button>
        <button class="btn primary" data-save>PNG 저장</button>
      </div>
    </div>
    <div class="card card-body" style="margin-bottom:16px">
      <div class="grid grid-2">
        <div class="field"><label for="ri-line1">제목 첫째 줄</label><input id="ri-line1" data-f="line1" value="${state.line1}"></div>
        <div class="field"><label for="ri-line2">제목 둘째 줄</label><input id="ri-line2" data-f="line2" value="${state.line2}"></div>
        <div class="field"><label for="ri-date">기준일</label><input id="ri-date" type="date" data-f="date" value="${state.date}">
          <span class="help">이 날짜에 재임 중인 대표자·회장단으로 만듭니다.</span></div>
        <div class="field check" style="align-self:center"><input id="ri-execs" type="checkbox" data-f="withExecs" checked><label for="ri-execs">회장·부회장 포함</label></div>
      </div>
    </div>
    <div data-warn></div>
    <div class="card card-body" style="overflow:auto;background:#fff">
      <canvas data-canvas style="display:block;margin:0 auto;max-width:100%;height:auto"></canvas>
    </div>`);

  const canvas = el.querySelector('[data-canvas]');
  const clubs = await lookups.clubs();
  let rows = [];

  async function load() {
    const d = state.date || today();
    const assigns = await qAll(() => sb.from('v_assignments')
      .select('id,member_name,role_code,role_sort_order,club_id,start_on,end_on,created_at')
      .in('role_code', ['president', 'vice_president', 'representative'])
      .lte('start_on', d).or(`end_on.is.null,end_on.gte.${d}`)
      .order('id'));
    // 같은 날 교체된 경우 가장 최근 배정 (v_club_overview와 같은 기준)
    const latest = (list) => [...list].sort((a, b) => b.start_on.localeCompare(a.start_on)
      || (b.end_on ?? '9999').localeCompare(a.end_on ?? '9999') || b.created_at.localeCompare(a.created_at))[0];

    const execs = state.withExecs
      ? ['president', 'vice_president'].flatMap((code) => assigns.filter((a) => a.role_code === code)
        .sort((a, b) => a.member_name.localeCompare(b.member_name, 'ko'))
        .map((a) => ({ label: code === 'president' ? '회장' : '부회장', name: a.member_name })))
      : [];
    const clubRows = clubs.filter((c) => ['full', 'provisional'].includes(c.status))
      .map((c) => ({ label: c.name, name: latest(assigns.filter((a) => a.role_code === 'representative' && a.club_id === c.id))?.member_name ?? '' }))
      .sort((a, b) => compareForRoster(a.label, b.label));
    rows = [...execs, ...clubRows];

    const missing = clubRows.filter((r) => !r.name).map((r) => r.label);
    setHtml(el.querySelector('[data-warn]'), missing.length
      ? html`<div class="notice" style="margin-bottom:16px">대표자가 없는 동아리: ${missing.join(', ')} — 이미지에는 빈칸으로 들어갑니다.</div>`
      : '');
  }

  async function draw() {
    await document.fonts.load(`700 20px ${FONT}`).catch(() => {});
    await document.fonts.load(`600 15px ${FONT}`).catch(() => {});
    const S = 2; // 선명하게 2배로 그린다
    const colW = 147; const rowH = 34; const pad = 30;
    const titleH = state.line2 ? 100 : 66;
    const half = Math.ceil(rows.length / 2);
    const tableW = colW * 4; const tableH = rowH * half;
    const W = tableW + pad * 2; const H = titleH + tableH + pad + 10;

    canvas.width = W * S; canvas.height = H * S;
    canvas.style.width = `${W}px`;
    const g = canvas.getContext('2d');
    g.scale(S, S);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';

    g.font = `800 23px ${FONT}`;
    g.fillText(state.line1, W / 2, 38);
    if (state.line2) g.fillText(state.line2, W / 2, 70);

    const top = titleH + 8;
    const fit = (text, max) => { // 칸보다 길면 글자 크기를 줄인다
      let size = 14;
      g.font = `600 ${size}px ${FONT}`;
      while (g.measureText(text).width > max && size > 9) g.font = `600 ${--size}px ${FONT}`;
    };
    rows.forEach((r, i) => {
      const col = i < half ? 0 : 2;
      const y = top + (i % half) * rowH + rowH / 2;
      fit(r.label, colW - 12); g.fillText(r.label, pad + col * colW + colW / 2, y + 1);
      fit(r.name, colW - 12); g.fillText(r.name, pad + (col + 1) * colW + colW / 2, y + 1);
    });

    g.strokeStyle = '#000'; g.lineWidth = 1;
    const x0 = pad + 0.5; const y0 = top + 0.5;
    g.beginPath();
    for (let i = 0; i <= half; i++) { g.moveTo(x0, y0 + i * rowH); g.lineTo(x0 + tableW, y0 + i * rowH); }
    for (let j = 0; j <= 4; j++) { g.moveTo(x0 + j * colW, y0); g.lineTo(x0 + j * colW, y0 + tableH); }
    g.stroke();
  }

  const refresh = async (reload) => {
    try { if (reload) await load(); await draw(); } catch (e) { showError(e); }
  };
  await refresh(true);

  on(el, 'input', '[data-f]', (_e, input) => {
    const k = input.dataset.f;
    state[k] = input.type === 'checkbox' ? input.checked : input.value;
    if (k === 'line1' && !meeting) storage.set(TITLE_KEY, state.line1);
    refresh(k === 'date' || k === 'withExecs');
  });

  const fileName = () => `${(state.line1 + (state.line2 ? ` ${state.line2}` : '')).replace(/[\\/:*?"<>|]/g, '').trim() || '명단'}.png`;
  const toBlob = () => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

  on(el, 'click', '[data-save]', async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await toBlob());
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  on(el, 'click', '[data-copy]', async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob() })]);
      toast('이미지를 복사했습니다. 메신저에 붙여 넣으세요.');
    } catch {
      toast('이 브라우저에서는 이미지 복사를 할 수 없습니다. PNG 저장을 쓰세요.', 'error');
    }
  });
}
