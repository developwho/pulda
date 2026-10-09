// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './api'
vi.mock('./api', () => ({ api: vi.fn(), errorMessage: () => '다시 시도해 주세요.' }))
import 'fake-indexeddb/auto'
vi.mock('./liveVoice', async () => {
  const { createMockVoice } = await import('./mockVoice')
  return {
    createLiveVoice: (callbacks: {
      partial: (source: import('./model').Source | null) => void
      final: (source: import('./model').Source) => void
      listening: () => void
    }) => {
      const mock = createMockVoice({ ...callbacks, known: () => [], complete: () => {} })
      return {
        ...mock,
        start: () => {
          callbacks.listening()
          mock.start()
        },
        dispose: () => mock.pause(),
      }
    },
  }
})

beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({ items: [] })
  window.history.replaceState(null, '', '#prepare')
  window.scrollTo = vi.fn()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function navigate(phase: string) {
  await act(async () => {
    window.history.replaceState(null, '', `#${phase}`)
    window.dispatchEvent(new Event('hashchange'))
  })
}
describe('진료 흐름', () => {
  it('다른 탭에서 삭제하면 이 화면의 기록과 보관도 비운다', async () => {
    let channel: { onmessage?: (event: { data: unknown }) => void } = {}
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage?: (event: { data: unknown }) => void
        constructor() {
          channel = this
        }
        close() {}
        postMessage() {}
      },
    )
    render(<App />)
    fireEvent.change(screen.getByLabelText('현재 내 상태를 적어 주세요.'), {
      target: { value: '다른 탭에서도 지울 말' },
    })
    await act(async () => {
      channel.onmessage?.({ data: { type: 'stop-saving', clearVisit: true } })
    })
    expect(
      (screen.getByLabelText('현재 내 상태를 적어 주세요.') as HTMLTextAreaElement).value,
    ).toBe('')
  })
  it('준비에서 진료 중을 누르면 먼저 안내하고 확인해야 이동하여 자막을 시작한다', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('현재 내 상태를 적어 주세요.'), {
      target: { value: '준비한 말' },
    })
    fireEvent.click(screen.getByRole('link', { name: '진료 중' }))
    expect(screen.getByRole('dialog', { name: '자막을 켤까요?' })).toBeTruthy()
    expect(window.location.hash).toBe('#prepare')
    expect(screen.queryByRole('log')).toBeNull()
    expect(screen.getByText('대화 내용을 실시간 글자로 바꿔요')).toBeTruthy()
    expect(
      screen.getByText('풀다는 음성을 저장하지 않아요. 변환된 텍스트만 검토해요.'),
    ).toBeTruthy()
    expect(
      screen.getByText('시작하기 전에 의료진에게 먼저 알리고 괜찮은지 물어봐주세요.'),
    ).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }))
    expect(window.location.hash).toBe('#prepare')
    expect(
      (screen.getByLabelText('현재 내 상태를 적어 주세요.') as HTMLTextAreaElement).value,
    ).toBe('준비한 말')
    fireEvent.click(screen.getByRole('link', { name: '진료 중' }))
    fireEvent.click(screen.getByRole('button', { name: '확인하고 시작하기' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '실시간 자막' })).toBeTruthy())
    expect(window.location.hash).toBe('#consult')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('듣고 있어요')).toBeTruthy()
  })
  it('준비 시트를 닫아도 예약과 정리 중인 말의 초안이 유지된다', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /이번 진료 예약 정보/ }))
    fireEvent.change(screen.getByPlaceholderText('병원 이름을 적어 주세요'), {
      target: { value: '예시 의원' },
    })
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '닫기' })[0])
    fireEvent.click(screen.getByRole('button', { name: /이번 진료 예약 정보/ }))
    expect((screen.getByPlaceholderText('병원 이름을 적어 주세요') as HTMLInputElement).value).toBe(
      '예시 의원',
    )
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '닫기' })[0])
    fireEvent.change(screen.getByLabelText('현재 내 상태를 적어 주세요.'), {
      target: { value: '열은 없어요.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '내 말 정리하기' }))
    fireEvent.change(screen.getByLabelText('보여줄 말'), {
      target: { value: '열은 없어요. 확실하지 않아요.' },
    })
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '닫기' })[0])
    fireEvent.click(screen.getByRole('button', { name: '내 말 정리하기' }))
    expect((screen.getByLabelText('보여줄 말') as HTMLTextAreaElement).value).toBe(
      '열은 없어요. 확실하지 않아요.',
    )
    expect(window.location.hash).toBe('#prepare')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
  it('준비에서 선택한 말의 원문이 진료 후 출처로 이어진다', async () => {
    render(<App />)
    const original = '어제부터 오른쪽 팔이 아파요. 열은 없어요.'
    fireEvent.change(screen.getByLabelText('현재 내 상태를 적어 주세요.'), {
      target: { value: original },
    })
    fireEvent.click(screen.getByRole('button', { name: '내 말 정리하기' }))
    fireEvent.change(screen.getByLabelText('보여줄 말'), { target: { value: '수정한 전달문' } })
    fireEvent.click(screen.getByRole('button', { name: '이 말 선택하기' }))
    await navigate('review')
    fireEvent.click(screen.getByRole('button', { name: '기록 원문 읽기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('내가 쓴 메모'))
    expect(within(screen.getByRole('dialog')).getByText(original)).toBeTruthy()
  })
  it('기록 삭제는 준비 초안·대화·승인을 함께 초기화한다', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('현재 내 상태를 적어 주세요.'), {
      target: { value: '예시 초안' },
    })
    await navigate('review')
    fireEvent.click(screen.getByRole('button', { name: '안내문·기록 추가' }))
    fireEvent.change(screen.getByLabelText('기록 내용'), { target: { value: '확인할 실제 입력' } })
    fireEvent.click(screen.getByRole('button', { name: '원문 확인하고 추가하기' }))
    fireEvent.click(screen.getByRole('button', { name: '이용 안내' }))
    fireEvent.click(screen.getByRole('button', { name: '이번 진료 기록 지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '기록 지우기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await navigate('prepare')
    expect(
      (screen.getByLabelText('현재 내 상태를 적어 주세요.') as HTMLTextAreaElement).value,
    ).toBe('')
    await navigate('review')
    expect(screen.queryByRole('button', { name: '기록 원문 읽기' })).toBeNull()
  })
  it('첫 진입에 동의창을 띄우지 않고 선택한 요청만 보여준다', () => {
    render(<App />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /글로 적어 주세요/ })).toBeNull()
    expect(screen.getByLabelText('현재 내 상태를 적어 주세요.').getAttribute('placeholder')).toBe(
      '짧게 적어도 돼요.\n예시: 배 아픔 3일 밤 계속 심함',
    )
    fireEvent.click(screen.getByRole('button', { name: /소통 요청/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /글로 적어 주세요/ }))
    fireEvent.click(screen.getByRole('button', { name: '선택 마치기' }))
    fireEvent.click(screen.getByRole('button', { name: '선택한 내용 보여주기' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('글로 적어 주세요')).toBeTruthy()
    expect(within(dialog).queryByText('한국수어 통역이 필요해요')).toBeNull()
  })
  it('안내 후 실행을 선택해야 예시 자막이 시작되고 일시정지하면 멈춘다', async () => {
    vi.useFakeTimers()
    render(<App />)
    await navigate('consult')
    fireEvent.click(screen.getByRole('button', { name: '듣기 시작' }))
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByText('다음 진료는 10월 16일 오후 2시예요.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '확인하고 시작하기' }))
    act(() => vi.advanceTimersByTime(900))
    expect(screen.getByRole('log').textContent).toContain('글자로 바꾸는 중')
    expect(screen.getByRole('log').textContent).toContain('안녕하세요.')
    fireEvent.click(screen.getByRole('button', { name: '자막 일시정지' }))
    const pausedText = screen.getByRole('log').textContent
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('log').textContent).toBe(pausedText)
    fireEvent.click(screen.getByRole('button', { name: '이어 듣기' }))
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('log').textContent).toContain(
      '안녕하세요. 오늘 어떤 점이 불편해서 오셨어요?',
    )
  })
  it('필담 입력을 시작하면 자막 재생이 멈추고 탭 이동 후 초안이 남는다', async () => {
    vi.useFakeTimers()
    render(<App />)
    await navigate('consult')
    fireEvent.click(screen.getByRole('button', { name: '듣기 시작' }))
    fireEvent.click(screen.getByRole('button', { name: '확인하고 시작하기' }))
    fireEvent.click(screen.getByRole('button', { name: '글로 말하기' }))
    const input = screen.getByLabelText('직접 입력하기')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '확실하지 않아요.' } })
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('log').textContent).not.toContain('10월 16일')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }))
    await navigate('prepare')
    await navigate('consult')
    fireEvent.click(screen.getByRole('button', { name: '쓰던 말 이어 쓰기' }))
    expect((screen.getByLabelText('직접 입력하기') as HTMLTextAreaElement).value).toBe(
      '확실하지 않아요.',
    )
  })
  it('탭을 벗어나면 지연 자막을 수집하지 않는다', async () => {
    vi.useFakeTimers()
    render(<App />)
    await navigate('consult')
    fireEvent.click(screen.getByRole('button', { name: '듣기 시작' }))
    fireEvent.click(screen.getByRole('button', { name: '확인하고 시작하기' }))
    await navigate('review')
    act(() => vi.advanceTimersByTime(5000))
    await navigate('consult')
    expect(screen.getByRole('log').textContent).not.toContain('10월 16일')
    expect(screen.getByText('잠시 멈췄어요')).toBeTruthy()
  })
  it('글자 크기 조절은 자막에만 있고 준비와 이용 안내에는 없다', async () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: /글자 크기/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '이용 안내' }))
    expect(screen.queryByRole('combobox', { name: '글자 크기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await navigate('consult')
    fireEvent.click(screen.getByRole('button', { name: '자막 글자 크기' }))
    fireEvent.click(screen.getByRole('button', { name: '두 배' }))
    fireEvent.click(screen.getByRole('button', { name: '이 크기로 읽기' }))
    expect(screen.getByRole('log').style.getPropertyValue('--caption-size')).toBe('3rem')
    await navigate('prepare')
    expect(screen.queryByRole('button', { name: /글자 크기/ })).toBeNull()
    expect(document.querySelector('.app')?.getAttribute('style')).toBeNull()
  })
})

