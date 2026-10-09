import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./ai.js', () => ({ MODEL: 'test-model', client: { responses: { parse: vi.fn() } } }))
import { client } from './ai.js'
import { explainWithModel } from './explain-ai.js'
const parse = vi.mocked(client.responses.parse)
beforeEach(() => parse.mockReset())

describe('caption explanation model boundary', () => {
  it('never waits on a model for dictionary hits', async () => {
    expect(await explainWithModel({ text: '식후에 먹어요.', selected: '식후' })).toMatchObject({
      source: 'dictionary',
    })
    expect(parse).not.toHaveBeenCalled()
  })
  it('uses one bounded request and keeps chunks identical to the approved lines', async () => {
    parse.mockResolvedValue({
      output_parsed: { can_explain: true, lines: ['병원에 다시 와요.'] },
    } as never)
    const signal = new AbortController().signal
    expect(await explainWithModel({ text: '다시 내원해 주세요.' }, signal)).toMatchObject({
      source: 'ai',
      chunks: ['병원에 다시 와요'],
    })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse.mock.calls[0][1]).toMatchObject({ maxRetries: 0, timeout: 7000, signal })
    expect(parse.mock.calls[0][0]).toMatchObject({ store: false })
  })
  it('fails closed on changed dosage or unavailable model', async () => {
    parse.mockResolvedValueOnce({
      output_parsed: { can_explain: true, lines: ['약을 3일 먹어요.'] },
    } as never)
    expect(await explainWithModel({ text: '약을 7일 드세요.' })).toMatchObject({
      kind: 'unavailable',
    })
    parse.mockRejectedValueOnce(new Error('timeout'))
    expect(await explainWithModel({ text: '다시 내원해 주세요.' })).toMatchObject({
      kind: 'unavailable',
    })
  })
})
