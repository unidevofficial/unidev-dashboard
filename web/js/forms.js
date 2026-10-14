// 여러 화면에서 쓰는 입력 폼 정의
import { sb, q, qMut, lookups, invalidate } from './api.js';
import { openForm, opts, CLUB_STATUS, clubLabel, today, sortKo } from './ui.js';

const nullIfEmpty = (v) => (v === '' ? null : v);

// ---------------------------------------------------------------------
// 동아리
// ---------------------------------------------------------------------
export function clubFields(c = {}, { admin }) {
  const f = [];
  if (admin) {
    f.push(
      { name: 'university', label: '대학', value: c.university, required: true },
      { name: 'status', label: '등록 구분', type: 'select', options: opts(CLUB_STATUS), value: c.status ?? 'pending', required: true },
      { name: 'registered_on', label: '등록일', type: 'date', value: c.registered_on },
    );
  }
  f.push(
    { name: 'name', label: '동아리명', value: c.name, required: true },
    { name: 'member_count', label: '회원 수', type: 'number', value: c.member_count },
    { name: 'official_email', label: '동아리 공식 이메일', type: 'email', value: c.official_email, help: '대표자 개인 이메일과 별개입니다.' },
    { name: 'sns_url', label: 'SNS 주소', type: 'url', value: c.sns_url },
    { name: 'note', label: '비고', type: 'textarea', value: c.note },
  );
  return f;
}

export async function createClubForm() {
  return openForm({
    title: '동아리 등록',
    description: '신규 동아리는 보통 "심사 중"으로 등록하고, 대표자회의 의결 후 등록 구분을 바꿉니다.',
    fields: clubFields({}, { admin: true }),
    submitLabel: '등록',
    onSubmit: async (v) => {
      const [row] = await q(sb.from('clubs').insert(v).select());
      invalidate();
      return row;
    },
  });
}

// officers: 현재 동아리 자체 회장단 행 (club_officers)
export async function editClubForm(club, { admin, officers = [] }) {
  return openForm({
    title: '동아리 정보 수정',
    description: admin ? null : '대표자는 동아리명·회원 수·공식 이메일·SNS·비고와 동아리 회장단을 수정할 수 있습니다. 수정 내용은 변경 이력에 남습니다.',
    fields: [
      ...clubFields(club, { admin }),
      {
        name: 'officers', label: '동아리 회장단', type: 'rows', value: officers,
        help: 'UNIDEV 대표자와 별개로, 동아리 자체의 회장·부회장 등을 적습니다. 모든 칸이 빈 행은 저장되지 않습니다.',
        columns: [
          { name: 'title', label: '직책', placeholder: '회장' },
          { name: 'name', label: '이름', placeholder: '홍길동' },
          { name: 'contact', label: '연락처', placeholder: '전화번호·이메일' },
        ],
      },
    ],
    onSubmit: async ({ officers: rows, ...v }) => {
      if (rows.some((r) => !r.name)) throw new Error('동아리 회장단의 이름을 입력하세요. (빈 행은 ✕로 지우세요)');
      const updated = await qMut(sb.from('clubs').update(v).eq('id', club.id));
      await saveClubOfficers(club.id, officers, rows);
      invalidate();
      return updated;
    },
  });
}

// 기존 행과 비교해 수정·추가·삭제한다 (변경 이력이 행 단위로 남도록 전부 지우고 다시 넣지 않음)
async function saveClubOfficers(clubId, before, after) {
  const keep = new Set(after.filter((r) => r.id).map((r) => r.id));
  const removed = before.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (removed.length) await qMut(sb.from('club_officers').delete().in('id', removed));
  const beforeById = Object.fromEntries(before.map((r) => [r.id, r]));
  for (const [i, r] of after.entries()) {
    const row = { name: r.name, title: r.title, contact: r.contact, sort_order: (i + 1) * 10 };
    if (!r.id) {
      await q(sb.from('club_officers').insert({ ...row, club_id: clubId }).select());
      continue;
    }
    const old = beforeById[r.id];
    if (old && ['name', 'title', 'contact', 'sort_order'].some((k) => (old[k] ?? null) !== row[k])) {
      await qMut(sb.from('club_officers').update(row).eq('id', r.id));
    }
  }
}

// ---------------------------------------------------------------------
// 구성원
// ---------------------------------------------------------------------
async function clubOptions() {
  const clubs = await lookups.clubs();
  return clubs.map((c) => ({ value: c.id, label: `${clubLabel(c)}${c.status === 'inactive' ? ' (비활성)' : ''}` }));
}

export async function memberFields(m = {}, { admin, isNew = false }) {
  const f = [{ name: 'name', label: '이름', value: m.name, required: true }];
  if (admin) {
    f.push(
      { name: 'university', label: '소속 대학', value: m.university },
      { name: 'club_id', label: '소속 동아리', type: 'select', options: await clubOptions(), value: m.club_id },
    );
  }
  f.push(
    { name: 'phone', label: '전화번호', type: 'tel', value: m.phone, placeholder: '010-0000-0000', help: '선택 항목' },
    { name: 'email', label: '이메일', type: 'email', value: m.email, help: '선택 항목. 로그인할 때 이 이메일로 계정이 연결됩니다.' },
    { name: 'contact_verified_on', label: '연락처 최종 확인일', type: 'date', value: m.contact_verified_on ?? (isNew ? today() : null) },
  );
  if (isNew) {
    f.push({
      name: 'consent', type: 'checkbox', required: true,
      label: '수집 목적(UNIDEV 운영 연락), 항목(이름·소속·전화번호·이메일), 보유 기간(모든 역할 종료 후 1년), 열람 범위(운영진 전원)를 알리고 동의를 받았습니다.',
    });
  }
  return f;
}