it('시작 화면에서 예약을 한 번 입력하고 준비부터 자동 분석까지 이어진다', async () => {
  window.history.replaceState(null, '', '/')
  render(<App />)
  expect(screen.getByRole('heading', { name: '병원 진료를 함께 준비해요.' })).toBeTruthy()
  expect(screen.queryByRole('navigation')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '예약 정보 적고 시작' }))
  fireEvent.change(screen.getByLabelText('병원 이름 · 선택'), { target: { value: '테스트 의원' } })
  fireEvent.change(screen.getByLabelText('진료 날짜 · 선택'), { target: { value: '2026-10-16' } })
  fireEvent.click(screen.getByRole('button', { name: '이 정보로 시작' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /테스트 의원/ })).toBeTruthy())
  fireEvent.change(screen.getByLabelText('현재 내 상태를 적어 주세요.'), {
    target: { value: '어제부터 팔이 아파요.' },
  })
  fireEvent.click(screen.getByRole('button', { name: '준비 완료하고 진료 시작' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: '실시간 자막' })).toBeTruthy())
  expect(screen.getByRole('log').textContent).toContain('어제부터 팔이 아파요.')
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '변환 완료' }))
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  expect(window.location.hash).toBe('#review')
  expect(vi.mocked(api).mock.calls[0][1]).toEqual({
    sources: [expect.objectContaining({ text: '어제부터 팔이 아파요.' })],
  })
  await navigate('prepare')
  await navigate('review')
  expect(api).toHaveBeenCalledTimes(1)
})

