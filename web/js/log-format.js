// 변경 이력 표시용 도우미 (현황 요약·변경 이력 화면 공용)
import { html, TABLE_LABEL, LOG_ACTION, badge } from './ui.js';

// 사람이 알아볼 수 있는 대상 이름
export function logRecordLabel(log, names = {}) {
  const d = log.after_data ?? log.before_data ?? {};
  if (log.action === 'export') return `연락처 ${d.count ?? ''}건`;
  switch (log.table_name) {
    case 'clubs': return d.name ?? '';
    case 'members': return d.name ?? names.members?.[log.record_id] ?? '';
    case 'teams': return d.name ?? '';
    case 'roles': return d.name ?? '';
    case 'role_assignments':
      return [names.members?.[d.member_id], names.roles?.[d.role_id]].filter(Boolean).join(' · ');
    case 'meetings': return [d.held_on, d.title].filter(Boolean).join(' ');
    case 'attendances': return names.clubs?.[d.club_id] ?? names.members?.[d.member_id] ?? '';
    case 'accounts': return d.username ?? '';
    case 'sanctions':
    case 'club_officers': return [names.clubs?.[d.club_id], d.name].filter(Boolean).join(' · ');
    default: return log.record_id;
  }
}

export const actionBadge = (a) => badge(a, LOG_ACTION[a] ?? a);

// 처리자: 운영진 계정이면 이름, 대표자(동아리) 계정이면 동아리 이름, 둘 다 없으면 시스템(직접 SQL 등)
export function actorLabel(log, names = {}) {
  if (log.actor_member_id) return names.members?.[log.actor_member_id] ?? '(알 수 없음)';
  if (log.actor_club_id) return `${names.clubs?.[log.actor_club_id] ?? '(알 수 없음)'} 대표자 계정`;
  return '시스템';
}
export const tableLabel = (t) => TABLE_LABEL[t] ?? t;

// 변경 전후 비교 표
const HIDDEN = new Set(['created_at', 'updated_at']);
const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function diffTable(log) {
  const before = log.before_data ?? {};
  const after = log.after_data ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDDEN.has(k));
  if (log.action === 'update') {
    const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (!changed.length) return html`<div class="muted small">표시할 변경 항목이 없습니다.</div>`;
    return html`<table class="diff"><thead><tr><th>항목</th><th>변경 전</th><th>변경 후</th></tr></thead><tbody>
      ${changed.map((k) => html`<tr><th>${k}</th><td class="before">${show(before[k])}</td><td class="after">${show(after[k])}</td></tr>`)}
    </tbody></table>`;
  }
  const data = log.action === 'delete' ? before : after;
  return html`<table class="diff"><tbody>
    ${Object.keys(data).filter((k) => !HIDDEN.has(k)).map((k) => html`<tr><th>${k}</th><td class="${log.action === 'delete' ? 'before' : log.action === 'insert' ? 'after' : ''}">${show(data[k])}</td></tr>`)}
  </tbody></table>`;
}
