// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Concierge from './Concierge'
import {
  initialState,
  type ConciergeState,
  type Hospital,
  type InquiryInput,
} from '../../../server/concierge/types'

const api = vi.hoisted(() => ({ open: vi.fn(), read: vi.fn(), action: vi.fn() }))
vi.mock('../concierge/api', () => ({
  openConcierge: api.open,
  conciergeState: api.read,
  conciergeAction: api.action,
  forgetConcierge: vi.fn(),
  resetConciergeConnection: vi.fn(),
  ApiError: class extends Error {},
}))
vi.mock('../store/visit', () => ({ useVisit: () => null, mutate: vi.fn(), startVisit: vi.fn() }))
vi.mock('thinking-orbs', () => ({ ThinkingOrb: () => <span data-testid="orb" /> }))

const hospital: Hospital = {
  id: 'test-hospital',
  name: '검증용 내과',
  department: '내과',
  address: '서울 종로구',
  phone: '0212345678',
  smsPhone: '',
  smsSourceUrl: '',
  sourceUrl: 'https://example.org/',
  reason: '지역과 진료과를 확인했어요.',
  questions: ['진료 시간을 확인해 주세요.'],
  checkedAt: 0,
}
let state: ConciergeState
function found(): ConciergeState {
  return {
    ...initialState(),
    hospitals: [hospital],
    search: {
      id: 'search',
      query: '종로구 내과',
      status: 'done',
      startedAt: 0,
      message: '',
      clarification: '',
    },
  }
}
function mount(route = '/concierge') {
  render(
    <MemoryRouter
      initialEntries={[route]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Concierge />
    </MemoryRouter>,
  )
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
async function heading(name: string) {
  return screen.findByRole('heading', { name, level: 1 })
}
beforeEach(() => {
  vi.clearAllMocks()
  window.scrollTo = vi.fn()
  state = initialState()
  api.open.mockImplementation(async () => ({ state, memoryAvailable: false }))
  api.read.mockImplementation(async () => state)
  api.action.mockImplementation(
    async (
      path: string,
      _version: number,
      data: {
        input: InquiryInput
        text: string
      },
    ) => {
      if (path === '/draft')
        state = {
          ...state,
          inquiry: {
            id: 'inquiry',
            hospital,
            channel: data.input.channel,
            text: `희망 일정: ${data.input.preferredTime}`,
            phone: hospital.phone,
            contactSource: 'public_source',
            status: 'draft',
            createdAt: Date.now(),
          },
        }
      if (path === '/approve') state = { ...state, inquiry: { ...state.inquiry!, status: 'ready' } }
      if (path === '/contacted')
        state = { ...state, inquiry: { ...state.inquiry!, status: 'awaiting_reply' } }
      if (path === '/reply')
        state = {
          ...state,
          inquiry: { ...state.inquiry!, status: 'reply_recorded', reply: data.text },
        }
      if (path === '/cancel')
        state = { ...state, inquiry: { ...state.inquiry!, status: 'cancelled' } }
      return state
    },
  )
})
afterEach(cleanup)

describe('컨시어지 단계별 화면', () => {
  it('실제 검색이 끝나면 입력과 Orbs를 제거하고 병원 목록만 보여준다', async () => {
    let complete!: (next: ConciergeState) => void
    api.action.mockImplementationOnce(
      () =>
        new Promise<ConciergeState>((resolve) => {
          complete = resolve
        }),
    )
    mount()
    await heading('어떤 도움이 필요해요?')
    fireEvent.change(screen.getByLabelText('증상이나 찾는 병원'), {
      target: { value: '종로구 내과' },
    })
    click('병원 찾아보기')
    await heading('맞는 병원을 찾고 있어요')
    expect(screen.queryByLabelText('증상이나 찾는 병원')).toBeNull()
    expect(screen.getByTestId('orb')).toBeTruthy()
    await act(async () => {
      state = found()
      complete(state)
    })
    const title = await heading('어느 병원을 알아볼까요?')
    expect(document.activeElement).toBe(title)
    expect(screen.queryByTestId('orb')).toBeNull()
    expect(screen.queryByText(hospital.reason)).toBeNull()
    click('내과 검증용 내과 서울 종로구')
    await heading(hospital.name)
    expect(screen.queryByRole('button', { name: '내과 검증용 내과 서울 종로구' })).toBeNull()
    expect(screen.queryByLabelText('희망 날짜와 시간')).toBeNull()
    click('뒤로')
    await heading('어느 병원을 알아볼까요?')
    click('검색 조건 바꾸기')
    await heading('어떤 도움이 필요해요?')
    expect((screen.getByLabelText('증상이나 찾는 병원') as HTMLTextAreaElement).value).toBe(
      '종로구 내과',
    )
  })

  it('문의문 확인 → 연락 → 답변 입력 → 확정 여부를 각각 한 화면에서 처리한다', async () => {
    state = found()
    mount()
    await heading('어느 병원을 알아볼까요?')
    click('내과 검증용 내과 서울 종로구')
    click('이 병원에 문의하기')
    await heading('어떻게 문의할까요?')
    expect(screen.queryByLabelText('희망 날짜와 시간')).toBeNull()
    click('문의할 일정 정하기')
    fireEvent.change(screen.getByLabelText('희망 날짜와 시간'), {
      target: { value: '다음 주 화요일' },
    })
    click('문의문 만들기')
    await heading('이 내용으로 문의할까요?')
    expect(screen.queryByLabelText('희망 날짜와 시간')).toBeNull()
    expect(screen.queryByRole('link', { name: '전화 앱 열기' })).toBeNull()
    click('확인했어요 · 연락하기')
    await heading('병원에 직접 문의해요')
    expect(screen.getByRole('link', { name: '전화 앱 열기' }).getAttribute('href')).toBe(
      'tel:0212345678',
    )
    expect(screen.queryByLabelText('내가 받은 병원 답변')).toBeNull()
    click('이미 문의를 마쳤어요')
    await heading('병원 답변을 기다려요')
    expect(screen.queryByRole('textbox')).toBeNull()
    click('받은 답변 적기')
    fireEvent.change(screen.getByLabelText('내가 받은 병원 답변'), {
      target: { value: '담당자가 다시 연락한다고 했어요.' },
    })
    click('답변 확인하기')
    await heading('예약을 확정했나요?')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByLabelText('확정 날짜')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /아직 확인 중이에요/ }))
    click('답변만 보관하기')
    await heading('받은 답변을 보관했어요')
    expect(api.action).toHaveBeenLastCalledWith('/reply', expect.any(Number), {
      id: 'inquiry',
      text: '담당자가 다시 연락한다고 했어요.',
      confirmedByUser: true,
    })
    expect(screen.queryByLabelText('확정 날짜')).toBeNull()
  })

  it('연락 전 답변 화면 주소로 진입해도 승인한 연락 단계에서 이어간다', async () => {
    state = {
      ...found(),
      inquiry: {
        id: 'inquiry',
        hospital,
        channel: 'phone',
        text: '문의 내용',
        phone: hospital.phone,
        contactSource: 'public_source',
        createdAt: 0,
        status: 'ready',
      },
    }
    mount('/concierge?step=reply')
    await heading('병원에 직접 문의해요')
    expect(screen.queryByRole('textbox')).toBeNull()
    click('문의 설정')
    click('현재 문의 닫기')
    await heading('현재 문의를 닫을까요?')
    click('문의 닫고 다시 찾기')
    await heading('어떤 도움이 필요해요?')
    expect(state.inquiry?.status).toBe('cancelled')
  })

  it('검색 상태 조회 실패 시 애니메이션을 멈추고 재시도로 결과를 복구한다', async () => {
    state = { ...found(), hospitals: [], search: { ...found().search!, status: 'running' } }
    api.read.mockResolvedValueOnce(state).mockRejectedValueOnce(new Error('연결 오류'))
    mount()
    await heading('맞는 병원을 찾고 있어요')
    await waitFor(
      () => expect(screen.getByRole('heading', { name: '연결을 다시 확인해요' })).toBeTruthy(),
      { timeout: 2500 },
    )
    expect(screen.queryByTestId('orb')).toBeNull()
    state = found()
    click('진행 상황 다시 확인하기')
    await heading('어느 병원을 알아볼까요?')
    expect(screen.queryByText('연결 오류')).toBeNull()
  })
})
