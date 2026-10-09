// Validate built production serving using fake credentials; never calls AWS or OpenAI.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
const port = 47000 + Math.floor(Math.random() * 1000)
const child = spawn(process.execPath, ['dist-server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    APP_ORIGIN: 'https://pulda.example.invalid',
    OPENAI_API_KEY: 'synthetic-unused-key',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    RATE_LIMIT_TABLE: 'unused-static-smoke',
    OPERATOR_NAME: 'Synthetic test',
    PRIVACY_EMAIL: 'test@example.invalid',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
let startupError = ''
child.stderr.on('data', (chunk) => {
  startupError += chunk.toString()
})
child.on('error', (error) => {
  startupError += error.message
})
try {
  let ready = false
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      ready = (
        await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) })
      ).ok
    } catch {}
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, `Production server did not start: ${startupError}`)
  const home = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(home.status, 200)
  assert.ok((await home.text()).includes('<title>풀다</title>'))
  assert.ok(home.headers.get('content-security-policy').includes("frame-ancestors 'none'"))
  assert.ok(home.headers.get('strict-transport-security'))
  assert.equal(home.headers.get('cache-control'), 'no-store')
  const mock = await fetch(`http://127.0.0.1:${port}/mock.html`)
  assert.equal(mock.status, 200)
  assert.match(await mock.text(), /<script[^>]+src="[^"]*mock[^\"]*"/)
  const api = await fetch(`http://127.0.0.1:${port}/api/analyze`, { method: 'POST' })
  assert.equal(api.status, 403)
  assert.equal(api.headers.get('cache-control'), 'no-store')
  console.log('Production static serving, CSP, HSTS, no-store, API origin boundary: passed')
} finally {
  child.kill('SIGTERM')
}
