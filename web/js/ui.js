// 화면 공용 도구: 이스케이프 템플릿, 표시 형식, 대화상자, 토스트

// ---------------------------------------------------------------------
// HTML 템플릿 (값은 자동 이스케이프, raw()로 감싼 값과 html``의 결과만 그대로)
// ---------------------------------------------------------------------
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderValue(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += renderValue(v) + strings[i + 1]; });
  return new Raw(out);
}

export function setHtml(el, tpl) {
  el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl);
}

// 이벤트 위임: on(root, 'click', '[data-act=edit]', (e, target) => ...)
export function on(root, type, selector, fn) {
  root.addEventListener(type, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

// ---------------------------------------------------------------------
// 표시 형식
// ---------------------------------------------------------------------
export const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD (현지 시각)

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}
export function addMonths(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString('sv-SE');
}

export const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');
export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtPeriod(start, end) {
  return `${fmtDate(start)} ~ ${end ? fmtDate(end) : '현재'}`;
}
export const isCurrent = (a, on = today()) => a.start_on <= on && (!a.end_on || a.end_on >= on);

// 목록용 전화번호 가림: 010-1234-5678 → 010-****-5678
export function maskPhone(phone) {
  if (!phone) return '';
  const m = String(phone).replace(/\s/g, '').match(/^(\d{2,3})-?(\d{3,4})-?(\d{4})$/);
  if (m) return `${m[1]}-${'*'.repeat(m[2].length)}-${m[3]}`;
  const s = String(phone);
  return s.length <= 4 ? '****' : '*'.repeat(s.length - 4) + s.slice(-4);
}

export const CLUB_STATUS = { full: '정등록', provisional: '가등록', pending: '심사 중', inactive: '비활성' };
export const SANCTION_KIND = { caution: '주의', warning: '경고', expulsion: '제명' };
export const ATTENDANCE = { present: '출석', absent: '결석', excused: '사유 결석' };
export const MEETING_KIND = { representatives: '대표자회의', executives: '운영진회의', team: '팀 회의' };
export const LOG_ACTION = { insert: '추가', update: '수정', delete: '삭제', export: '내보내기', purge: '연락처 파기' };
export const TABLE_LABEL = {
  clubs: '동아리', members: '구성원', teams: '팀', roles: '역할 종류', role_assignments: '역할 배정',
  meetings: '회의', attendances: '출결', sanctions: '징계', club_officers: '동아리 회장단', accounts: '로그인 계정',
};

export const badge = (cls, label) => html`<span class="badge ${cls}">${label}</span>`;
export const statusBadge = (s) => badge(s, CLUB_STATUS[s] ?? s);
// 학교 이름은 동아리 목록·상세에서만 보이고, 그 밖에서는 동아리 이름만 쓴다
export const clubLabel = (c) => (c ? (c.name ?? c.club_name ?? '') : '');
// 동아리 이름 ABC순 (영문 대소문자 구분 없이, 영문 다음 한글)
export const compareClubName = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'en', { sensitivity: 'base', numeric: true });
export const sortClubs = (arr, key = (c) => c.name) => [...arr].sort((a, b) => compareClubName(key(a), key(b)));

export const opts = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// ---------------------------------------------------------------------
// 토스트
// ---------------------------------------------------------------------
export function toast(message, type = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3000);
}

