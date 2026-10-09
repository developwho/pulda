import { buildPlan } from '../experience/agent/plan';
import type { PlanInput } from '../experience/agent/plan';
import { refineNote } from '../experience/agent/refine';
import { localExplanation, EXPLANATION_UNAVAILABLE } from '../../server/experience/explain';
import type { DeskMessage, Trace } from '../experience/lib/types';
import type { ConciergeState, Hospital, InquiryInput } from '../../server/concierge/types';
import { MOCK_CASE, dateText, NEXT_DATE } from './fixtures';

const CONCIERGE_KEY = 'pulda.mock.concierge';
const DESK_KEY = 'pulda.mock.desk';
const initial = (): ConciergeState => ({ version: 0, expiresAt: Date.now() + 3600000, preferences: { contact: 'text', communication: 'written' }, memory: 'session', hospitals: [] });
const read = (key: string) => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; } };
const save = (key: string, value: unknown) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* In-memory mode remains functional. */ } };
const hospital: Hospital = {
  id: 'mock-hospital', name: MOCK_CASE.appointment.hospital, address: '가상시 한빛로 12 · 시연용 주소',
  department: MOCK_CASE.appointment.dept, phone: '000-0000-0000', smsPhone: '000-0000-0000',
  sourceUrl: '#mock-hospital', smsSourceUrl: '#mock-hospital',
  reason: '글로 문의하고 진료 안내문을 받을 수 있는 가상 병원이에요.',
  questions: ['글로 안내해 주실 수 있나요?', '처음 방문할 때 준비할 것이 있나요?'], checkedAt: Date.now(),
};
const trace = (task: Trace['task']): Trace => ({ id: `mock-${task}-${Date.now()}`, at: Date.now(), task,
  mode: 'rules', model: '목업 응답 · 외부 AI 호출 없음', steps: [], blocked: [], gates: [], tokens: 0, note: '발표용 합성 데이터로 기존 처리 흐름을 실행했어요.' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/** Installs only in mock.html, before importing the live UI. Unknown calls fail closed. */
export function installMockTransport() {
  let state: ConciergeState = read(CONCIERGE_KEY) ?? initial();
  if (!Array.isArray(state.hospitals) || !state.preferences) state = initial();
  const savedDesk = read(DESK_KEY);
  const mailboxes: Record<string, DeskMessage[]> = savedDesk && typeof savedDesk === 'object' && !Array.isArray(savedDesk) ? savedDesk : {};
  const streams = new Set<MockEvents>();
  function publish(code: string, message: DeskMessage) {
    const box = mailboxes[code] ??= [];
    if (box.some(m => m.id === message.id)) return;
    box.push(message); save(DESK_KEY, mailboxes);
    streams.forEach(stream => { if (stream.code === code) stream.deliver({ message }); });
  }
  class MockEvents extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    CONNECTING = 0; OPEN = 1; CLOSED = 2; readyState = 0; withCredentials = false;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    code: string; url: string;
    constructor(url: string | URL) {
      super(); this.url = String(url); this.code = this.url.match(/\/desk\/([^/]+)\/events/)?.[1] ?? '';
      streams.add(this);
      queueMicrotask(() => {
        if (this.readyState === 2) return;
        this.readyState = 1; const open = new Event('open'); this.onopen?.(open); this.dispatchEvent(open);
        this.deliver({ messages: mailboxes[this.code] ?? [] });
      });
    }
    deliver(data: unknown) { if (this.readyState === 2) return; const event = new MessageEvent('message', { data: JSON.stringify(data) }); this.onmessage?.(event); this.dispatchEvent(event); }
    close() { this.readyState = 2; streams.delete(this); }
  }
  window.EventSource = MockEvents as unknown as typeof EventSource;
  window.fetch = async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
    const raw = init?.body ?? (input instanceof Request ? await input.text() : '{}');
    const body = typeof raw === 'string' && raw ? JSON.parse(raw) : {};
    if (path === '/api/health') return json({ ok: true, locked: false });
    if (path === '/api/access') return json({ ok: true });
    if (path === '/api/refine') return json({ result: refineNote(String(body.raw ?? '')), trace: trace('refine') });
    if (path === '/api/explain') return json(localExplanation({ text: String(body.text ?? ''), selected: body.selected }) ?? EXPLANATION_UNAVAILABLE);
    if (path === '/api/plan') return json({ plan: buildPlan(body as PlanInput), trace: trace('plan') });
    if (path === '/api/read-image') return json({ result: { ok: true, text: MOCK_CASE.handout, unreadable: [] }, trace: trace('read_image') });
    if (path.startsWith('/api/concierge/')) {
      const action = path.slice('/api/concierge'.length);
      if (action === '/session') return json({ state, csrf: 'mock-only', memoryAvailable: false });
      if (action === '/state') return json(state);
      if (action === '/forget') { state = initial(); save(CONCIERGE_KEY, state); return json({ ok: true }); }
      if (action === '/search') { state.hospitals = [hospital]; state.inquiry = undefined; state.search = { id: 'mock-search', query: body.query, status: 'done', startedAt: Date.now(), message: '글로 소통할 수 있는 병원을 찾았어요. · 목업 결과', clarification: '' }; }
      else if (action === '/preferences') state.preferences = body.preferences;
      else if (action === '/draft') {
        const i = body.input as InquiryInput;
        state.inquiry = { id: 'mock-inquiry', hospital, channel: i.channel, phone: hospital.phone, contactSource: 'public_source', status: 'draft', createdAt: Date.now(), text: `안녕하세요. ${i.name || MOCK_CASE.name}입니다.\n${i.preferredTime} ${i.department} 예약을 문의해요.\n안내와 답변을 글로 부탁드립니다.\n${i.note}` };
      } else if (state.inquiry && action === '/approve') { state.inquiry.status = 'ready'; state.inquiry.approvedAt = Date.now(); }
      else if (state.inquiry && action === '/contacted') state.inquiry.status = 'awaiting_reply';
      else if (state.inquiry && action === '/reply') {
        state.inquiry.status = 'reply_recorded'; state.inquiry.reply = body.text;
        state.inquiry.appointment = body.appointment;
      } else if (action === '/cancel') state.inquiry = undefined;
      else return json({ code: 'MOCK_UNSUPPORTED' }, 400);
      state = { ...state, version: state.version + 1 }; save(CONCIERGE_KEY, state); return json(state);
    }
    const match = path.match(/^\/api\/desk\/([^/]+)\/messages$/);
    if (match) {
      const code = match[1];
      const request = { ...body, at: Date.now() } as DeskMessage;
      publish(code, request);
      if (request.from === 'patient') {
        const reply: DeskMessage = { id: `mock-answer-${request.id}`, from: 'desk', kind: 'reply', at: Date.now(), replyTo: request.id,
          accepted: request.kind === 'book_confirm',
          text: request.kind === 'confirm_time' ? `다음 진료는 ${dateText(NEXT_DATE)} 오후 3시입니다. 안내문 시간이 맞아요. (가상 답변)`
            : request.kind === 'book_offer' ? `위내시경 검사는 ${dateText(NEXT_DATE)} 오전 9시에 예약할 수 있어요. (가상 답변)`
              : `위내시경 검사 예약을 접수했어요. ${dateText(NEXT_DATE)} 오전 9시입니다. 예약 안내를 받으셨어요. (가상 확인서)` };
        // Persist before the presentation delay; refresh replays the answer instead of stranding a pending request.
        const box = mailboxes[code] ??= [];
        if (!box.some(m => m.id === reply.id)) { box.push(reply); save(DESK_KEY, mailboxes); }
        window.setTimeout(() => streams.forEach(stream => { if (stream.code === code) stream.deliver({ message: reply }); }), 900);
      }
      return json({ ok: true });
    }
    return json({ code: 'MOCK_UNSUPPORTED', message: '목업 모드에서는 외부 요청을 보내지 않아요.' }, 503);
  };
  // The existing service's external-app controls remain visible, but cannot place a real call/message.
  document.addEventListener('click', event => {
    const link = (event.target as Element).closest?.('a');
    if (link && /^(sms:|tel:|https?:|#mock-hospital)/.test(link.getAttribute('href') ?? '')) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('pulda-mock-notice', { detail: '목업 모드: 외부 앱을 열지 않았어요. 기존 화면에서 계속 진행해 주세요.' }));
    }
  }, true);
}