it('예약 없이 시작하고 빈 진료를 마치면 분석 요청 대신 기록 추가를 안내한다', async () => {
  window.history.replaceState(null, '', '/')
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '예약 없이 시작' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '준비 완료하고 진료 시작' })).toBeTruthy(),
  )
  fireEvent.click(screen.getByRole('button', { name: '준비 완료하고 진료 시작' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '변환 완료' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '변환 완료' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '안내문·기록 추가' })).toBeTruthy())
  expect(api).not.toHaveBeenCalled()
})

it('변환 완료에서 마지막 미완성 자막까지 받아 자동 분석에 포함한다', async () => {
  vi.useFakeTimers()
  render(<App />)
  fireEvent.change(screen.getByLabelText('현재 내 상태를 적어 주세요.'), {
    target: { value: '팔이 아파요.' },
  })
  fireEvent.click(screen.getByRole('button', { name: '준비 완료하고 진료 시작' }))
  await act(async () => vi.advanceTimersByTimeAsync(10))
  fireEvent.click(screen.getByRole('button', { name: '듣기 시작' }))
  fireEvent.click(screen.getByRole('button', { name: '확인하고 시작하기' }))
  await act(async () => vi.advanceTimersByTimeAsync(900))
  fireEvent.click(screen.getByRole('button', { name: '변환 완료' }))
  await act(async () => vi.advanceTimersByTimeAsync(100))
  expect(window.location.hash).toBe('#review')
  expect(api).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api).mock.calls[0][1]).toEqual({
    sources: expect.arrayContaining([
      expect.objectContaining({ text: '팔이 아파요.' }),
      expect.objectContaining({ kind: 'transcript', incomplete: true }),
    ]),
  })
})

it('예시 진료도 준비와 변환 완료를 거쳐 결과까지 이어진다', async () => {
  window.history.replaceState(null, '', '/')
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '예시 진료 열기' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '준비 완료하고 진료 시작' })).toBeTruthy(),
  )
  fireEvent.click(screen.getByRole('button', { name: '준비 완료하고 진료 시작' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '변환 완료' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '변환 완료' }))
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '기록에서 찾은 내용' })).toBeTruthy(),
  )
  expect(api).not.toHaveBeenCalled()
})
