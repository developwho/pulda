export interface When {
  /** YYYY-MM-DD */
  date?: string;
  /** HH:MM (24시간) */
  time?: string;
}

export type Stage = 'preparing' | 'consulting' | 'aftercare';

export type SourceType =
  | 'transcript' // 자동 자막
  | 'written' // 글로 나눈 대화
  | 'handout' // 받은 안내문
  | 'patient_note' // 내 메모
  | 'reported_reply' // 내가 옮겨 적은 병원 답변
  | 'patient_fix' // 자막이 놓친 값을 내가 직접 고른 것
  | 'hospital_reply'; // 모의 병원 채널로 받은 답변

export interface Source {
  id: string;
  type: SourceType;
  label: string;
  text: string;
  createdAt: number;
  issueId?: string;
  /** 자막이 끊긴 구간 수 */
  gaps?: number;
}

export interface Segment {
  id: string;
  text: string;
  status: 'final' | 'gap';
  origin: 'caption' | 'typed';
  at: number;
}

export interface Evidence {
  sourceId: string;
  quote: string;
}

export type ActionKind = 'revisit' | 'medication' | 'avoid' | 'test';

export interface PlanAction {
  id: string;
  kind: ActionKind;
  title: string;
  when?: When;
  conditions: string[];
  evidence: Evidence[];
  /** ready: 근거가 있고 명확 / needs_provider: 병원에 확인 필요 */
  status: 'ready' | 'needs_provider';
  /** 정보가 빠졌을 때 무엇이 빠졌는지 */
  missing?: string;
  issueIds: string[];
  /** 복약 정보 (알림을 만들 때 원문 값만 사용) */
  med?: { perDay?: number; days?: number };
}

export interface InfoItem {
  id: string;
  text: string;
  /** 확실성을 높이지 않기 위한 표시 */
  /** suspected·considering은 확실성을 높이지 않기 위한 표시, contact는 연락 안내 */
  certainty: 'suspected' | 'considering' | 'contact';
  evidence: Evidence[];
  /** 예약을 문의할 수 있는 검사 이름 */
  bookable?: string;
}

export interface IssueSide {
  sourceId: string;
  quote: string;
  value: string;
}

export interface Issue {
  id: string;
  kind: 'difference' | 'missing';
  /** 지금 확인이 필요한 것. when은 날짜와 시간 둘 다 */
  field: 'time' | 'date' | 'when' | 'frequency';
  /** 다음 진료 일정에서 아직 모르는 부분 */
  needs?: ('date' | 'time')[];
  /** 답으로 이미 채워진 부분 */
  answered?: When;
  /** 약·검사 준비처럼 의료진만 답할 수 있는 내용 */
  clinical: boolean;
  title: string;
  summary: string;
  sides: IssueSide[];
  question: string;
  affects: string[];
  state: 'open' | 'deferred' | 'resolved';
  resolution?: { sourceId: string; value: string; label: string };
  /** 비교한 값이 바뀌면 이전 해결을 무효화하기 위한 지문 */
  fingerprint: string;
}

export interface IssueState {
  state: 'deferred' | 'resolved';
  value?: string;
  sourceId?: string;
  fingerprint: string;
}

export interface Plan {
  version: number;
  actions: PlanAction[];
  infos: InfoItem[];
  issues: Issue[];
  basedOn: string[];
  /** AI를 향한 지시처럼 보이는 글이 있어 주의가 필요한 출처 */
  flaggedSourceIds?: string[];
}

export interface TraceStep {
  name: string;
  ms: number;
  detail: string;
}

/** 한 번의 AI 실행 기록. 의료 원문은 담지 않고 단계·건수·판정만 남긴다 (FR-012). */
export interface Trace {
  id: string;
  at: number;
  task: 'plan' | 'refine' | 'read_image';
  model: string;
  /** model: 모델 + 검증기 / rules: 연결 실패로 규칙만 사용 */
  mode: 'model' | 'rules';
  steps: TraceStep[];
  blocked: { what: string; reason: string }[];
  gates: { name: string; probability: number; passed: boolean }[];
  tokens: number;
  note?: string;
}

export interface DeskMessage {
  id: string;
  from: 'patient' | 'desk';
  kind: 'confirm_time' | 'book_offer' | 'book_confirm' | 'reply';
  text: string;
  at: number;
  issueId?: string;
  /** 접수 창구가 답한 요청의 id */
  replyTo?: string;
  /** 예약 요청을 접수했다는 표시 */
  accepted?: boolean;
  /** 직원이 한 번 눌러 답할 수 있는 후보 값. 예: ["오후 2시", "오후 3시"] */
  options?: string[];
  /** 답으로 받고 싶은 값의 종류. 접수 창구가 알맞은 입력칸을 보여준다 */
  answer?: 'time' | 'date' | 'when';
}

export interface Patch {
  issueId: string;
  actionId: string;
  field: Issue['field'];
  before: string[];
  after: string;
  afterLabel: string;
  evidence: Evidence;
}

export interface Note {
  id: string;
  raw: string;
  text: string;
  chosen: 'raw' | 'refined' | 'edited';
}

export interface ThreadMsg {
  id: string;
  from: 'me' | 'hospital';
  text: string;
  at: number;
  /** 접수 창구로 보내지 못함 */
  failed?: boolean;
}

export interface PendingReply {
  /** 접수 창구로 보낸 요청의 id */
  id: string;
  kind: 'confirm_time' | 'book_offer' | 'book_confirm';
  issueId?: string;
}

export interface Booking {
  state: 'none' | 'asked' | 'offered' | 'requested' | 'confirmed';
  subject?: string;
  offer?: When;
  sourceId?: string;
}

export interface Execution {
  id: string;
  kind: 'calendar' | 'reminder';
  actionId: string;
  /** 내보낸 내용의 지문. 계획이 바뀌면 다시 만들어야 함을 알린다 */
  payloadKey: string;
  at: number;
  /** google: 캘린더에 넣고 다시 읽어 확인함 / file: 일정 파일을 만듦 (넣었는지는 모름) */
  via: 'google' | 'file' | 'share';
  /** 캘린더에서 여는 주소 (google일 때) */
  link?: string;
  eventIds?: string[];
}

export interface Appointment {
  hospital: string;
  dept: string;
  date: string;
  time: string;
}

export interface Preparation {
  step: 'reason' | 'appointment' | 'hospital' | 'schedule' | 'requests' | 'summary';
  complete: boolean;
  editing: boolean;
  reason: string;
  noteId?: string;
  appointmentChoice?: 'yes' | 'no';
  appointmentDraft: Appointment;
  requestsDraft: string[];
}

export interface Visit {
  id: string;
  createdAt: number;
  demo: boolean;
  stage: Stage;
  appointment: Appointment;
  requests: string[];
  notes: Note[];
  preparation?: Preparation;
  segments: Segment[];
  sources: Source[];
  issueStates: Record<string, IssueState>;
  plan: Plan | null;
  analysis: 'idle' | 'running' | 'failed';
  done: Record<string, boolean>;
  storage: 'unset' | 'local' | 'session';
  storageFailed?: boolean;
  expiresAt?: number;
  executions: Execution[];
  reminderTimes: string[];
  calendarChoices?: Record<string, { selected: boolean; date: string; times: string[]; alarm: number }>;
  calendarEventIds?: Record<string, string[]>;
  thread: ThreadMsg[];
  pending: PendingReply[];
  booking: Booking;
  /** 접수 창구 화면과 연결하는 짧은 코드 */
  deskCode: string;
  /** 이미 반영한 접수 창구 메시지 */
  deskSeen: string[];
  traces: Trace[];
}
