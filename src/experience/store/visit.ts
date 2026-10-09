import { useSyncExternalStore } from 'react';
import { isMockMode, storageKey } from '../runtime';
import { agent } from '../agent';
import { DEMO_APPOINTMENT, DEMO_NOTE, REQUEST_OPTIONS } from '../lib/demo';
import { initialPreparation } from './preparation';
import { packWhen } from '../agent/plan';
import { formatWhen, parseDate, parseTime } from '../lib/time';
import type {
  Appointment, DeskMessage, Patch, PendingReply, Source, SourceType, Stage, Trace, Visit, When,
} from '../lib/types';

/** 보관 기간. 화면 문구와 실제 만료가 같은 값을 읽는다. */
export const RETENTION_DAYS = 7;
const LOCAL_KEY = storageKey('pulda.visit');
const SESSION_KEY = storageKey('pulda.session');
const MAX_TRACES = 8;

interface State {
  visit: Visit | null;
  /** 상대에게 크게 보여줄 문장. 저장하지 않는다 */
  presenting: string[] | null;
  /** 보관 기간이 지나 지운 기록이 있었는지 */
  expired: boolean;
}

let state: State = { visit: null, presenting: null, expired: false };
const listeners = new Set<() => void>();
let runSeq = 0;

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** 접수 창구 주소는 이 코드를 아는 사람만 열 수 있다. 추측하기 어렵게 길게 만든다. */
function newDeskCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => (b % 36).toString(36)).join('');
}

function emit() {
  listeners.forEach((l) => l());
}

