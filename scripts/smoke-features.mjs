import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const origin = 'http://127.0.0.1:5173',
  base = 'http://127.0.0.1:3001'
const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { Origin: origin } })
const session = await response.json()
const headers = {
  Origin: origin,
  Cookie: response.headers.get('set-cookie').split(';')[0],
  'X-Pulda-CSRF': session.csrf,
  'Content-Type': 'application/json',
}
const note = '열 없음. 왼쪽 배 3일 아픔. 원인 모름.'
const prepared = await fetch(`${base}/api/prepare`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ original: note }),
})
assert.equal(prepared.status, 200)
const { candidate } = await prepared.json()
assert.ok(candidate.includes('3'))
console.log('prepare: generated and audited')
const image = await readFile('tmp/synthetic-handout.png')
const ocr = await fetch(`${base}/api/ocr`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ mime: 'image/png', data: image.toString('base64') }),
})
assert.equal(ocr.status, 200)
const { text } = await ocr.json()
assert.ok(text.includes('2026') && text.includes('16') && text.includes('3'))
console.log('OCR: synthetic Korean date and numbers preserved')
