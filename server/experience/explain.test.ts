import { describe, expect, it } from 'vitest'
import { localExplanation, preservesCriticalMeaning, termSpans } from './explain.js'

describe('instant caption meanings', () => {
  it('keeps exact caption text and selects the longer term once', () => {
    const text = '위내시경 검사를 고려하고 있어요. 복용은 식후에 해요.'
    const spans = termSpans(text)
    expect(spans.map((span) => span.term.word)).toEqual(['위내시경', '고려', '복용', '식후'])
    for (const span of spans) expect(text.slice(span.start, span.end)).toBe(span.term.word)
    expect(spans.every((span, i) => i === 0 || spans[i - 1].end <= span.start)).toBe(true)
  })
  it('provides short concept groups without claiming a signing order', () => {
    expect(localExplanation({ text: '약 복용 안내', selected: '복용' })).toMatchObject({
      source: 'dictionary',
      chunks: ['약', '먹기'],
    })
    expect(localExplanation({ text: '처음 듣는 표현이에요' })).toBeNull()
  })
  it('attaches dictionary provenance only to individually checked entries', () => {
    expect(localExplanation({ text: '입원할 수 있어요.', selected: '입원' })).toMatchObject({
      reference: { components: ['진찰', '눕다'] },
    })
    expect(localExplanation({ text: '식후에 먹어요.', selected: '식후' })).not.toHaveProperty(
      'reference.url',
    )
    expect(termSpans('복용량을 확인해요.').map((span) => span.term.word)).toEqual(['복용량'])
  })
  it('does not turn a negative diagnosis into a positive definition', () => {
    expect(
      localExplanation({ text: '확진은 아니고 검사가 필요해요.', selected: '확진' }),
    ).toMatchObject({ chunks: ['병이 확인된 것은 아님'] })
  })
  it('only applies sentence templates to a complete exact match', () => {
    expect(localExplanation({ text: '위염이 의심됩니다.' })).toMatchObject({
      source: 'rules',
      lines: ['위염일 수 있어요.', '아직 확실하지 않아요.'],
    })
    expect(localExplanation({ text: '위염이 의심됩니다. 하지만 아닐 수도 있어요.' })).toBeNull()
    expect(localExplanation({ text: '위염이 의심되지 않습니다.' })).toBeNull()
  })
})

describe('critical meaning guards', () => {
  it.each([
    ['약을 7일 먹어요.', ['약을 3일 먹어요.']],
    ['1mg을 먹어요.', ['1g을 먹어요.']],
    ['하루 두 번 먹어요.', ['하루 세 번 먹어요.']],
    ['약을 중단하지 마세요.', ['약을 멈춰요.']],
    ['약을 드세요.', ['약을 먹지 마세요.']],
    ['식전에 먹어요.', ['밥을 먹은 뒤에 먹어요.']],
    ['오후 2시에 와요.', ['오전 2시에 와요.']],
    ['아프면 오세요.', ['병원에 와요.']],
    ['통증이 있으면 병원에 와요.', ['병원에 와요.']],
    ['위염이 의심됩니다.', ['위염이에요.']],
  ])('rejects a changed number, condition or certainty: %s', (original, lines) => {
    expect(preservesCriticalMeaning(original, lines)).toBe(false)
  })
  it('accepts a short explanation that retains uncertainty and instructions', () => {
    expect(
      preservesCriticalMeaning('위염이 의심됩니다.', [
        '위염일 수 있어요.',
        '아직 확실하지 않아요.',
      ]),
    ).toBe(true)
    expect(
      preservesCriticalMeaning('식후 30분에 하루 두 번 드세요.', [
        '식후 30분에 먹어요.',
        '하루 두 번 먹어요.',
      ]),
    ).toBe(true)
  })
})
