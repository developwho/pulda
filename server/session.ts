import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

export const hash = (value: string) =>
  createHmac('sha256', config.secret).update(value).digest('hex')
export function createSession() {
  const body = `${randomUUID()}.${Date.now() + 60 * 60 * 1000}`
  return `${body}.${hash(body)}`
}
export function readSession(cookie = ''): string | null {
  const token = cookie
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('pulda='))
    ?.slice(6)
  if (!token || token.length > 200) return null
  const parts = token.split('.')
  if (parts.length !== 3 || !/^\d+$/.test(parts[1]) || Number(parts[1]) <= Date.now()) return null
  const expected = hash(`${parts[0]}.${parts[1]}`)
  if (
    parts[2].length !== expected.length ||
    !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))
  )
    return null
  return token
}
export const csrf = (session: string) => hash(`csrf:${session}`)