function persist(visit: Visit | null) {
  try {
    if (!visit) {
      localStorage.removeItem(LOCAL_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(visit));
    if (visit.storage === 'local') localStorage.setItem(LOCAL_KEY, JSON.stringify(visit));
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    // 저장하지 못한 것을 성공처럼 보이지 않게 화면에 알린다 (STORAGE_FAILED)
    if (visit && !visit.storageFailed) {
      state = { ...state, visit: { ...visit, storageFailed: true } };
    }
  }
}

function set(next: Partial<State>) {
  state = { ...state, ...next };
  if ('visit' in next) persist(state.visit);
  emit();
}

export function mutate(recipe: (visit: Visit) => void) {
  if (!state.visit) return;
  const draft = structuredClone(state.visit);
  recipe(draft);
  set({ visit: draft });
}

function load() {
  try {
    const session = sessionStorage.getItem(SESSION_KEY);
    const local = localStorage.getItem(LOCAL_KEY);
    const visit: Visit | null = JSON.parse(session ?? local ?? 'null');
    if (!visit) return;
    if (visit.storage === 'local' && visit.expiresAt && visit.expiresAt < Date.now()) {
      persist(null);
      state = { ...state, expired: true };
      return;
    }
    // 다시 열었을 때 중단된 분석은 대기 상태로 되돌리고, 예전 기록에 없던 칸을 채운다
    state = {
      ...state,
      visit: { ...visit, analysis: 'idle', deskCode: visit.deskCode ?? newDeskCode(), deskSeen: visit.deskSeen ?? [], traces: visit.traces ?? [] },
    };
  } catch {
    persist(null);
  }
}
load();

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

export const useVisit = () => useStore((s) => s.visit);
export const getVisit = () => state.visit;
export const setPresenting = (lines: string[] | null) => set({ presenting: lines });
export const dismissExpired = () => set({ expired: false });

const planYear = (visit: Visit) => Number(visit.appointment.date.slice(0, 4)) || new Date().getFullYear();

export function startVisit(options: { appointment?: Partial<Appointment>; stage?: Stage; demo?: boolean } = {}) {
  const demo = isMockMode || (options.demo ?? false);
  const visit: Visit = {
    id: uid('visit'),
    createdAt: Date.now(),
    demo,
    stage: options.stage ?? 'preparing',
    appointment: { hospital: '', dept: '', date: '', time: '', ...(demo ? DEMO_APPOINTMENT : options.appointment), ...(isMockMode ? options.appointment : {}) },
    requests: demo ? [REQUEST_OPTIONS[0]] : [],
    notes: [],
    segments: [],
    sources: [],
    issueStates: {},
    plan: null,
    analysis: 'idle',
    done: {},
    storage: 'unset',
    executions: [],
    reminderTimes: [],
    thread: [],
    pending: [],
    booking: { state: 'none' },
    deskCode: newDeskCode(),
    deskSeen: [],
    traces: [],
  };
  visit.preparation = initialPreparation(visit, visit.stage === 'preparing');
  if (demo && visit.stage === 'preparing') visit.preparation.reason = DEMO_NOTE;
  set({ visit, expired: false });
  connectDesk();
}

export function deleteVisit() {
  runSeq++;
  set({ visit: null, presenting: null });
  connectDesk();
}

export function setStorage(mode: 'local' | 'session') {
  mutate((v) => {
    v.storage = mode;
    v.storageFailed = false;
    v.expiresAt = mode === 'local' ? Date.now() + RETENTION_DAYS * 86400000 : undefined;
  });
}

export function addTrace(trace: Trace) {
  mutate((v) => {
    v.traces = [trace, ...v.traces].slice(0, MAX_TRACES);
  });
}

/** 출처에서 계획을 다시 계산한다. 늦게 끝난 이전 실행은 최신 결과를 덮지 않는다. */
export async function runAnalysis() {
  const visit = state.visit;
  if (!visit) return;
  const seq = ++runSeq;
  mutate((v) => {
    v.analysis = 'running';
  });
  try {
    const { plan, trace } = await agent.plan({
      sources: visit.sources,
      issueStates: visit.issueStates,
      booking: visit.booking,
      year: planYear(visit),
    });
    if (seq !== runSeq) return;
    mutate((v) => {
      v.plan = { ...plan, version: (v.plan?.version ?? 0) + 1 };
      v.analysis = 'idle';
      v.traces = [trace, ...v.traces].slice(0, MAX_TRACES);
    });
  } catch {
    if (seq !== runSeq) return;
    mutate((v) => {
      v.analysis = 'failed';
    });
  }
}

const LABELS: Record<SourceType, string> = {
  transcript: '자동 자막',
  written: '글로 나눈 대화',
  handout: '안내문',
  patient_note: '내 메모',
  reported_reply: '내가 적은 병원 답변',
  patient_fix: '내가 직접 고친 값',
  hospital_reply: '접수 창구 답변',
};

function pushSource(visit: Visit, type: SourceType, text: string, extra: Partial<Source> = {}): Source {
  const numbered = type === 'handout' || type === 'patient_note';
  const count = visit.sources.filter((s) => s.type === type).length + 1;
  const source: Source = {
    id: uid('src'),
    type,
    label: numbered ? `${LABELS[type]} ${count}` : LABELS[type],
    text: text.trim(),
    createdAt: Date.now(),
    ...extra,
  };
  visit.sources.push(source);
  return source;
}

export function addSource(type: SourceType, text: string, issueId?: string): string {
  let id = '';
  mutate((v) => {
    id = pushSource(v, type, text, { issueId }).id;
    if (v.stage !== 'aftercare' && type !== 'reported_reply') v.stage = 'aftercare';
  });
  if (type === 'handout') void runAnalysis();
  return id;
}

export function removeSource(id: string) {
  mutate((v) => {
    v.sources = v.sources.filter((s) => s.id !== id);
    // 근거가 사라진 해결 기록은 함께 무효화한다
    for (const [issueId, saved] of Object.entries(v.issueStates)) {
      if (saved.sourceId === id) delete v.issueStates[issueId];
    }
  });
  void runAnalysis();
}

/** 진료를 마치고 확정된 자막·필담을 출처로 옮긴다. */
export function finishConsult() {
  mutate((v) => {
    v.sources = v.sources.filter((s) => s.type !== 'transcript' && s.type !== 'written');
    const captions = v.segments.filter((s) => s.status === 'final' && s.origin === 'caption');
    const typed = v.segments.filter((s) => s.status === 'final' && s.origin === 'typed');
    const gaps = v.segments.filter((s) => s.status === 'gap').length;
    if (captions.length) pushSource(v, 'transcript', captions.map((s) => s.text).join('\n'), { gaps });
    if (typed.length) pushSource(v, 'written', typed.map((s) => s.text).join('\n'));
    v.stage = 'aftercare';
  });
  void runAnalysis();
}

export function applyPatch(patch: Patch) {
  mutate((v) => {
    const issue = v.plan?.issues.find((i) => i.id === patch.issueId);
    if (!issue) return;
    v.issueStates[issue.id] = {
      state: 'resolved',
      value: patch.after,
      sourceId: patch.evidence.sourceId,
      fingerprint: issue.fingerprint,
    };
  });
  return runAnalysis();
}

/** 자막이 놓친 값을 사용자가 직접 정한다. 병원이 확인한 값이 아니므로 출처를 따로 남긴다. */
/** 자막이 놓친 날짜·시간을 사용자가 직접 고른다. 병원 답이 아니라 내가 고친 값으로 남긴다. */
export function fixIssueValue(issueId: string, fixed: When) {
  mutate((v) => {
    const issue = v.plan?.issues.find((i) => i.id === issueId);
    if (!issue || issue.state === 'resolved') return;
    const source = pushSource(v, 'patient_fix', formatWhen(fixed), { issueId });
    v.issueStates[issue.id] = {
      state: 'resolved',
      value: packWhen({ ...issue.answered, ...fixed }),
      sourceId: source.id,
      fingerprint: issue.fingerprint,
    };
  });
  return runAnalysis();
}

export function deferIssue(issueId: string) {
  mutate((v) => {
    const issue = v.plan?.issues.find((i) => i.id === issueId);
    if (!issue || issue.state === 'resolved') return;
    // 이미 받은 답은 지우지 않고 보류만 표시한다
    v.issueStates[issueId] = { ...v.issueStates[issueId], state: 'deferred', fingerprint: issue.fingerprint };
    issue.state = 'deferred';
  });
}

/* ── 접수 창구 연결 ─────────────────────────────────────────
   같은 코드를 연 접수 창구 화면과 질문·답변을 주고받는다.
   보낸 것과 답을 받은 것은 서로 다른 상태로 남긴다 (BR-07). */

let deskStream: EventSource | null = null;
let deskStreamCode = '';

function connectDesk() {
  const code = state.visit?.deskCode ?? '';
  if (code === deskStreamCode) return;
  deskStream?.close();
  deskStream = null;
  deskStreamCode = code;
  if (!code || typeof EventSource === 'undefined') return;
  deskStream = new EventSource(`/api/desk/${code}/events`);
  deskStream.onmessage = (event) => {
    const data = JSON.parse(event.data) as { messages?: DeskMessage[]; message?: DeskMessage };
    const incoming = data.messages ?? (data.message ? [data.message] : []);
    incoming.filter((m) => m.from === 'desk').forEach(receiveFromDesk);
  };
}
connectDesk();

async function postToDesk(message: Omit<DeskMessage, 'at'>, requests: string[]) {
  const code = state.visit?.deskCode;
  const response = await fetch(`/api/desk/${code}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...message, requests }),
  });
  if (!response.ok) throw new Error('desk send failed');
}

export function sendToHospital(kind: PendingReply['kind'], text: string, issueId?: string) {
  const visit = state.visit;
  // 같은 요청을 다시 눌러도 중복으로 보내지 않는다
  if (!visit || visit.pending.some((p) => p.kind === kind && p.issueId === issueId)) return;
  const id = uid('req');
  // 직원이 타이핑 없이 한 번에 답할 수 있게, 기록에 있던 후보 값을 함께 보낸다
  const issue = visit.plan?.issues.find((i) => i.id === issueId);
  const answer = issue && issue.field !== 'frequency' ? issue.field : undefined;
  const options = issue?.sides.length ? [...new Set(issue.sides.map((s) => s.value))] : undefined;
  mutate((v) => {
    v.thread.push({ id, from: 'me', text, at: Date.now() });
    v.pending.push({ id, kind, issueId });
    if (kind === 'book_offer') v.booking.state = 'asked';
    if (kind === 'book_confirm') v.booking.state = 'requested';
  });
  postToDesk({ id, from: 'patient', kind, text, issueId, options, answer }, visit.requests).catch(() => {
    // 보내지 못했으면 보낸 것처럼 남기지 않는다
    mutate((v) => {
      v.pending = v.pending.filter((p) => p.id !== id);
      const msg = v.thread.find((m) => m.id === id);
      if (msg) msg.failed = true;
      if (kind === 'book_offer') v.booking.state = 'none';
      if (kind === 'book_confirm') v.booking.state = 'offered';
    });
  });
}

function receiveFromDesk(message: DeskMessage) {
  const visit = state.visit;
  if (!visit || visit.deskSeen.includes(message.id)) return;
  let replan = false;
  mutate((v) => {
    v.deskSeen.push(message.id);
    v.thread.push({ id: message.id, from: 'hospital', text: message.text, at: message.at });
    const request = v.pending.find((p) => p.id === message.replyTo);
    if (!request) return;
    v.pending = v.pending.filter((p) => p.id !== request.id);

    if (request.kind === 'confirm_time') {
      pushSource(v, 'hospital_reply', message.text, { issueId: request.issueId });
    } else if (request.kind === 'book_offer') {
      // 답변에 날짜와 시간이 모두 있어야 제안으로 본다. 없으면 추측하지 않는다.
      const date = parseDate(message.text, planYear(v));
      const time = parseTime(message.text)?.time;
      if (date && time) {
        v.booking.offer = { date, time };
        v.booking.state = 'offered';
      } else {
        v.booking.state = 'none';
      }
    } else if (request.kind === 'book_confirm') {
      if (message.accepted) {
        v.booking.sourceId = pushSource(v, 'hospital_reply', message.text).id;
        v.booking.state = 'confirmed';
        replan = true;
      } else {
        v.booking.state = 'none';
      }
    }
  });
  if (replan) void runAnalysis();
}

export function recordExecution(
  kind: 'calendar' | 'reminder',
  actionId: string,
  payloadKey: string,
  via: 'google' | 'file' | 'share' = 'file',
  link?: string,
  eventIds?: string[],
) {
  mutate((v) => {
    v.executions = v.executions.filter((e) => !(e.kind === kind && e.actionId === actionId));
    v.executions.push({ id: uid('exec'), kind, actionId, payloadKey, at: Date.now(), via, link, eventIds });
  });
}

export { uid, planYear };
