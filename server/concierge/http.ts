import { z } from 'zod'
import { config, production } from '../config.js'
import { consume } from '../limits.js'
import { createSession, readSession, csrf, hash } from '../session.js'
import { concierge, conciergeAvailable } from './runtime.js'
import { ConciergeError, InquiryInputSchema } from './types.js'

export interface ApiRequest {
  method: string
  path: string
  headers: Record<string, string | undefined>
  body?: unknown
  ip: string
}
export interface ApiResponse {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}
const envelope = z.object({ version: z.number().int().nonnegative() })

export async function handleConcierge(req: ApiRequest): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }
  const respond = (body: unknown, statusCode = 200): ApiResponse => ({ body, statusCode, headers })
  try {
    if (!conciergeAvailable) throw new ConciergeError('CONCIERGE_UNAVAILABLE', 503)
    if (
      production &&
      process.env.PULDA_ACCESS_CODE &&
      req.headers['x-pulda-code'] !== process.env.PULDA_ACCESS_CODE
    )
      throw new ConciergeError('ACCESS_CODE_REQUIRED', 401)
    if (req.method !== 'GET' && req.headers.origin !== config.origin)
      throw new ConciergeError('ORIGIN_REJECTED', 403)
    let session = readSession(req.headers.cookie)
    if (req.method === 'POST' && req.path === '/session') {
      if (!(await consume(`concierge:init:${hash(req.ip)}`, 30, 600)))
        throw new ConciergeError('RATE_LIMITED', 429)
      if (session) {
        const old = await concierge.store.get(hash(session))
        if (old && old.expiresAt <= Date.now()) session = null
      }
      session ??= createSession()
      const state = await concierge.init(hash(session), Number(session.split('.')[1]))
      headers['Set-Cookie'] =
        `pulda=${session}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000))}${production ? '; Secure' : ''}`
      return respond({ state, csrf: csrf(session), memoryAvailable: concierge.memory.enabled })
    }
    if (!session || req.headers['x-pulda-csrf'] !== csrf(session))
      throw new ConciergeError('SESSION_EXPIRED', 401)
    const owner = hash(session)
    if (req.method === 'GET' && req.path === '/state') return respond(await concierge.read(owner))
    if (req.method !== 'POST') throw new ConciergeError('NOT_FOUND', 404)
    if (!(await consume(`concierge:action:${owner}`, 60, 600)))
      throw new ConciergeError('RATE_LIMITED', 429)
    if (req.path === '/forget') {
      await concierge.forget(owner)
      headers['Set-Cookie'] =
        `pulda=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`
      return respond({ ok: true })
    }
    const { version } = envelope.parse(req.body)
    if (req.path === '/search') {
      const body = envelope
        .extend({ query: z.string().trim().min(2).max(500), requestId: z.string().uuid() })
        .strict()
        .parse(req.body)
      if (
        !(await consume(`concierge:search:${owner}`, 12, 3600)) ||
        !(await consume('ai:global', config.dailyCalls, 86400))
      )
        throw new ConciergeError('RATE_LIMITED', 429)
      return respond(await concierge.search(owner, version, body.query, body.requestId), 202)
    }
    if (req.path === '/preferences') {
      const body = envelope
        .extend({ preferences: z.unknown(), remember: z.boolean() })
        .strict()
        .parse(req.body)
      return respond(await concierge.preferences(owner, version, body.preferences, body.remember))
    }
    if (req.path === '/draft') {
      const body = envelope.extend({ input: InquiryInputSchema }).strict().parse(req.body)
      return respond(await concierge.draft(owner, version, body.input))
    }
    if (req.path === '/approve' || req.path === '/contacted') {
      const body = envelope.extend({ id: z.string().uuid() }).strict().parse(req.body)
      return respond(
        await concierge[req.path === '/approve' ? 'approve' : 'contacted'](owner, version, body.id),
      )
    }
    if (req.path === '/reply') {
      const body = envelope
        .extend({
          id: z.string().uuid(),
          text: z.string().trim().min(1).max(1500),
          appointment: z
            .object({ date: z.string(), time: z.string(), department: z.string() })
            .strict()
            .optional(),
          confirmedByUser: z.literal(true),
        })
        .strict()
        .parse(req.body)
      return respond(await concierge.reply(owner, version, body.id, body.text, body.appointment))
    }
    if (req.path === '/cancel') return respond(await concierge.cancel(owner, version))
    throw new ConciergeError('NOT_FOUND', 404)
  } catch (error) {
    if (error instanceof ConciergeError) return respond({ code: error.code }, error.status)
    if (error instanceof z.ZodError) return respond({ code: 'INVALID_INPUT' }, 400)
    // Do not log medical text, model output, credentials, or SDK error bodies.
    console.error('concierge_request_failed', error instanceof Error ? error.name : 'UnknownError')
    return respond({ code: 'SERVICE_UNAVAILABLE' }, 503)
  }
}
