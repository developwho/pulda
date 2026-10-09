import type { Server } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { config } from './config.js'
import { csrf, hash, readSession } from './session.js'
import { consume } from './limits.js'

export function attachVoice(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32000, perMessageDeflate: false })
  server.on('upgrade', (request, socket, head) => {
    const session = readSession(request.headers.cookie)
    if (request.url !== '/api/voice' || request.headers.origin !== config.origin || !session) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      let upstream: WebSocket | undefined
      let ready = false,
        ending = false,
        pending = 0,
        bytes = 0,
        authenticated = false
      let rateBytes = 0,
        rateStart = Date.now()
      const send = (event: unknown) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
      }
      const timers = new Set<ReturnType<typeof setTimeout>>()
      const later = (fn: () => void, ms: number) => {
        const timer = setTimeout(fn, ms)
        timers.add(timer)
        return timer
      }
      const end = () => {
        send({ type: 'finished', incomplete: pending > 0 })
        ws.close(1000)
        upstream?.close()
      }
      const fail = (code: string) => {
        send({ type: 'failure', code })
        ws.close(1011)
        upstream?.close()
      }
      const authenticationTimeout = later(() => fail('SESSION_EXPIRED'), 5000)
      let alive = true
      ws.on('pong', () => {
        alive = true
      })
      const heartbeat = setInterval(() => {
        if (!alive) {
          ws.terminate()
          upstream?.close()
          return
        }
        alive = false
        ws.ping()
        if (upstream?.readyState === WebSocket.OPEN) upstream.ping()
      }, 25000)
      const expiry = Number(session.split('.')[1]) - Date.now()
      later(() => fail('SESSION_EXPIRED'), Math.min(expiry, 15 * 60 * 1000))
      const commit = () => {
        if (bytes >= 4800 && upstream?.readyState === WebSocket.OPEN) {
          pending++
          upstream.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
          bytes = 0
        }
      }
      ws.on('message', async (raw, binary) => {
        try {
          if (binary) {
            const audio = Buffer.isBuffer(raw)
              ? raw
              : raw instanceof ArrayBuffer
                ? Buffer.from(raw)
                : Buffer.concat(raw)
            if (!ready || ending || !upstream) return
            if (Date.now() - rateStart >= 1000) {
              rateBytes = 0
              rateStart = Date.now()
            }
            rateBytes += audio.length
            if (
              rateBytes > 100000 ||
              audio.length % 2 ||
              upstream.bufferedAmount > 250000 ||
              bytes > 24000 * 2 * 30
            ) {
              fail('AUDIO_BACKPRESSURE')
              return
            }
            bytes += audio.length
            upstream.send(
              JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: audio.toString('base64'),
              }),
            )
            return
          }
          const message = JSON.parse(raw.toString())
          if (message.type === 'authenticate' && !authenticated) {
            authenticated = true
            clearTimeout(authenticationTimeout)
            if (message.csrf !== csrf(session)) {
              fail('SESSION_EXPIRED')
              return
            }
            if (!config.key) {
              fail('SERVICE_UNAVAILABLE')
              return
            }
            if (
              !(await consume(`voice:${hash(session)}`, 20, 3600)) ||
              !(await consume('voice:global', config.dailyStreams, 86400))
            ) {
              fail('RATE_LIMITED')
              return
            }
            if (ws.readyState !== WebSocket.OPEN) return
            upstream = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
              headers: {
                Authorization: `Bearer ${config.key}`,
                'OpenAI-Safety-Identifier': hash(session),
              },
              maxPayload: 1000000,
              handshakeTimeout: 10000,
            })
            const setupTimeout = later(() => fail('CONNECTION_FAILED'), 15000)
            upstream.on('open', () =>
              upstream?.send(
                JSON.stringify({
                  type: 'session.update',
                  session: {
                    type: 'transcription',
                    audio: {
                      input: {
                        format: { type: 'audio/pcm', rate: 24000 },
                        transcription: {
                          model: config.transcribe,
                          languages: ['ko'],
                          delay: 'low',
                        },
                        turn_detection: null,
                      },
                    },
                  },
                }),
              ),
            )
            upstream.on('message', (data) => {
              try {
                const event = JSON.parse(data.toString())
                if (event.type === 'session.updated') {
                  clearTimeout(setupTimeout)
                  ready = true
                  send({ type: 'ready' })
                  return
                }
                if (
                  event.type === 'error' ||
                  event.type === 'conversation.item.input_audio_transcription.failed'
                ) {
                  fail('TRANSCRIPTION_FAILED')
                  return
                }
                if (event.type === 'input_audio_buffer.committed')
                  send({ type: 'committed', id: event.item_id, previous: event.previous_item_id })
                if (event.type === 'conversation.item.input_audio_transcription.delta')
                  send({ type: 'delta', id: event.item_id, text: event.delta })
                if (event.type === 'conversation.item.input_audio_transcription.completed') {
                  pending = Math.max(0, pending - 1)
                  send({ type: 'final', id: event.item_id, text: event.transcript })
                  if (ending && pending === 0) end()
                }
              } catch {
                fail('TRANSCRIPTION_FAILED')
              }
            })
            upstream.on('error', () => fail('CONNECTION_FAILED'))
            upstream.on('close', () => {
              if (!ending && ws.readyState === WebSocket.OPEN) fail('CONNECTION_LOST')
            })
          } else if (message.type === 'commit' && ready && !ending) commit()
          else if (message.type === 'finish' && !ending) {
            ending = true
            commit()
            if (pending === 0) end()
            else later(end, 5000)
          } else {
            fail('INVALID_MESSAGE')
          }
        } catch {
          fail('SERVICE_UNAVAILABLE')
        }
      })
      ws.on('error', () => upstream?.close())
      ws.on('close', () => {
        clearInterval(heartbeat)
        for (const timer of timers) clearTimeout(timer)
        upstream?.close()
      })
    })
  })
  return () => {
    for (const client of wss.clients) client.close(1001)
    wss.close()
  }
}
