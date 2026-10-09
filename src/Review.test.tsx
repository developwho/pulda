// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Review } from './Review'
import { newVisit } from './model'
import { api } from './api'
vi.mock('./api', () => ({
  api: vi.fn(),
  errorMessage: () => '연결을 확인하고 다시 시도해 주세요.',
}))
const source = {
  id: 's1',
  kind: 'handout' as const,
  text: '접수처에서 시간을 확인해 주세요.',
  example: false,
}
const visit = { ...newVisit(), sources: [source] }
const result = {
  items: [{ kind: 'action', evidence: [{ sourceId: source.id, quote: source.text }] }],
}
const props = () => ({ visit, add: vi.fn(), approve: vi.fn(), update: vi.fn(), present: vi.fn() })
beforeEach(() => {
  vi.mocked(api).mockReset()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)
async function analyze() {
  fireEvent.click(screen.getByRole('button', { name: '기록에서 할 일 찾기' }))
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '동의하고 할 일 찾기' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: `할 일 ${source.text}` })).toBeTruthy(),
  )
}
it('requires consent, links evidence, and requires approval before showing a question', async () => {
  vi.mocked(api).mockResolvedValue(result)
  const callbacks = props()
  render(<Review {...callbacks} />)
  await analyze()
  fireEvent.click(screen.getByRole('button', { name: `할 일 ${source.text}` }))
  fireEvent.click(screen.getByText('전체 원문 보기'))
  expect(screen.getAllByText(source.text).length).toBeGreaterThan(1)
  fireEvent.click(screen.getByRole('button', { name: '질문하고 답변 적기' }))
  expect(
    (screen.getByRole('button', { name: '질문 크게 보여주기' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: '이 질문을 보여줄게요' }))
  fireEvent.click(screen.getByRole('button', { name: '질문 크게 보여주기' }))
  expect(callbacks.approve).toHaveBeenCalledWith(
    expect.objectContaining({ sourceId: 's1', kind: 'question' }),
  )
  expect(callbacks.present).toHaveBeenCalledWith(['이 내용을 다시 설명해 주세요.', source.text])
})
it('discards an old analysis arriving after the source changes', async () => {
  let resolve!: (value: unknown) => void
  vi.mocked(api).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }) as never,
  )
  const callbacks = props()
  const view = render(<Review {...callbacks} />)
  fireEvent.click(screen.getByRole('button', { name: '기록에서 할 일 찾기' }))
  fireEvent.click(screen.getByRole('button', { name: '동의하고 할 일 찾기' }))
  view.rerender(
    <Review
      {...callbacks}
      visit={{ ...visit, sources: [...visit.sources, { ...source, id: 's2', text: '새 답변' }] }}
    />,
  )
  await act(async () => resolve(result))
  expect(screen.queryByRole('button', { name: `할 일 ${source.text}` })).toBeNull()
  expect(screen.getByRole('button', { name: '기록에서 할 일 찾기' })).toBeTruthy()
})
it('shows a retryable error without removing original records', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('offline'))
  render(<Review {...props()} />)
  fireEvent.click(screen.getByRole('button', { name: '기록에서 할 일 찾기' }))
  fireEvent.click(screen.getByRole('button', { name: '동의하고 할 일 찾기' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '돌아가기' }))
  fireEvent.click(screen.getByRole('button', { name: '기록 원문 읽기' }))
  expect(screen.getByText(source.text)).toBeTruthy()
})

it('진료 후 활성화 시 자동 분석하고 실패하면 원문을 유지하며 재시도한다', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result)
  const callbacks = props()
  const view = render(<Review {...callbacks} active={false} />)
  expect(api).not.toHaveBeenCalled()
  view.rerender(<Review {...callbacks} active />)
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(api).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '다시 분석하기' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: `할 일 ${source.text}` })).toBeTruthy(),
  )
  expect(api).toHaveBeenCalledTimes(2)
  view.rerender(<Review {...callbacks} active={false} />)
  view.rerender(<Review {...callbacks} active />)
  expect(api).toHaveBeenCalledTimes(2)
})

it('자동 분석 중 자료가 바뀌면 이전 결과를 버리고 최신 자료를 분석한다', async () => {
  let resolveOld!: (value: unknown) => void
  vi.mocked(api)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }) as never,
    )
    .mockResolvedValue({ items: [] })
  const callbacks = props()
  const view = render(<Review {...callbacks} active />)
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  const latest = {
    ...visit,
    sources: [...visit.sources, { ...source, id: 's2', text: '추가 기록' }],
  }
  view.rerender(<Review {...callbacks} visit={latest} active />)
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2))
  await act(async () => resolveOld(result))
  expect(screen.queryByRole('button', { name: `할 일 ${source.text}` })).toBeNull()
  expect(
    screen.getByText('뚜렷한 할 일을 찾지 못했어요. 원문을 읽거나 병원에 다시 물어봐 주세요.', {
      exact: false,
    }),
  ).toBeTruthy()
})
