// Pass a synthetic 24 kHz mono PCM16 WAV fixture. Never record a person for this test.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
const wav = await readFile(process.argv[2])
assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
let offset = 12,
  audio
while (offset + 8 < wav.length) {
  const size = wav.readUInt32LE(offset + 4)
  if (wav.toString('ascii', offset, offset + 4) === 'data') {
    audio = wav.subarray(offset + 8, offset + 8 + size)
    break
  }
  offset += 8 + size + (size % 2)
}
assert.ok(audio)
const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
  base = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3001'
const session = await fetch(`${base}/api/session`, { method: 'POST', headers: { Origin: origin } })
const { csrf } = await session.json()
const cookie = session.headers.get('set-cookie').split(';')[0]
await new Promise((resolve, reject) => {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/api/voice`, {
    headers: { Origin: origin, Cookie: cookie },
  })
  let deltas = 0,
    finals = 0,
    pump
  const timeout = setTimeout(() => {
    socket.close()
    reject(new Error('TIMEOUT'))
  }, 45000)
  socket.on('open', () => socket.send(JSON.stringify({ type: 'authenticate', csrf })))
  socket.on('message', (raw) => {
    const event = JSON.parse(raw.toString())
    if (event.type === 'failure') {
      clearTimeout(timeout)
      clearInterval(pump)
      socket.close()
      reject(new Error(event.code))
      return
    }
    if (event.type === 'ready') {
      let position = 0
      pump = setInterval(() => {
        if (position >= audio.length) {
          clearInterval(pump)
          socket.send(JSON.stringify({ type: 'finish' }))
          return
        }
        socket.send(audio.subarray(position, position + 2400))
        position += 2400
      }, 50)
    }
    if (event.type === 'delta') deltas++
    if (event.type === 'final' && event.text.trim()) finals++
    if (event.type === 'finished') {
      clearTimeout(timeout)
      socket.close()
      if (deltas && finals && !event.incomplete) {
        console.log(JSON.stringify({ deltas, finals, drained: true }))
        resolve()
      } else
        reject(
          new Error(
            `Unexpected transcription: deltas=${deltas}, finals=${finals}, incomplete=${event.incomplete}`,
          ),
        )
    }
  })
  socket.on('error', reject)
})
