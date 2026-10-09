import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalysisInput, prepareNote, validateEvidence } from './analysis'
import { createSession, csrf, readSession } from './session'
import { consume } from './limits'

const sources = [
  {
    id: 's1',
    kind: 'patient_note' as const,
    text: '열은 없어요. 오른쪽 배가 3일 아파요. 원인은 모르겠어요.',
  },
]
afterEach(() => vi.restoreAllMocks())
describe('preparation preserves patient meaning', () => {
  const response = (value: unknown) =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
      }),
      { status: 200 },
    )
  it('rejects changed numbers before a candidate reaches the patient', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ candidate: '4일 아파요.' }))
    await expect(prepareNote('3일 아픔')).rejects.toThrow('MEANING_UNVERIFIED')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects a candidate when the separate meaning review fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ candidate: '열이 있어요.' }))
      .mockResolvedValueOnce(response({ faithful: false }))
    await expect(prepareNote('열 없음')).rejects.toThrow('MEANING_UNVERIFIED')
  })
  it('never requests stored Responses output and only returns reviewed text', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ candidate: '열은 없어요.' }))
      .mockResolvedValueOnce(response({ faithful: true }))
    expect(await prepareNote('열 없음')).toEqual({ candidate: '열은 없어요.' })
    for (const call of fetcher.mock.calls)
      expect(JSON.parse(String(call[1]?.body)).store).toBe(false)
  })
})
describe('evidence boundary', () => {
  it('rejects invented quotes, wrong sources and incomplete transcripts', () => {
    for (const evidence of [
      { sourceId: 's1', quote: '열이 있어요.' },
      { sourceId: 'unknown', quote: '열은 없어요.' },
    ]) {
      expect(() =>
        validateEvidence({ items: [{ kind: 'action', evidence: [evidence] }] }, sources),
      ).toThrow()
    }
    expect(() =>
      validateEvidence(
        { items: [{ kind: 'fact', evidence: [{ sourceId: 's1', quote: '열은 없어요.' }] }] },
        [{ ...sources[0], incomplete: true }],
      ),
    ).toThrow()
  })
  it('preserves quoted negation and requires two pieces of evidence for conflicts', () => {
    const item = { kind: 'fact', evidence: [{ sourceId: 's1', quote: sources[0].text }] }
    expect(validateEvidence({ items: [item] }, sources).items[0].evidence[0].quote).toBe(
      sources[0].text,
    )
    expect(() => validateEvidence({ items: [{ ...item, kind: 'conflict' }] }, sources)).toThrow()
  })
  it('rejects duplicate source IDs and oversized sessions', () => {
    expect(AnalysisInput.safeParse({ sources: [...sources, ...sources] }).success).toBe(false)
    expect(
      AnalysisInput.safeParse({
        sources: Array.from({ length: 6 }, (_, i) => ({
          ...sources[0],
          id: String(i),
          text: '가'.repeat(12000),
        })),
      }).success,
    ).toBe(false)
  })
})
describe('anonymous session boundary', () => {
  it('accepts signed cookies and rejects changes and expiry', () => {
    const session = createSession()
    expect(readSession(`pulda=${session}`)).toBe(session)
    expect(readSession(`pulda=${session.slice(0, -1)}x`)).toBeNull()
    expect(readSession(`pulda=${session.replace(/\.\d+\./, '.1.')}`)).toBeNull()
    expect(csrf(session)).not.toBe(csrf(createSession()))
  })
  it('bounds usage without storing patient content', async () => {
    const key = `test-${crypto.randomUUID()}`
    expect(await consume(key, 1, 3600)).toBe(true)
    expect(await consume(key, 1, 3600)).toBe(false)
  })
})
