// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiveVoice } from './liveVoice'
vi.mock('./api', () => ({ sessionToken: async () => 'test-csrf' }))
class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 3
  })
  constructor() {
    Socket.instances.push(this)
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}
const stop = vi.fn()
const stream = { getTracks: () => [{ stop }] }
const microphone = vi.fn(async () => stream)
beforeEach(() => {
  Socket.instances = []
  stop.mockClear()
  microphone.mockReset().mockResolvedValue(stream)
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('AudioWorkletNode', class {})
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: microphone },
  })
})
afterEach(() => vi.unstubAllGlobals())
const events = () => ({ partial: vi.fn(), final: vi.fn(), listening: vi.fn(), error: vi.fn() })
describe('microphone lifecycle', () => {
  it('does not capture if pause arrives before a deferred start', async () => {
    const voice = createLiveVoice(events())
    const starting = voice.start()
    void voice.pause()
    await starting
    expect(microphone).not.toHaveBeenCalled()
  })
  it('stops a microphone granted after cancellation without opening a socket', async () => {
    let grant!: (value: typeof stream) => void
    microphone.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve
        }),
    )
    const voice = createLiveVoice(events())
    const starting = voice.start()
    await Promise.resolve()
    void voice.pause()
    grant(stream)
    await starting
    expect(stop).toHaveBeenCalledOnce()
    expect(Socket.instances).toHaveLength(0)
  })
  it('handles denied permission without losing the text workflow', async () => {
    microphone.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const callbacks = events()
    await createLiveVoice(callbacks).start()
    expect(callbacks.error.mock.calls[0][0].message).toBe('NotAllowedError')
    expect(Socket.instances).toHaveLength(0)
  })
  it('stops capture immediately but accepts the last final during draining', async () => {
    const callbacks = events()
    const voice = createLiveVoice(callbacks)
    await voice.start()
    const socket = Socket.instances[0]
    socket.receive({ type: 'delta', id: 'a', text: '열은' })
    const ending = voice.finish()
    expect(stop).toHaveBeenCalledOnce()
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'finish' }))
    socket.receive({ type: 'final', id: 'a', text: '열은 없어요.' })
    socket.receive({ type: 'finished' })
    await ending
    expect(callbacks.final.mock.calls[0][0]).toMatchObject({
      text: '열은 없어요.',
      incomplete: false,
    })
  })
  it('keeps unfinished visible words and rejects late events after deletion', async () => {
    const callbacks = events()
    const voice = createLiveVoice(callbacks)
    await voice.start()
    const socket = Socket.instances[0]
    socket.receive({ type: 'delta', id: 'a', text: '3일 전부터' })
    const ending = voice.finish()
    socket.receive({ type: 'finished', incomplete: true })
    await ending
    expect(callbacks.final.mock.calls[0][0]).toMatchObject({ text: '3일 전부터', incomplete: true })
    voice.dispose()
    socket.receive({ type: 'final', id: 'b', text: '늦은 문장' })
    expect(callbacks.final).toHaveBeenCalledOnce()
  })
  it('keeps committed order when final events arrive out of order', async () => {
    const callbacks = events()
    const voice = createLiveVoice(callbacks)
    await voice.start()
    const socket = Socket.instances[0]
    socket.receive({ type: 'committed', id: 'first', previous: null })
    socket.receive({ type: 'committed', id: 'second', previous: 'first' })
    socket.receive({ type: 'final', id: 'second', text: '둘째 문장' })
    expect(callbacks.final).not.toHaveBeenCalled()
    socket.receive({ type: 'final', id: 'first', text: '첫째 문장' })
    expect(callbacks.final.mock.calls.map((x) => x[0].text)).toEqual(['첫째 문장', '둘째 문장'])
    voice.dispose()
  })
})
