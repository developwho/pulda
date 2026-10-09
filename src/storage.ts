import { z } from 'zod'
import type { Visit } from './model'

export const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
const source = z.object({
  id: z.string().max(100),
  kind: z.enum(['transcript', 'patient_note', 'handout', 'reported_reply']),
  text: z.string().max(12000),
  example: z.boolean(),
  incomplete: z.boolean().optional(),
})
const savedSchema = z.object({
  version: z.literal(1),
  expiresAt: z.number().finite(),
  visit: z.object({
    hospital: z.string().max(200),
    date: z.string().max(20),
    time: z.string().max(20),
    note: z.string().max(2000),
    prepared: z.string().max(4000),
    requests: z.array(z.string().max(200)).max(10),
    sources: z.array(source).max(300),
    consultationCompleted: z.boolean(),
    captureInterrupted: z.boolean().default(false),
  }),
})
export type SavedVisit = { expiresAt: number; visit: Visit }
export function parseSaved(value: unknown, now = Date.now()): SavedVisit | null {
  const parsed = savedSchema.safeParse(value)
  if (
    !parsed.success ||
    parsed.data.expiresAt <= now ||
    parsed.data.expiresAt > now + SEVEN_DAYS ||
    parsed.data.visit.sources.reduce((n, s) => n + s.text.length, 0) > 60000
  )
    return null
  return {
    expiresAt: parsed.data.expiresAt,
    visit: { ...parsed.data.visit, approvals: [], completed: [] },
  }
}
let queue = Promise.resolve<unknown>(undefined)
function transaction(
  mode: 'readonly' | 'readwrite',
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  const operation = queue
    .catch(() => {})
    .then(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('pulda-private-visit', 1)
          open.onupgradeneeded = () => open.result.createObjectStore('visit')
          open.onerror = () => reject(open.error)
          open.onblocked = () => reject(new Error('STORAGE_BLOCKED'))
          open.onsuccess = () => {
            const db = open.result
            const tx = db.transaction('visit', mode)
            const request = run(tx.objectStore('visit'))
            tx.oncomplete = () => {
              const result = request.result
              db.close()
              resolve(result)
            }
            tx.onerror = () => {
              db.close()
              reject(tx.error)
            }
            tx.onabort = () => {
              db.close()
              reject(tx.error)
            }
          }
        }),
    )
  queue = operation
  return operation
}
export async function loadVisit() {
  const value = await transaction('readonly', (store) => store.get('active'))
  const saved = parseSaved(value)
  if (value && !saved) await eraseVisit()
  return saved
}
export const eraseVisit = () => transaction('readwrite', (store) => store.delete('active'))
export async function saveVisit(visit: Visit, expiresAt: number) {
  if (expiresAt <= Date.now()) {
    await eraseVisit()
    return
  }
  const { approvals: _approvals, completed: _completed, ...content } = visit
  await transaction('readwrite', (store) =>
    store.put({ version: 1, expiresAt, visit: content }, 'active'),
  )
}
