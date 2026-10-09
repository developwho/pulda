import { getAccessCode } from '../agent'
import type { ConciergeState } from '../../../server/concierge/types'

export type { ConciergeState, Hospital, Inquiry } from '../../../server/concierge/types'
let token = ''
let boot: Promise<{ state: ConciergeState; memoryAvailable: boolean }> | null = null
const messages: Record<string, string> = {
  SESSION_EXPIRED: '병원 찾기 시간이 만료됐어요. 다시 시작해 주세요.',
  STATE_CHANGED: '다른 화면에서 내용이 바뀌었어요. 최신 내용을 불러왔으니 다시 확인해 주세요.',
  RATE_LIMITED: '요청이 많아요. 잠시 뒤 다시 시도해 주세요.',
  SMS_UNAVAILABLE: '문자를 받는 번호가 확인되지 않았어요. 전화 문의를 선택해 주세요.',
  PHONE_UNAVAILABLE: '출처에서 전화번호를 확인하지 못했어요.',
  INQUIRY_ACTIVE: '진행 중인 문의를 마치거나 닫은 뒤 다른 병원을 찾아 주세요.',
  SEARCH_RUNNING: '병원을 찾고 있어요. 잠시 기다려 주세요.',
  APPROVAL_EXPIRED: '문의문을 만든 지 시간이 지났어요. 내용을 다시 준비해 주세요.',
  MEMORY_UNAVAILABLE: '기억 저장에 연결하지 못했어요. 이번 화면의 조건은 계속 사용할 수 있어요.',
  CONCIERGE_UNAVAILABLE: '병원 찾기 서비스를 연결하는 중이에요. 잠시 뒤 다시 시도해 주세요.',
  ACCESS_CODE_REQUIRED: '시작 화면에서 접근 코드를 먼저 확인해 주세요.',
  INVALID_APPOINTMENT: '병원에서 확정한 미래 날짜와 시간을 확인해 주세요.',
  INVALID_INPUT: '입력한 내용과 길이를 확인해 주세요.',
}
export class ApiError extends Error {
  constructor(public code: string) {
    super(messages[code] ?? '처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요.')
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/concierge${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'x-pulda-code': getAccessCode(),
      'x-pulda-csrf': token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await response.json()
  if (!response.ok) throw new ApiError(data.code ?? 'SERVICE_UNAVAILABLE')
  return data
}
export function openConcierge() {
  if (!boot)
    boot = request<{ state: ConciergeState; csrf: string; memoryAvailable: boolean }>(
      '/session',
      {},
    )
      .then((data) => {
        token = data.csrf
        return data
      })
      .catch((e) => {
        boot = null
        throw e
      })
  return boot
}
export const conciergeState = () => request<ConciergeState>('/state')
export const conciergeAction = (path: string, version: number, data: object = {}) =>
  request<ConciergeState>(path, { version, ...data })
export async function forgetConcierge() {
  await request('/forget', {})
  boot = null
  token = ''
}
export function resetConciergeConnection() {
  boot = null
  token = ''
}
