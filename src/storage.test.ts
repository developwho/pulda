import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { eraseVisit, loadVisit, parseSaved, saveVisit, SEVEN_DAYS } from './storage'
import { newVisit } from './model'
import { calendarContent } from './calendar'
beforeEach(async () => {
  await eraseVisit()
})
describe('private browser retention', () => {
  it('retains a visit only explicitly and discards approvals on restore', async () => {
    expect(await loadVisit()).toBeNull()
    const visit = newVisit()
    visit.note = '열은 없어요.'
    visit.approvals = [{ sourceId: 's1', kind: 'schedule', text: 'old approval' }]
    await saveVisit(visit, Date.now() + SEVEN_DAYS)
    const saved = await loadVisit()
    expect(saved?.visit.note).toBe(visit.note)
    expect(saved?.visit.approvals).toEqual([])
    await eraseVisit()
    expect(await loadVisit()).toBeNull()
  })
  it('rejects expired or malformed data and never extends the expiry on save', async () => {
    const expiry = Date.now() + 10000
    await saveVisit(newVisit(), expiry)
    await saveVisit({ ...newVisit(), note: '수정' }, expiry)
    expect((await loadVisit())?.expiresAt).toBe(expiry)
    expect(parseSaved({ version: 1, visit: newVisit(), expiresAt: Date.now() - 1 })).toBeNull()
    expect(parseSaved({ version: 1, visit: { note: 12 }, expiresAt: expiry })).toBeNull()
  })
  it('serializes writes and deletion so late writes cannot resurrect deleted data', async () => {
    const write = saveVisit(newVisit(), Date.now() + SEVEN_DAYS)
    const remove = eraseVisit()
    await Promise.all([write, remove])
    expect(await loadVisit()).toBeNull()
  })
})
it('exports only a user confirmed administrative schedule and optional alarm', () => {
  const calendar = calendarContent('2026-10-16', '15:00', true)
  expect(calendar).toContain('DTSTART:20261016T060000Z')
  expect(calendar).toContain('TRIGGER:-PT1H')
  expect(calendarContent('2026-10-16', '15:00', false)).not.toContain('VALARM')
  expect(() => calendarContent('10-16', '15:00', false)).toThrow()
})