// ---------------------------------------------------------------------
// 폼 대화상자
//   fields: [{ name, label, type, value, options, required, placeholder, help, showIf(values), half }]
//   type: text | email | tel | url | date | number | textarea | select | pick | checkbox | rows
//     pick: 검색 입력이 붙은 목록 선택 (구성원 등 항목이 많은 경우)
//     rows: 행을 추가·삭제할 수 있는 입력 표. columns: [{ name, label, placeholder }], value: [{ id?, ...열 }]
//           값은 모든 열이 빈 행을 뺀 배열 [{ id(기존 행이면), ...열 }]
//   onSubmit(values) 이 예외를 던지면 대화상자에 오류를 표시하고 닫지 않는다.
// ---------------------------------------------------------------------
export function openForm({ title, description, fields = [], submitLabel = '저장', danger = false, onSubmit }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    const fieldHtml = (f) => {
      const id = `f_${f.name}`;
      const req = f.required ? html`<span class="req">*</span>` : '';
      const help = f.help ? html`<div class="help">${f.help}</div>` : '';
      const common = html`id="${id}" name="${f.name}" ${f.required ? raw('required') : ''} ${f.placeholder ? html`placeholder="${f.placeholder}"` : ''}`;
      let input;
      if (f.type === 'rows') {
        return html`<div class="field" data-field="${f.name}"><label>${f.label}</label>
          <div class="rows-editor" data-rows="${f.name}" style="--cols:${f.columns.length}">
            <div class="rows-head">${f.columns.map((c) => html`<span>${c.label}</span>`)}<span></span></div>
            ${(f.value ?? []).map((row) => rowHtml(f, row))}
          </div>
          <button type="button" class="btn sm" data-add-row="${f.name}" style="align-self:flex-start">+ 행 추가</button>${help}</div>`;
      } else if (f.type === 'checkbox') {
        return html`<div class="field check" data-field="${f.name}">
          <input type="checkbox" ${common} ${f.value ? raw('checked') : ''}>
          <label for="${id}">${f.label}${req}</label></div>`;
      } else if (f.type === 'textarea') {
        input = html`<textarea ${common}>${f.value ?? ''}</textarea>`;
      } else if (f.type === 'select' || f.type === 'pick') {
        const options = html`${f.type === 'select' && !f.required ? html`<option value="">선택 안 함</option>` : ''}
          ${f.type === 'select' && f.required ? html`<option value="" disabled ${f.value == null ? raw('selected') : ''}>선택하세요</option>` : ''}
          ${(f.options ?? []).map((o) => html`<option value="${o.value}" ${String(o.value) === String(f.value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}`;
        input = f.type === 'pick'
          ? html`<input type="search" class="pick-filter" data-for="${id}" placeholder="이름·소속으로 찾기"><select ${common} size="7">${options}</select>`
          : html`<select ${common}>${options}</select>`;
      } else {
        input = html`<input type="${f.type ?? 'text'}" ${common} value="${f.value ?? ''}" ${f.type === 'number' ? raw('min="0"') : ''}>`;
      }
      return html`<div class="field" data-field="${f.name}"><label for="${id}">${f.label}${req}</label>${input}${help}</div>`;
    };

    function rowHtml(f, row = {}) {
      return html`<div class="rows-row" data-row-id="${row.id ?? ''}">
        ${f.columns.map((c) => html`<input type="text" data-col="${c.name}" value="${row[c.name] ?? ''}" placeholder="${c.placeholder ?? ''}" aria-label="${c.label}">`)}
        <button type="button" class="btn xs ghost" data-remove-row title="행 삭제" aria-label="행 삭제">✕</button></div>`;
    }

    dlg.innerHTML = html`<form method="dialog" novalidate>
      <div class="modal-head"><h2>${title}</h2>${description ? html`<p>${description}</p>` : ''}</div>
      <div class="modal-body">${fields.map(fieldHtml)}<div class="form-error" hidden></div></div>
      <div class="modal-foot">
        <button type="button" class="btn" data-cancel>취소</button>
        <button type="submit" class="btn ${danger ? 'danger solid' : 'primary'}">${submitLabel}</button>
      </div></form>`.s;
    if (!fields.length) dlg.querySelector('.modal-body').hidden = true;

    const form = dlg.querySelector('form');
    const errBox = dlg.querySelector('.form-error');

    const values = () => {
      const v = {};
      for (const f of fields) {
        if (f.type === 'rows') {
          v[f.name] = [...form.querySelectorAll(`[data-rows="${f.name}"] .rows-row`)].map((r) => {
            const row = r.dataset.rowId ? { id: r.dataset.rowId } : {};
            for (const c of f.columns) {
              const val = r.querySelector(`[data-col="${c.name}"]`).value.trim();
              row[c.name] = val === '' ? null : val;
            }
            return row;
          }).filter((row) => f.columns.some((c) => row[c.name] != null));
          continue;
        }
        const el = form.elements[f.name];
        if (!el) continue;
        if (f.type === 'checkbox') v[f.name] = el.checked;
        else if (f.type === 'number') v[f.name] = el.value === '' ? null : Number(el.value);
        else v[f.name] = el.value.trim() === '' ? null : el.value.trim();
      }
      return v;
    };
    const applyShowIf = () => {
      const v = values();
      for (const f of fields) {
        if (!f.showIf) continue;
        const show = f.showIf(v);
        const wrap = form.querySelector(`[data-field="${f.name}"]`);
        wrap.hidden = !show;
        form.elements[f.name].disabled = !show;
      }
    };

    form.addEventListener('input', (e) => {
      if (e.target.classList.contains('pick-filter')) {
        const sel = form.querySelector(`#${e.target.dataset.for}`);
        const term = e.target.value.trim().toLowerCase();
        for (const o of sel.options) o.hidden = term && !o.textContent.toLowerCase().includes(term);
      }
    });
    form.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add-row]');
      if (add) {
        const f = fields.find((x) => x.name === add.dataset.addRow);
        const box = form.querySelector(`[data-rows="${f.name}"]`);
        box.insertAdjacentHTML('beforeend', rowHtml(f).s);
        box.lastElementChild.querySelector('input').focus();
      }
      const rm = e.target.closest('[data-remove-row]');
      if (rm) rm.closest('.rows-row').remove();
    });
    form.addEventListener('change', applyShowIf);
    applyShowIf();

    const close = (result) => { dlg.close(); dlg.remove(); resolve(result); };
    dlg.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const v = values();
      for (const f of fields) {
        const wrap = form.querySelector(`[data-field="${f.name}"]`);
        if (f.type === 'rows') continue;
        if (f.required && !wrap.hidden && (v[f.name] == null || v[f.name] === false)) {
          errBox.textContent = `'${f.label}' 항목을 입력하세요.`;
          errBox.hidden = false;
          form.elements[f.name].focus();
          return;
        }
        if (wrap.hidden) delete v[f.name];
      }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const result = onSubmit ? await onSubmit(v) : v;
        close(result ?? v);
      } catch (err) {
        errBox.textContent = errorMessage(err);
        errBox.hidden = false;
        btn.disabled = false;
      }
    });

    document.body.appendChild(dlg);
    dlg.showModal();
    const first = form.querySelector('input:not([type=checkbox]):not([disabled]), select, textarea');
    if (first && fields.length) first.focus();
  });
}

