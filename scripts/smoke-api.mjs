// Synthetic fixtures only. No audio recording or patient information.
import assert from 'node:assert/strict'
import WebSocket from 'ws'
const base = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3001'
const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173'
const session = await fetch(`${base}/api/session`, { method: 'POST', headers: { Origin: origin } })
assert.equal(session.status, 200)
const token = await session.json()
const cookie = session.headers.get('set-cookie').split(';')[0]
const headers = {
  Origin: origin,
  Cookie: cookie,
  'X-Pulda-CSRF': token.csrf,
  'Content-Type': 'application/json',
}
for (const [name, custom, expected] of [
  ['cross-origin', { ...headers, Origin: 'https://invalid.example' }, 403],
  ['csrf', { ...headers, 'X-Pulda-CSRF': '' }, 401],
]) {
  const result = await fetch(`${base}/api/analyze`, { method: 'POST', headers: custom, body: '{}' })
  assert.equal(result.status, expected)
  console.log(`${name}: passed`)
}
const sources = [
  {
    id: 'synthetic-1',
    kind: 'transcript',
    text: '다음 방문은 2026년 10월 16일 오후 2시입니다.',
    example: true,
  },
  {
    id: 'synthetic-2',
    kind: 'handout',
    text: '다음 방문은 2026년 10월 16일 오후 3시입니다.',
    example: true,
  },
]
const analysis = await fetch(`${base}/api/analyze`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ sources }),
})
assert.equal(analysis.status, 200, `analysis status ${analysis.status}`)
const result = await analysis.json()
assert.ok(Array.isArray(result.items))
for (const item of result.items)
  for (const evidence of item.evidence)
    assert.ok(sources.find((s) => s.id === evidence.sourceId)?.text.includes(evidence.quote))
console.log(`analysis: ${result.items.length} source-validated items`)
await new Promise((resolve, reject) => {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/api/voice`, {
    headers: { Cookie: cookie, Origin: origin },
  })
  const timer = setTimeout(() => {
    socket.close()
    reject(new Error('Voice timeout'))
  }, 20000)
  socket.on('open', () => socket.send(JSON.stringify({ type: 'authenticate', csrf: token.csrf })))
  socket.on('message', (raw) => {
    const event = JSON.parse(raw.toString())
    if (event.type === 'failure') {
      clearTimeout(timer)
      socket.close()
      reject(new Error(event.code))
    }
    if (event.type === 'ready') socket.send(JSON.stringify({ type: 'finish' }))
    if (event.type === 'finished') {
      clearTimeout(timer)
      socket.close()
      console.log('voice relay handshake/finish: passed')
      resolve()
    }
  })
  socket.on('error', reject)
})