// admin=false: 대표자(동아리) 계정이 자기 동아리 새 대표자를 등록할 때 (소속은 preset으로 고정)
export async function createMemberForm(preset = {}, { admin = true } = {}) {
  return openForm({
    title: admin ? '구성원 등록' : '새 대표자 등록',
    fields: await memberFields(preset, { admin, isNew: true }),
    submitLabel: '등록',
    onSubmit: async ({ consent, ...v }) => {
      if (!admin) Object.assign(v, { club_id: preset.club_id, university: preset.university ?? null });
      if (!v.university && v.club_id) {
        const club = (await lookups.clubs()).find((c) => c.id === v.club_id);
        v.university = club?.university ?? null;
      }
      const [row] = await q(sb.from('members').insert(v).select());
      invalidate();
      return row;
    },
  });
}

// clubRep: 대표자(동아리) 계정이 자기 동아리 현직 대표자의 정보를 고치는 경우
export async function editMemberForm(member, { admin, clubRep = false }) {
  return openForm({
    title: admin ? '구성원 정보 수정' : clubRep ? '대표자 정보 수정' : '내 정보 수정',
    description: admin ? null : clubRep
      ? '현직 대표자의 이름과 연락처를 수정할 수 있습니다. ※ 변경 전 반드시 회장단에게 연락 부탁드립니다.'
      : '이름과 연락처를 수정할 수 있습니다.',
    fields: await memberFields(member, { admin }),
    onSubmit: async (v) => {
      for (const k of Object.keys(v)) v[k] = nullIfEmpty(v[k]);
      const row = await qMut(sb.from('members').update(v).eq('id', member.id));
      invalidate();
      return row;
    },
  });
}

// ---------------------------------------------------------------------
// 역할 배정
// ---------------------------------------------------------------------
export async function memberPickOptions() {
  const [members, clubs] = await Promise.all([lookups.members(), lookups.clubs()]);
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));
  return sortKo(members, (m) => m.name).map((m) => ({
    value: m.id,
    label: `${m.name} · ${clubLabel(clubById[m.club_id]) || '-'}`,
  }));
}

// preset: { member_id, club_id, team_id, role_code }
export async function assignRoleForm(preset = {}, { title = '역할 배정' } = {}) {
  const [roles, teams, clubOpts] = await Promise.all([lookups.roles(), lookups.teams(), clubOptions()]);
  const scopeOf = Object.fromEntries(roles.map((r) => [String(r.id), r.scope]));
  const presetRole = roles.find((r) => r.code === preset.role_code);
  const fields = [];
  if (!preset.member_id) {
    fields.push({ name: 'member_id', label: '구성원', type: 'pick', options: await memberPickOptions(), required: true });
  }
  fields.push(
    {
      name: 'role_id', label: '역할', type: 'select', required: true, value: presetRole?.id,
      options: roles
        .filter((r) => !preset.scope || r.scope === preset.scope)
        .map((r) => ({ value: r.id, label: `${r.name}${r.is_admin ? ' (관리자)' : ''}` })),
    },
    {
      name: 'club_id', label: '동아리', type: 'select', options: clubOpts, value: preset.club_id, required: true,
      showIf: (v) => scopeOf[v.role_id] === 'club',
    },
    {
      name: 'team_id', label: '팀', type: 'select', value: preset.team_id, required: true,
      options: teams.filter((t) => !t.closed_on).map((t) => ({ value: t.id, label: t.name })),
      showIf: (v) => scopeOf[v.role_id] === 'team',
    },
    { name: 'start_on', label: '시작일', type: 'date', value: today(), required: true },
    { name: 'end_on', label: '종료일', type: 'date', help: '비워 두면 현직(종료일 미정)입니다.' },
    { name: 'note', label: '비고' },
  );
  return openForm({
    title,
    fields,
    submitLabel: '배정',
    onSubmit: async (v) => {
      const row = {
        member_id: preset.member_id ?? v.member_id,
        role_id: Number(v.role_id),
        club_id: v.club_id ?? null,
        team_id: v.team_id ?? null,
        start_on: v.start_on,
        end_on: v.end_on ?? null,
        note: v.note ?? null,
      };
      const [created] = await q(sb.from('role_assignments').insert(row).select());
      invalidate();
      return created;
    },
  });
}

export async function endAssignmentForm(a) {
  return openForm({
    title: '역할 종료',
    description: `${a.member_name ?? ''} · ${[a.team_name, a.club_name, a.role_name].filter(Boolean).join(' ')} (${a.start_on} 시작)`,
    fields: [
      { name: 'end_on', label: '종료일', type: 'date', value: today() < a.start_on ? a.start_on : today(), required: true },
      { name: 'note', label: '비고', value: a.note },
    ],
    submitLabel: '종료',
    onSubmit: async (v) => {
      const row = await qMut(sb.from('role_assignments').update({ end_on: v.end_on, note: v.note ?? null }).eq('id', a.id));
      invalidate();
      return row;
    },
  });
}
