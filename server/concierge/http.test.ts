import { describe, expect, it, vi } from 'vitest'
import { ConciergeService } from './service.js'
import { LocalStateStore } from './store.js'
import { config } from '../config.js'

vi.mock('./runtime.js', async () => {
  const { ConciergeService } = await import('./service.js')
  const { LocalStateStore } = await import('./store.js')
  return {
    conciergeAvailable: true,
    concierge: new ConciergeService(
      new LocalStateStore(),
      async () => ({ message: '', clarification: '', hospitals: [] }),
      { enabled: false, save: async () => {}, recall: async (_, p) => p, clear: async () => {} },
      async () => {},
    ),
  }
})
import { handleConcierge } from './http.js'
import { concierge } from './runtime.js'

describe('concierge HTTP authentication and privacy', () => {
  it('rejects cross-origin creation and unauthenticated reads', async () => {
    expect(
      (
        await handleConcierge({
          method: 'POST',
          path: '/session',
          ip: 'local',
          headers: { origin: 'https://other.example.org' },
          body: {},
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (await handleConcierge({ method: 'GET', path: '/state', ip: 'local', headers: {} }))
        .statusCode,
    ).toBe(401)
  })
  it('binds mutations to CSRF and state version and revokes deleted sessions', async () => {
    expect(concierge).toBeInstanceOf(ConciergeService)
    expect(concierge.store).toBeInstanceOf(LocalStateStore)
    const boot = await handleConcierge({
      method: 'POST',
      path: '/session',
      ip: 'local',
      headers: { origin: config.origin },
      body: {},
    })
    expect(boot.statusCode).toBe(200)
    expect(boot.headers['Cache-Control']).toBe('no-store')
    const { csrf } = boot.body as { csrf: string }
    const headers = {
      origin: config.origin,
      cookie: boot.headers['Set-Cookie'].split(';')[0],
      'x-pulda-csrf': csrf,
    }
    const req = {
      method: 'POST',
      path: '/preferences',
      ip: 'local',
      headers,
      body: {
        version: 0,
        preferences: { contact: 'phone', communication: 'none' },
        remember: false,
      },
    }
    expect(
      (await handleConcierge({ ...req, headers: { ...headers, 'x-pulda-csrf': 'wrong' } }))
        .statusCode,
    ).toBe(401)
    expect((await handleConcierge(req)).statusCode).toBe(200)
    expect((await handleConcierge(req)).statusCode).toBe(409)
    expect((await handleConcierge({ ...req, path: '/forget', body: {} })).statusCode).toBe(200)
    expect(
      (await handleConcierge({ method: 'GET', path: '/state', ip: 'local', headers })).statusCode,
    ).toBe(410)
  })
  it('requires user acknowledgement for a hospital reply', async () => {
    const boot = await handleConcierge({
      method: 'POST',
      path: '/session',
      ip: 'second',
      headers: { origin: config.origin },
      body: {},
    })
    const { csrf } = boot.body as { csrf: string }
    const result = await handleConcierge({
      method: 'POST',
      path: '/reply',
      ip: 'second',
      headers: {
        origin: config.origin,
        cookie: boot.headers['Set-Cookie'].split(';')[0],
        'x-pulda-csrf': csrf,
      },
      body: { version: 0, id: crypto.randomUUID(), text: '확정', confirmedByUser: false },
    })
    expect(result.statusCode).toBe(400)
  })
})
