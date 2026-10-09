import { sessionToken } from './api'
import type { Source } from './model'

type Callbacks = {
  partial: (source: Source | null) => void
  final: (source: Source) => void
  listening: () => void
  error: (error: Error) => void
  gap?: () => void
}
export function createLiveVoice(callbacks: Callbacks) {
  let generation = 0,
    intent = 0,
    disposed = false,
    running = false
  let ws: WebSocket | null = null,
    stream: MediaStream | null = null,
    context: AudioContext | null = null
  let stopping: Promise<void> = Promise.resolve(),
    settle: (() => void) | null = null
  const items = new Map<string, { text: string; complete: boolean; emitted: boolean }>()
  let order: string[] = []
  function flush(incomplete = false) {
    for (const id of order) {
      const item = items.get(id)
      if (!item || item.emitted) continue
      if (!item.complete && !incomplete) break
      if (item.text.trim())
        callbacks.final({
          id,
          kind: 'transcript',
          text: item.text.trim(),
          example: false,
          incomplete: !item.complete,
        })
      item.emitted = true
    }
    const partial = order
      .map((id) => [id, items.get(id)] as const)
      .find(([, item]) => item && !item.emitted)
    callbacks.partial(
      partial?.[1]?.text
        ? { id: partial[0], kind: 'transcript', text: partial[1].text, example: false }
        : null,
    )
  }
  function stopCapture() {
    running = false
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    void context?.close().catch(() => {})
    context = null
  }
  async function start() {
    const requested = ++intent
    await stopping
    if (disposed || running || requested !== intent) return
    running = true
    const current = ++generation
    items.clear()
    order = []
    const valid = () => !disposed && generation === current
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
        throw new Error('UNSUPPORTED')
      // Only called following the user's explicit caption consent.
      const capture = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      })
      if (!valid() || !running) {
        capture.getTracks().forEach((track) => track.stop())
        return
      }
      stream = capture
      const token = await sessionToken()
      if (!valid() || !running) {
        stopCapture()
        return
      }
      const socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/voice`,
      )
      ws = socket
      const fail = (error: Error) => {
        if (!valid()) return
        callbacks.gap?.()
        stopCapture()
        flush(true)
        socket.close()
        settle?.()
        callbacks.error(error)
      }
      const setupTimer = window.setTimeout(() => fail(new Error('CONNECTION_FAILED')), 20000)
      socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', csrf: token }))
      socket.onmessage = async (event) => {
        if (!valid()) return
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'failure') {
            fail(new Error(data.code))
            return
          }
          if (data.type === 'finished') {
            if (data.incomplete) callbacks.gap?.()
            flush(true)
            socket.close()
            settle?.()
            return
          }
          if (data.type === 'ready') {
            clearTimeout(setupTimer)
            if (!running || !stream) {
              socket.send(JSON.stringify({ type: 'finish' }))
              return
            }
            const audio = new AudioContext()
            context = audio
            await audio.audioWorklet.addModule('/pcm-worklet.js')
            if (!valid() || !running || !stream) {
              void audio.close().catch(() => {})
              return
            }
            const source = audio.createMediaStreamSource(stream)
            const processor = new AudioWorkletNode(audio, 'pulda-pcm')
            const mute = audio.createGain()
            mute.gain.value = 0
            source.connect(processor)
            processor.connect(mute)
            mute.connect(audio.destination)
            let activeFrames = 0,
              silenceFrames = 0
            const preRoll: ArrayBuffer[] = []
            processor.port.onmessage = ({ data: pcm }: MessageEvent<ArrayBuffer>) => {
              if (!valid() || !running || socket.readyState !== WebSocket.OPEN) return
              if (socket.bufferedAmount > 250000) {
                fail(new Error('CONNECTION_FAILED'))
                return
              }
              const samples = new Int16Array(pcm)
              const rms = Math.sqrt(
                samples.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / samples.length,
              )
              const speech = rms > 0.008
              if (!activeFrames) {
                preRoll.push(pcm)
                if (preRoll.length > 6) preRoll.shift()
                if (!speech) return
                for (const frame of preRoll) socket.send(frame)
                activeFrames = preRoll.length
                preRoll.length = 0
              } else {
                socket.send(pcm)
                activeFrames++
              }
              silenceFrames = speech ? 0 : silenceFrames + 1
              if (silenceFrames >= 18 || activeFrames >= 400) {
                socket.send(JSON.stringify({ type: 'commit' }))
                activeFrames = 0
                silenceFrames = 0
              }
            }
            await audio.resume()
            if (valid() && running) callbacks.listening()
          } else if (
            ['committed', 'delta', 'final'].includes(data.type) &&
            typeof data.id === 'string'
          ) {
            if (!items.has(data.id)) {
              items.set(data.id, { text: '', complete: false, emitted: false })
              order.push(data.id)
            }
            const item = items.get(data.id)!
            if (item.emitted) return
            if (data.type === 'committed' && data.previous && order.includes(data.previous)) {
              order = order.filter((id) => id !== data.id)
              order.splice(order.indexOf(data.previous) + 1, 0, data.id)
            }
            if (data.type === 'delta' && typeof data.text === 'string') item.text += data.text
            if (data.type === 'final' && typeof data.text === 'string') {
              item.text = data.text
              item.complete = true
            }
            flush()
          }
        } catch {
          fail(new Error('CONNECTION_FAILED'))
        }
      }
      socket.onerror = () => fail(new Error('CONNECTION_FAILED'))
      socket.onclose = () => {
        clearTimeout(setupTimer)
        if (!valid()) return
        const unexpected = running
        stopCapture()
        flush(true)
        settle?.()
        if (unexpected) {
          callbacks.gap?.()
          callbacks.error(new Error('CONNECTION_LOST'))
        }
      }
    } catch (error) {
      if (!valid()) return
      stopCapture()
      callbacks.error(
        new Error(
          error instanceof DOMException
            ? error.name
            : error instanceof Error
              ? error.message
              : 'CONNECTION_FAILED',
        ),
      )
    }
  }
  function pause() {
    intent++
    if (!running) return stopping
    stopCapture()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      generation++
      ws?.close()
      return stopping
    }
    const socket = ws
    stopping = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        callbacks.gap?.()
        flush(true)
        socket.close()
        settle?.()
      }, 6000)
      settle = () => {
        clearTimeout(timeout)
        settle = null
        resolve()
      }
      socket.send(JSON.stringify({ type: 'finish' }))
    })
    return stopping
  }
  return {
    start,
    pause,
    finish: pause,
    dispose: () => {
      disposed = true
      intent++
      generation++
      stopCapture()
      ws?.close()
      settle?.()
      items.clear()
      order = []
    },
  }
}
