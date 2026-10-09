import { z } from 'zod'
import { handleConcierge } from './http.js'
import { concierge } from './runtime.js'

interface HttpEvent {
  rawPath: string
  headers: Record<string, string>
  cookies?: string[]
  body?: string
  isBase64Encoded?: boolean
  requestContext: { http: { method: string; sourceIp: string } }
}
interface QueueEvent {
  Records: Array<{ messageId: string; body: string }>
}
export async function handler(event: HttpEvent | QueueEvent | { cleanup: true }) {
  if ('cleanup' in event) {
    await concierge.cleanup()
    return { ok: true }
  }
  if ('Records' in event) {
    const batchItemFailures = []
    for (const record of event.Records) {
      try {
        const body = z
          .object({ owner: z.string().regex(/^[a-f0-9]{64}$/), id: z.string().uuid() })
          .strict()
          .parse(JSON.parse(record.body))
        await concierge.work(body.owner, body.id)
      } catch {
        batchItemFailures.push({ itemIdentifier: record.messageId })
      }
    }
    return { batchItemFailures }
  }
  let body
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString()
      : (event.body ?? '')
    if (Buffer.byteLength(raw) > 12 * 1024) return { statusCode: 413, body: '{}' }
    body = raw ? JSON.parse(raw) : undefined
  } catch {
    return { statusCode: 400, body: JSON.stringify({ code: 'INVALID_INPUT' }) }
  }
  const result = await handleConcierge({
    method: event.requestContext.http.method,
    path: event.rawPath.replace(/^\/api\/concierge/, ''),
    headers: { ...event.headers, cookie: event.cookies?.join('; ') ?? event.headers.cookie },
    body,
    ip: event.requestContext.http.sourceIp,
  })
  const cookies = result.headers['Set-Cookie'] ? [result.headers['Set-Cookie']] : undefined
  delete result.headers['Set-Cookie']
  return { ...result, cookies, body: JSON.stringify(result.body) }
}
