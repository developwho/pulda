/** Plain Korean concept groups, not Korean Sign Language glosses or a signing order.
 * KSL has its own grammar: https://www.korean.go.kr/front/page/pageView.do?page_id=P000300
 * Look up actual signs at https://sldict.korean.go.kr/; do not fabricate sign mappings.
 */
export interface EasyExplanation {
  kind: 'ready'
  source: 'dictionary' | 'rules' | 'ai'
  lines: string[]
  chunks: string[]
  reference?: SignReference
}
export type ExplanationResult = EasyExplanation | { kind: 'unavailable'; reason: string }
export interface ExplanationInput {
  text: string
  selected?: string
  context?: string
}
export interface SignReference {
  title: string
  url: string
  components?: string[]
}
export interface EasyTerm {
  word: string
  lines: string[]
  chunks: string[]
  reference?: SignReference
}
const term = (word: string, lines: string[], chunks: string[]): EasyTerm => ({
  word,
  lines,
  chunks,
})

// These are general meanings, never patient-specific advice or a diagnosis.
export const EASY_TERMS: EasyTerm[] = [
  term(
    '위내시경',
    ['입으로 가는 카메라를 넣어요.', '위 안을 보는 검사예요.'],
    ['가는 카메라', '입으로 넣기', '위 안 보기', '검사'],
  ),
  term('위염', ['위 안쪽에 염증이 생긴 상태예요.'], ['위 안쪽', '염증']),
  term('확진', ['어떤 병인지 확인됐다는 뜻이에요.'], ['병', '확인됨']),
  term(
    '의심',
    ['그럴 수 있다는 뜻이에요.', '아직 확실하지 않아요.'],
    ['가능성 있음', '아직 확실하지 않음'],
  ),
  term(
    '고려',
    ['할지 생각하고 있어요.', '아직 하기로 정한 것은 아니에요.'],
    ['할지 생각 중', '아직 결정 안 됨'],
  ),
  term('식후', ['밥을 먹은 뒤예요.'], ['밥 먹기', '그 뒤']),
  term('식전', ['밥을 먹기 전이에요.'], ['밥 먹기 전']),
  term(
    '금식',
    ['정해진 동안 먹는 것을 제한해요.', '물도 안 되는지, 언제부터인지는 병원에 확인해요.'],
    ['먹기 제한', '시간·물 여부 확인 필요'],
  ),
  term('재진', ['진료받은 뒤 다시 진료받는 거예요.'], ['진료', '다시 받기']),
  term('초진', ['처음 진료받는 거예요.'], ['처음', '진료']),
  term('처방', ['의사가 약이나 치료 방법을 정하는 거예요.'], ['의사', '약·치료 방법 정하기']),
  term('복용', ['약을 먹는다는 뜻이에요.'], ['약', '먹기']),
  term('내원', ['병원에 온다는 뜻이에요.'], ['병원', '오기']),
  term('외래', ['입원하지 않고 병원에 와서 진료받아요.'], ['입원 안 함', '병원 방문', '진료']),
  term('입원', ['병원에 머물면서 치료받아요.'], ['병원에 머무르기', '치료']),
  term('퇴원', ['입원 생활을 마치고 병원에서 나와요.'], ['입원 생활 끝', '병원에서 나오기']),
  term('재검', ['검사를 다시 하는 거예요.'], ['검사', '다시 하기']),
  term('경과', ['시간이 지나면서 상태가 어떻게 바뀌는지를 말해요.'], ['시간 지남', '상태 변화']),
  term('호전', ['상태가 전보다 좋아졌다는 뜻이에요.'], ['전보다', '상태 좋아짐']),
  term('악화', ['상태가 전보다 나빠졌다는 뜻이에요.'], ['전보다', '상태 나빠짐']),
  term('증상', ['몸에서 느끼거나 보이는 변화를 말해요.'], ['몸', '느끼거나 보이는 변화']),
  term('통증', ['아픈 느낌을 말해요.'], ['아픈 느낌']),
  term('공복', ['음식을 먹지 않아 속이 빈 상태예요.'], ['음식 안 먹음', '속이 빈 상태']),
  term('용량', ['약을 쓰는 양을 말해요.'], ['약', '쓰는 양']),
  term('복용량', ['먹는 약의 양이에요.'], ['약', '먹는 양']),
  term('간격', ['한 번 하고 다음에 할 때까지의 사이예요.'], ['한 번', '다음 번까지 사이']),
  term('중단', ['하던 것을 멈춘다는 뜻이에요.'], ['하던 것', '멈추기']),
  term('유지', ['지금 상태를 그대로 둔다는 뜻이에요.'], ['지금 상태', '그대로']),
]