export async function confirmDialog(message, { title = '확인', confirmLabel = '확인', danger = false } = {}) {
  const r = await openForm({ title, description: message, submitLabel: confirmLabel, danger });
  return r !== null;
}

// Supabase/PostgREST 오류를 사람이 읽을 문장으로
export function errorMessage(err) {
  if (!err) return '알 수 없는 오류가 발생했습니다.';
  const msg = err.message || String(err);
  const code = err.code;
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return '권한이 없습니다.';
  if (code === '23505' || /duplicate key/i.test(msg)) return '이미 같은 값이 등록되어 있습니다.';
  if (code === '23514' || /violates check constraint/i.test(msg)) return '입력값이 규칙에 맞지 않습니다. (날짜 순서·값 범위 확인)';
  if (code === '23503') return '다른 기록이 참조하고 있어 처리할 수 없습니다.';
  if (code === 'PGRST301' || /JWT expired/i.test(msg)) return '로그인이 만료되었습니다. 다시 로그인하세요.';
  if (/Failed to fetch/i.test(msg)) return '서버에 연결할 수 없습니다.';
  return msg;
}

export function showError(err) {
  console.error(err);
  toast(errorMessage(err), 'error');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function downloadCsv(filename, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const sortKo = (arr, key) => [...arr].sort((a, b) => String(key(a) ?? '').localeCompare(String(key(b) ?? ''), 'ko'));
