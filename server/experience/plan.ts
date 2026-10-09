import { formatDate, formatTime, formatWhen, parseDate, parseTime, sinoToNumber } from './time.js';
import type {
  Booking, Evidence, InfoItem, Issue, IssueSide, IssueState, Patch, Plan, PlanAction, Source, When,
} from './types.js';

/** 진료 내용으로 읽는 출처. 환자 메모와 답변은 여기서 지시로 해석하지 않는다. */
export const CLINICAL_SOURCES = ['transcript', 'written', 'handout'];

const REVISIT_RE = /다음\s*(진료|방문|예약)|재진|다시\s*(오세요|오시면|내원)|다음에\s*오/;
const MED_RE = /약|복용|처방/;
const FREQ_RE = /(?:하루|1일|일)\s*(\d|한|두|세|네)\s*(?:번|회)/;
const TIMING_RE = /(식후|식전)(?:\s*\d+\s*분)?|자기\s*전|취침\s*전/g;
const DAYS_RE = /(\d+|[일이삼사오육칠팔구십]{1,3})\s*일\s*(?:분|치|동안|간)/;
const toCount = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : sinoToNumber(raw));
const AVOID_RE = /피하세요|피해\s*주세요|드시지\s*마|하지\s*마세요|금지|금식|삼가/;
const CONSIDER_RE = /고려|검토|생각하고|해\s*볼\s*수/;
const PROCEDURE_RE = /(\S*내시경(?:\s*검사)?|\S+\s?검사)/;
const SUSPECT_RE = /의심|가능성|수도\s*있/;
const CONTACT_RE = /(심해지면|나빠지면|계속되면|생기면).*(연락|오세요|내원|응급실)/;
const COUNT_WORD: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4 };

/** 조사까지 붙인 낱말. "날짜을"처럼 틀린 조사가 나오지 않게 한곳에서 정한다. */
const FIELD_WORD = {
  date: { noun: '날짜', obj: '날짜를', subj: '날짜가' },
  time: { noun: '시간', obj: '시간을', subj: '시간이' },
  when: { noun: '일정', obj: '일정을', subj: '일정이' },
  frequency: { noun: '먹는 횟수', obj: '먹는 횟수를', subj: '먹는 횟수가' },
};
export const fieldWord = (field: Issue['field']) => FIELD_WORD[field];

/** 일정의 날짜·시간 가운데 채워진 부분만 담는 저장 형식. 예: "2026-10-13|", "|15:00" */
export const packWhen = (when: When) => `${when.date ?? ''}|${when.time ?? ''}`;
export function unpackWhen(value: string): When {
  const [date, time] = value.split('|');
  return { date: date || undefined, time: time || undefined };
}

const REPLY_TYPES = ['hospital_reply', 'reported_reply'];
/** 아직 반영하지 않은 가장 최근 답변. 이미 반영한 답을 다시 내밀지 않는다. */
export function pendingReply(issue: Issue, sources: Source[]): Source | undefined {
  const reply = sources.filter((s) => s.issueId === issue.id && REPLY_TYPES.includes(s.type)).at(-1);
  return reply && reply.id !== issue.resolution?.sourceId ? reply : undefined;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 답에 적힌 요일이 그 날짜의 실제 요일과 다른지. 다르면 날짜 오타일 수 있어 반영하지 않는다. */
export function weekdayMismatch(text: string, date: string): boolean {
  const said = text.match(/([일월화수목금토])요일/)?.[1];
  if (!said) return false;
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()] !== said;
}

export type CandidateKind = 'revisit' | 'medication' | 'avoid' | 'considering' | 'suspected' | 'contact';

/**
 * 출처에서 찾은 후보 한 건. 누가 찾았든(규칙이든 모델이든) 같은 모양이다.
 * 날짜·시간·횟수 같은 값은 담지 않는다. 값은 조립할 때 인용문에서 코드로 다시 읽는다.
 */
