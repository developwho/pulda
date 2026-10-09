import { z } from 'zod'

export const PreferencesSchema = z
  .object({
    contact: z.enum(['text', 'phone']),
    communication: z.enum(['written', 'none']),
  })
  .strict()
export type Preferences = z.infer<typeof PreferencesSchema>
export const HospitalSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().max(240),
  department: z.string().max(80),
  phone: z
    .string()
    .max(40)
    .describe(
      'One public appointment or main phone number; digits and hyphens only, no labels, extension, or multiple numbers. Empty if unknown.',
    ),
  sourceUrl: z.string().max(1000),
  reason: z.string().max(300),
  // An ordinary hospital landline must not be presented as an SMS inbox.
  smsPhone: z.string().max(40),
  smsSourceUrl: z.string().max(1000),
  questions: z.array(z.string().max(120)).max(4),
})
export const SearchResultSchema = z.object({
  message: z.string().max(900),
  clarification: z.string().max(300),
  hospitals: z.array(HospitalSchema).max(4),
})
export type Hospital = z.infer<typeof HospitalSchema> & { id: string; checkedAt: number }
export const InquiryInputSchema = z
  .object({
    hospitalId: z.string().max(64),
    channel: z.enum(['text', 'phone']),
    preferredTime: z.string().trim().min(1).max(120),
    department: z.string().trim().max(80),
    name: z.string().trim().max(40),
    note: z.string().trim().max(300),
    smsNumber: z.string().max(40).optional(),
    smsConfirmedByUser: z.literal(true).optional(),
  })
  .strict()
export type InquiryInput = z.infer<typeof InquiryInputSchema>
export interface Inquiry {
  id: string
  hospital: Hospital
  channel: 'text' | 'phone'
  text: string
  phone: string
  contactSource: 'public_source' | 'user_provided'
  status: 'draft' | 'ready' | 'awaiting_reply' | 'reply_recorded' | 'cancelled'
  createdAt: number
  approvedAt?: number
  reply?: string
  appointment?: { date: string; time: string; department: string }
}
export interface ConciergeState {
  version: number
  expiresAt: number
  preferences: Preferences
  memory: 'session' | 'agentcore'
  search?: {
    id: string
    query: string
    clarificationContext?: string
    status: 'queued' | 'running' | 'done' | 'failed'
    startedAt: number
    message: string
    clarification: string
  }
  hospitals: Hospital[]
  inquiry?: Inquiry
}
export const initialState = (): ConciergeState => ({
  version: 0,
  expiresAt: Date.now() + 3_600_000,
  preferences: { contact: 'text', communication: 'written' },
  memory: 'session',
  hospitals: [],
})
export class ConciergeError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code)
  }
}

export function publicUrl(value: string): string {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) ||
      /(^|\.)(localhost|local|internal)$/i.test(url.hostname) ||
      url.port
    )
      return ''
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}
export function koreanPhone(value: string): string {
  const clean = value.replace(/[\s().-]/g, '').replace(/^\+82/, '0')
  return /^(?:02\d{7,8}|0[3-6][1-5]\d{7,8}|010\d{8}|070\d{8}|1[568]\d{6})$/.test(clean) ? clean : ''
}
export function inquiryText(input: InquiryInput, preferences: Preferences) {
  return [
    `안녕하세요. ${input.name ? `${input.name}입니다. ` : ''}진료 예약을 문의드립니다.`,
    input.department ? `희망 진료과: ${input.department}` : '',
    `희망 일정: ${input.preferredTime}`,
    preferences.communication === 'written' ? '안내와 답변을 글로 부탁드립니다.' : '',
    input.note,
    '예약 가능한 날짜·시간과 접수 방법을 알려주세요. 가능한 일정을 확인한 뒤 예약하겠습니다.',
  ]
    .filter(Boolean)
    .join('\n')
}