// Individually checked on 2026-10-09. Only verified entries get provenance.
// Dictionary combination information is quoted separately, not generated or used as sentence grammar.
// Future API-backed enrichment can populate this field after matching the entry's sense.
const SIGN_REFERENCES: Record<string, SignReference> = {
  입원: {
    title: '국립국어원 한국수어사전 · 입원',
    components: ['진찰', '눕다'],
    url: 'https://sldict.korean.go.kr/front/sign/signContentsView.do?origin_no=8963&top_category=CTE&category=&searchKeyword=%EC%9E%85%EC%9B%90&searchCondition=&search_gubun=&museum_type=00&current_pos_index=0',
  },
  복용량: {
    title: '국립국어원 한국수어사전 · 복용량',
    url: 'https://sldict.korean.go.kr/front/sign/signContentsView.do?origin_no=14445&top_category=-10&category=&searchKeyword=%EB%B3%B5%EC%9A%A9&searchCondition=&search_gubun=&museum_type=00&current_pos_index=',
  },
}
for (const entry of EASY_TERMS) entry.reference = SIGN_REFERENCES[entry.word]

export interface TermSpan {
  start: number
  end: number
  term: EasyTerm
}
export function termSpans(text: string): TermSpan[] {
  const spans: TermSpan[] = []
  // Longest match wins. Preserve offsets so highlighting never changes caption text.
  const sorted = [...EASY_TERMS].sort((a, b) => b.word.length - a.word.length)
  for (let i = 0; i < text.length;) {
    const found = sorted.find((t) => text.startsWith(t.word, i))
    if (found) {
      spans.push({ start: i, end: i + found.word.length, term: found })
      i += found.word.length
    } else i++
  }
  return spans
}

const SENTENCES: Record<string, string[]> = {
  '위염이 의심됩니다': ['위염일 수 있어요.', '아직 확실하지 않아요.'],
  '확진은 아니고, 검사를 해 봐야 알 수 있어요': [
    '병이 확인된 것은 아니에요.',
    '검사를 해야 알 수 있어요.',
  ],
  '위내시경 검사를 고려하고 있어요': [
    '위내시경 검사를 할지 생각 중이에요.',
    '아직 검사하기로 정한 것은 아니에요.',
  ],
  '약을 7일분 드릴게요': ['7일 동안 쓸 양의 약을 드려요.'],
  '하루 두 번, 식후에 드세요': ['하루 두 번 먹어요.', '밥을 먹은 뒤에 먹어요.'],
  '약을 중단하지 마세요': ['약 먹기를 멈추지 마세요.'],
}
export function localExplanation({ text, selected }: ExplanationInput): EasyExplanation | null {
  if (selected) {
    if (selected === '확진' && /확진(?:은|이)?\s*아니/.test(text)) {
      return {
        kind: 'ready',
        source: 'rules',
        lines: ['어떤 병인지 확인된 것은 아니에요.'],
        chunks: ['병이 확인된 것은 아님'],
      }
    }
    const entry = EASY_TERMS.find((t) => t.word === selected && text.includes(t.word))
    return entry
      ? {
          kind: 'ready',
          source: 'dictionary',
          lines: entry.lines,
          chunks: entry.chunks,
          reference: entry.reference,
        }
      : null
  }
  const lines = SENTENCES[text.trim().replace(/[.!?。]+$/, '')]
  return lines
    ? {
        kind: 'ready',
        source: 'rules',
        lines,
        chunks: lines.map((line) => line.replace(/\.$/, '')),
      }
    : null
}

export const EXPLANATION_UNAVAILABLE: ExplanationResult = {
  kind: 'unavailable',
  reason: '지금은 뜻을 정확히 풀기 어려워요. 원문을 보고 의료진에게 다시 물어봐 주세요.',
}

/** Fast, conservative gates. These reject clear drift, not prove clinical correctness. */
export function preservesCriticalMeaning(original: string, lines: string[]): boolean {
  const out = lines.join(' ')
  const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).join('|')
  if (nums(original) !== nums(out)) return false
  const units =
    original.match(/\d+(?:\.\d+)?\s*(?:mg|mL|ml|kg|시간|분|일분|개월|주|일|월|회|번|알|정|시)/g) ??
    []
  if (units.some((unit) => !out.replace(/\s/g, '').includes(unit.replace(/\s/g, '')))) return false
  const counts =
    original.match(/(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(?:번|알|정|시간)/g) ?? []
  if (counts.some((count) => !out.replace(/\s/g, '').includes(count.replace(/\s/g, ''))))
    return false
  const negative = /(?:않|아니|없|마세요|말[아라]|안\s|못\s|금지)/
  if (
    !negative.test(original) &&
    !/(?:의심|가능성|고려|검토|수\s*있)/.test(original) &&
    negative.test(out)
  )
    return false
  const markers = [
    /(?:않|아니|없|말[아라]|마세요|안\s|못\s|금지)/,
    /(?:의심|가능성|수\s*있|확실하지)/,
    /(?:고려|검토|생각\s*중|정한\s*것은\s*아니)/,
    /(?:식전|먹기\s*전)/,
    /(?:식후|먹은\s*뒤|먹고\s*나서)/,
    /(?:오전)/,
    /(?:오후)/,
    /(?:한|두|세|네)\s*(?:번|알|정|시간)/,
  ]
  if (markers.some((re) => re.test(original) && !re.test(out))) return false
  const conditional = original.match(/\S*(?:면|경우)(?:[,\s]|$)/g) ?? []
  if (conditional.some((value) => !out.includes(value.trim().replace(/,$/, '')))) return false
  return true
}
