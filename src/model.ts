export type Phase = 'prepare' | 'consult' | 'review'
export type SourceKind = 'transcript' | 'patient_note' | 'handout' | 'reported_reply'
export type Source = {
  id: string
  kind: SourceKind
  text: string
  example: boolean
  incomplete?: boolean
}
export type Approval = {
  sourceId: string
  kind: 'question' | 'schedule' | 'reminder'
  text: string
}
export type Visit = {
  hospital: string
  date: string
  time: string
  note: string
  prepared: string
  requests: string[]
  sources: Source[]
  approvals: Approval[]
  completed: string[]
  consultationCompleted: boolean
  captureInterrupted: boolean
}
export const newVisit = (): Visit => ({
  hospital: '',
  date: '',
  time: '',
  note: '',
  prepared: '',
  requests: [],
  sources: [],
  approvals: [],
  completed: [],
  consultationCompleted: false,
  captureInterrupted: false,
})
export const requestOptions = [
  { title: '글로 적어 주세요', description: '말한 내용을 글로 보여 주세요.' },
  { title: '천천히 설명해 주세요', description: '이해할 시간을 조금 더 주세요.' },
  { title: '한국수어 통역이 필요해요', description: '통역을 받을 수 있는지 확인해 주세요.' },
]
export const sourceLabels: Record<SourceKind, string> = {
  transcript: '진료 대화',
  patient_note: '내가 쓴 메모',
  handout: '안내문',
  reported_reply: '내가 입력한 병원 답변',
}
export const demoTranscript: Source[] = [
  { id: 'demo-1', kind: 'transcript', text: '다음 진료는 10월 16일 오후 2시예요.', example: true },
  {
    id: 'demo-2',
    kind: 'transcript',
    text: '시간은 접수처에서 한 번 더 확인해 주세요.',
    example: true,
  },
]
export const demoHandout: Source = {
  id: 'demo-handout',
  kind: 'handout',
  text: '예약 안내: 10월 16일 오후 3시, 풀다 예시 의원.',
  example: true,
}
// A separate, authored conversation drives the voice mock; patient input is never substituted.
export const mockConsultation: Source[] = [
  {
    id: 'voice-greeting',
    kind: 'transcript',
    text: '안녕하세요. 오늘 어떤 점이 불편해서 오셨어요?',
    example: true,
  },
  {
    id: 'voice-question',
    kind: 'transcript',
    text: '언제부터 불편했는지 알려 주세요. 글로 적어 주셔도 괜찮아요.',
    example: true,
  },
  {
    id: 'voice-check',
    kind: 'transcript',
    text: '말씀하신 내용을 확인할게요. 설명을 읽을 시간이 필요하면 알려 주세요.',
    example: true,
  },
  ...demoTranscript,
  {
    id: 'voice-closing',
    kind: 'transcript',
    text: '오늘 설명은 여기까지예요. 안내문을 받아 가세요. 더 궁금한 점이 있나요?',
    example: true,
  },
]
// Default preparation preserves the original. AI suggestions require a separate opt-in.
export function arrangeNote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}
export function addSource(visit: Visit, source: Source): Visit {
  if (visit.sources.some((item) => item.id === source.id)) return visit
  // New evidence invalidates all prior action approvals, even if unrelated.
  return { ...visit, sources: [...visit.sources, source], approvals: [], completed: [] }
}
export function approve(visit: Visit, approval: Approval): Visit {
  if (!visit.sources.some((source) => source.id === approval.sourceId)) return visit
  return {
    ...visit,
    approvals: [
      ...visit.approvals.filter(
        (item) =>
          item.kind !== approval.kind &&
          !(approval.kind === 'schedule' && item.kind === 'reminder'),
      ),
      approval,
    ],
  }
}
export function hasDemoConflict(sources: Source[]): boolean {
  return sources.some((s) => s.id === 'demo-1') && sources.some((s) => s.id === 'demo-handout')
}
export function sourceId() {
  return crypto.randomUUID()
}
