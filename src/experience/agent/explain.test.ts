// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('./index', () => ({ getAccessCode: () => 'test' }))
import { createExplanationSession } from './explain'
const ready = {
  kind: 'ready',
  source: 'ai',
  lines: ['다시 병원에 와요.'],
  chunks: ['다시 병원에 와요'],
}
afterEach(() => vi.unstubAllGlobals())
describe('explanation cache scope and cancellation', () => {
  it('renders local meanings without a request and only reuses the same context', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(ready)))
    vi.stubGlobal('fetch', fetcher)
    const session = createExplanationSession(),
      signal = new AbortController().signal
    expect(session.peek({ text: '복용', selected: '복용' })?.kind).toBe('ready')
    await session.load({ text: '복용', selected: '복용' }, signal)
    expect(fetcher).not.toHaveBeenCalled()
    await session.load({ text: '다시 오세요.', context: '어제 진료' }, signal)
    await session.load({ text: '다시 오세요.', context: '어제 진료' }, signal)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await session.load({ text: '다시 오세요.', context: '검사 후' }, signal)
    await createExplanationSession().load({ text: '다시 오세요.', context: '어제 진료' }, signal)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('does not cache a cancelled response or failed connection', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () => {
      controller.abort()
      return new Response(JSON.stringify(ready))
    })
    vi.stubGlobal('fetch', fetcher)
    const session = createExplanationSession(),
      input = { text: '처음 듣는 말이에요.' }
    await session.load(input, controller.signal)
    expect(session.peek(input)).toBeUndefined()
    fetcher.mockRejectedValueOnce(new Error('offline'))
    expect(await session.load(input, new AbortController().signal)).toMatchObject({
      kind: 'unavailable',
    })
    expect(session.peek(input)).toBeUndefined()
  })
})