export interface Candidate {
  kind: CandidateKind;
  sourceId: string;
  /** 출처에 실제로 있는 문장 그대로 */
  quote: string;
  /** 검토 중인 검사·시술 이름 (인용문 안의 표현) */
  procedure?: string;
  /** 인용문 안의 조건 표현 그대로. 예: "아침저녁으로" */
  conditions?: string[];
}

export function sentencesOf(text: string): string[] {
  return text
    .split(/\n+|(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hash(text: string): string {
  let h = 0;
  for (const ch of text.replace(/\s/g, '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
}

const uniq = <T,>(list: T[]) => [...new Set(list)];
const squash = (text: string) => text.replace(/\s+/g, '');

/** 모델 없이 규칙만으로 후보를 찾는다. 연결이 끊겼을 때의 대체 경로이자 테스트 기준. */
export function extractByRule(sources: Source[]): Candidate[] {
  const out: Candidate[] = [];
  for (const src of sources.filter((s) => CLINICAL_SOURCES.includes(s.type))) {
    for (const quote of sentencesOf(src.text)) {
      const base = { sourceId: src.id, quote };
      if (REVISIT_RE.test(quote)) out.push({ ...base, kind: 'revisit' });
      else if ((MED_RE.test(quote) || FREQ_RE.test(quote)) && (FREQ_RE.test(quote) || quote.match(TIMING_RE) || DAYS_RE.test(quote))) {
        out.push({ ...base, kind: 'medication' });
      } else if (AVOID_RE.test(quote)) out.push({ ...base, kind: 'avoid' });
      else if (CONSIDER_RE.test(quote) && PROCEDURE_RE.test(quote)) {
        out.push({ ...base, kind: 'considering', procedure: quote.match(PROCEDURE_RE)![1].trim() });
      } else if (CONTACT_RE.test(quote)) out.push({ ...base, kind: 'contact' });
      else if (SUSPECT_RE.test(quote)) out.push({ ...base, kind: 'suspected' });
    }
  }
  return out;
}

export type RejectReason = 'quote_not_in_source' | 'unknown_source' | 'not_clinical_source';

/**
 * 후보가 실제 출처에 근거하는지 코드로 확인한다 (FR-007, 출시 차단 항목 "원문 없는 근거 표시").
 * 인용문이 출처에 그대로 없으면 버린다. 모델이 문장을 고쳐 썼거나 지어낸 경우다.
 */
export function verifyCandidates(candidates: Candidate[], sources: Source[]) {
  const kept: Candidate[] = [];
  const rejected: { candidate: Candidate; reason: RejectReason }[] = [];
  for (const candidate of candidates) {
    const source = sources.find((s) => s.id === candidate.sourceId);
    if (!source) rejected.push({ candidate, reason: 'unknown_source' });
    else if (!CLINICAL_SOURCES.includes(source.type)) rejected.push({ candidate, reason: 'not_clinical_source' });
    else if (!candidate.quote.trim() || !squash(source.text).includes(squash(candidate.quote))) {
      rejected.push({ candidate, reason: 'quote_not_in_source' });
    } else {
      kept.push({
        ...candidate,
        quote: candidate.quote.trim(),
        // 조건과 검사 이름도 인용문 안에 있는 표현만 남긴다
        conditions: candidate.conditions?.filter((c) => c.trim() && squash(candidate.quote).includes(squash(c))),
        procedure:
          candidate.procedure && squash(candidate.quote).includes(squash(candidate.procedure))
            ? candidate.procedure.trim()
            : undefined,
      });
    }
  }
  return { kept, rejected };
}

export interface PlanInput {
  sources: Source[];
  issueStates: Record<string, IssueState>;
  booking: Booking;
  year: number;
}

function labelOf(sources: Source[], id: string) {
  return sources.find((s) => s.id === id)?.label ?? '자료';
}

function applyState(issue: Issue, states: Record<string, IssueState>): Issue {
  const saved = states[issue.id];
  // 비교한 값이 달라졌으면 이전 해결과 보류를 쓰지 않는다 (BR-10)
  if (!saved || saved.fingerprint !== issue.fingerprint) return issue;
  if (saved.state === 'resolved' && saved.value && saved.sourceId) {
    return { ...issue, state: 'resolved', resolution: { sourceId: saved.sourceId, value: saved.value, label: saved.value } };
  }
  return { ...issue, state: saved.state };
}

/** 확인된 후보로 계획을 조립한다. 모든 값은 여기서 인용문을 코드로 읽어 얻는다. */
export function assemblePlan(
  candidates: Candidate[],
  { sources, issueStates, booking, year }: PlanInput,
): Omit<Plan, 'version'> {
  const actions: PlanAction[] = [];
  const infos: InfoItem[] = [];
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const ev = (c: Candidate): Evidence => ({ sourceId: c.sourceId, quote: c.quote });
  const of = (kind: CandidateKind) => candidates.filter((c) => c.kind === kind);

  for (const c of of('avoid')) {
    const key = hash(c.quote);
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({
      id: `act-avoid-${key}`, kind: 'avoid', title: c.quote, conditions: [],
      evidence: [ev(c)], status: 'ready', issueIds: [],
    });
  }
  for (const c of [...of('contact'), ...of('considering'), ...of('suspected')]) {
    const key = hash(c.quote);
    if (seen.has(key)) continue;
    seen.add(key);
    infos.push({
      id: `info-${key}`, text: c.quote, evidence: [ev(c)],
      certainty: c.kind as 'considering' | 'suspected' | 'contact',
      bookable: c.kind === 'considering' ? c.procedure : undefined,
    });
  }

  const revisits = of('revisit').map((c) => ({
    ...ev(c),
    date: parseDate(c.quote, year) ?? undefined,
    time: parseTime(c.quote)?.time,
  }));
  if (revisits.length) {
    const action: PlanAction = {
      id: 'act-revisit', kind: 'revisit', title: '다음 진료 가기', when: {}, conditions: [],
      evidence: revisits.map(({ sourceId, quote }) => ({ sourceId, quote })),
      status: 'ready', issueIds: [],
    };

    // 날짜와 시간을 따로 묻지 않는다. "언제 가면 되나요?" 하나로 묻고, 답에서 읽힌 만큼 채운다.
    const values = {
      date: uniq(revisits.map((c) => c.date).filter((v): v is string => !!v)),
      time: uniq(revisits.map((c) => c.time).filter((v): v is string => !!v)),
    };
    const parts = ['date', 'time'] as const;
    for (const part of parts) if (values[part].length === 1) action.when![part] = values[part][0];
    const unsettled = parts.filter((part) => values[part].length !== 1);

    if (unsettled.length) {
      const id = 'issue-revisit-when';
      const fingerprint = `when:${values.date.slice().sort().join(',')}|${values.time.slice().sort().join(',')}`;
      // 비교한 값이 달라졌으면 이전 답과 보류를 쓰지 않는다 (BR-10)
      const saved = issueStates[id]?.fingerprint === fingerprint ? issueStates[id] : undefined;
      const answered: When = saved?.value ? unpackWhen(saved.value) : {};
      for (const part of unsettled) if (answered[part]) action.when![part] = answered[part];

      const needs = unsettled.filter((part) => !answered[part]);
      const focus = needs.length ? needs : unsettled;
      const field: Issue['field'] = focus.length === 2 ? 'when' : focus[0];
      const word = FIELD_WORD[field];
      const differs = (part: 'date' | 'time') => values[part].length > 1;
      const conflicting = focus.filter(differs);
      const show = (c: (typeof revisits)[number], part: 'date' | 'time') =>
        part === 'date' ? formatDate(c.date!) : formatTime(c.time!);
      const sides: IssueSide[] = revisits
        .filter((c) => conflicting.some((part) => c[part]))
        .map((c) => ({
          sourceId: c.sourceId, quote: c.quote,
          value: conflicting.filter((part) => c[part]).map((part) => show(c, part)).join(' '),
        }));
      const choices = uniq(sides.map((s) => s.value));
      const reply = saved?.sourceId ? sources.find((s) => s.id === saved.sourceId) : undefined;

      const issue: Issue = {
        id, kind: conflicting.length ? 'difference' : 'missing', field, clinical: false, needs, answered,
        title: conflicting.length
          ? `기록에 서로 다른 ${word.subj} 있어요`
          : field === 'when' ? '다음 진료가 언제인지 알 수 없어요' : `다음 진료 ${word.obj} 알 수 없어요`,
        summary: conflicting.length
          ? `${uniq(sides.map((s) => labelOf(sources, s.sourceId))).join(', ')}에 적힌 다음 진료 ${word.subj} 서로 달라요.`
          : `안내받은 내용에서 다음 진료 ${word.obj} 찾지 못했어요.`,
        sides,
        question: conflicting.length
          ? `다음 진료 ${word.subj} ${choices.join('인지 ')}인지 알려 주세요.`
          : field === 'when' ? '다음 진료는 몇 월 며칠, 몇 시에 가면 되는지 알려 주세요.'
            : field === 'time' ? '다음 진료는 몇 시에 가면 되는지 알려 주세요.'
              : '다음 진료는 몇 월 며칠에 가면 되는지 알려 주세요.',
        affects: [action.id],
        state: needs.length === 0 ? 'resolved' : saved?.state === 'deferred' ? 'deferred' : 'open',
        resolution: saved?.sourceId && saved.value
          ? { sourceId: saved.sourceId, value: saved.value, label: formatWhen(answered) }
          : undefined,
        fingerprint,
      };
      issues.push(issue);
      action.issueIds.push(id);
      if (reply) action.evidence.push({ sourceId: reply.id, quote: reply.text });
      if (needs.length) {
        action.status = 'needs_provider';
        action.missing = conflicting.length ? `${word.obj} 확인해야 해요` : `${word.obj} 아직 몰라요`;
      }
    }
    actions.unshift(action);
  }

  const meds = of('medication').map((c) => {
    const freq = c.quote.match(FREQ_RE);
    const days = c.quote.match(DAYS_RE);
    return {
      ...ev(c),
      perDay: freq ? COUNT_WORD[freq[1]] ?? Number(freq[1]) : undefined,
      timings: (c.quote.match(TIMING_RE) ?? []).map((t) => t.replace(/\s+/g, ' ')),
      days: days && !Number.isNaN(toCount(days[1])) ? toCount(days[1]) : undefined,
      // 규칙이 읽지 못한 조건은 원문 표현 그대로 보여준다. 숫자로 바꾸지 않는다 (BR-04)
      verbatim: (c.conditions ?? []).filter((x) => !FREQ_RE.test(x) && !DAYS_RE.test(x) && !x.match(TIMING_RE)),
    };
  });
  if (meds.length) {
    const perDays = uniq(meds.map((m) => m.perDay).filter((n): n is number => n !== undefined));
    const allTimings = uniq(meds.flatMap((m) => m.timings));
    // "식후"와 "식후 30분"이 함께 있으면 더 자세한 쪽만 남긴다
    const timings = allTimings.filter((t) => !allTimings.some((o) => o !== t && o.startsWith(t)));
    const days = uniq(meds.map((m) => m.days).filter((n): n is number => n !== undefined));
    const verbatim = uniq(meds.flatMap((m) => m.verbatim));

    const action: PlanAction = {
      id: 'act-med', kind: 'medication', title: '약 먹기', conditions: [],
      evidence: meds.map(({ sourceId, quote }) => ({ sourceId, quote })),
      status: 'ready', issueIds: [], med: {},
    };
    if (perDays.length === 1) {
      action.conditions.push(`하루 ${perDays[0]}번`);
      action.med!.perDay = perDays[0];
    }
    action.conditions.push(...timings, ...verbatim);
    if (days.length === 1) {
      action.conditions.push(`${days[0]}일 동안`);
      action.med!.days = days[0];
    }

    if (perDays.length > 1) {
      const sides = meds
        .filter((m) => m.perDay !== undefined)
        .map((m) => ({ sourceId: m.sourceId, quote: m.quote, value: `하루 ${m.perDay}번` }));
      const issue = applyState(
        {
          id: 'issue-med-frequency', kind: 'difference', field: 'frequency', clinical: true,
          title: '약 먹는 횟수가 기록마다 달라요',
          summary: '하루에 몇 번 먹는지 기록이 서로 달라요.',
          sides,
          question: `약을 ${perDays.map((n) => `하루 ${n}번`).join('인지 ')}인지 알려 주세요.`,
          affects: [action.id], state: 'open',
          fingerprint: `frequency:${perDays.slice().sort().join('|')}`,
        },
        issueStates,
      );
      issues.push(issue);
      action.issueIds.push(issue.id);
      action.status = 'needs_provider';
      action.missing = '먹는 횟수를 의료진에게 확인해야 해요';
    } else if (perDays.length === 0 && verbatim.length === 0) {
      action.status = 'needs_provider';
      action.missing = '하루에 몇 번 먹는지 안내가 없어요';
    }
    actions.push(action);
  }

  if (booking.state === 'confirmed' && booking.offer && booking.sourceId) {
    const reply = sources.find((s) => s.id === booking.sourceId);
    actions.push({
      id: 'act-test', kind: 'test', title: `${booking.subject ?? '검사'} 받기`, when: booking.offer,
      conditions: [], evidence: reply ? [{ sourceId: reply.id, quote: reply.text }] : [],
      status: 'ready', issueIds: [],
      missing: '검사 전에 준비할 것은 아직 안내받지 못했어요',
    });
  }

  const order = { revisit: 0, test: 1, medication: 2, avoid: 3 };
  actions.sort((a, b) => order[a.kind] - order[b.kind]);

  const usable = sources.filter((s) => CLINICAL_SOURCES.includes(s.type));
  return { actions, infos, issues, basedOn: usable.map((s) => s.label) };
}

/** 규칙만으로 처음부터 끝까지 정리한다. */
export function buildPlan(input: PlanInput): Omit<Plan, 'version'> {
  return assemblePlan(verifyCandidates(extractByRule(input.sources), input.sources).kept, input);
}

/** 답에서 값을 읽지 못한 이유. 화면이 무엇을 다시 물어야 하는지 알려 주는 데 쓴다. */
export type ReplyProblem = 'weekday_mismatch' | 'nothing_found';

function readReply(issue: Issue, reply: Source, year: number): { found: When; problem?: ReplyProblem } {
  const needs = issue.needs ?? [];
  const date = needs.includes('date') ? parseDate(reply.text, year) ?? undefined : undefined;
  const time = needs.includes('time') ? parseTime(reply.text)?.time : undefined;
  if (date && weekdayMismatch(reply.text, date)) return { found: {}, problem: 'weekday_mismatch' };
  if (!date && !time) return { found: {}, problem: 'nothing_found' };
  return { found: { ...(date ? { date } : {}), ...(time ? { time } : {}) } };
}

export function replyProblem(issue: Issue, reply: Source, year: number): ReplyProblem | null {
  if (issue.field === 'frequency') return FREQ_RE.test(reply.text) ? null : 'nothing_found';
  return readReply(issue, reply, year).problem ?? null;
}

/**
 * 답변에서 값을 읽어 변경안을 만든다. 읽지 못하면 null (추측하지 않는다).
 * 날짜와 시간 가운데 읽힌 것만 채우고, 나머지는 다음 질문으로 남긴다.
 */
export function proposePatch(issue: Issue, reply: Source, year: number): Patch | null {
  const evidence = { sourceId: reply.id, quote: reply.text };
  const base = { issueId: issue.id, actionId: issue.affects[0], field: issue.field, evidence };
  const before = uniq(issue.sides.map((s) => s.value));

  if (issue.field === 'frequency') {
    const m = reply.text.match(FREQ_RE);
    if (!m) return null;
    const count = String(COUNT_WORD[m[1]] ?? Number(m[1]));
    return { ...base, before, after: count, afterLabel: `하루 ${count}번` };
  }

  const { found, problem } = readReply(issue, reply, year);
  if (problem) return null;
  return { ...base, before, after: packWhen({ ...issue.answered, ...found }), afterLabel: formatWhen(found) };
}
