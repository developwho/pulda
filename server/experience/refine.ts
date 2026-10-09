export type RefineResult =
  | { kind: 'refined'; text: string }
  | { kind: 'asis'; reason: string }
  | { kind: 'failed'; reason: string };

const PARTS = ['배', '머리', '목', '가슴', '허리', '무릎', '어깨', '귀', '눈', '속', '다리', '팔', '등', '손', '발', '이'];
const SYMPTOMS: [RegExp, string, boolean][] = [
  // [찾는 표현, 문장 끝, 몸 부위가 필요한가]
  [/^(아픔|아파|아프|아파요|통증)$/, '아파요', true],
  [/^(쓰림|쓰려|쓰려요)$/, '쓰려요', true],
  [/^(저림|저려|저려요)$/, '저려요', true],
  [/^(부음|붓기|부었음)$/, '부었어요', true],
  [/^(가려움|가려워)$/, '가려워요', true],
  [/^(어지러움|어지럼|어지러워)$/, '어지러워요', false],
  [/^(기침)$/, '기침이 나요', false],
  [/^(메스꺼움|울렁거림)$/, '속이 메스꺼워요', false],
];
const DURATION_RE = /^(\d+)\s*(일|주|달|개월)(째|전|전부터)?$/;
const TIME_OF_DAY = ['밤', '아침', '저녁', '새벽', '낮', '식후', '식전'];
const WORSE_RE = /^(심함|심해|심해요|더심함)$/;
// 부정·인과·추측은 문장을 바꾸면 뜻이 달라질 수 있어 원문을 유지한다 (FR-002)
const RISKY_RE = /안\s|못\s|없|아니|않|때문|먹고|먹으면|같아|같음|의심/;

function hasFinalConsonant(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

/** 짧은 메모를 뜻을 바꾸지 않는 범위에서만 문장으로 만든다. 확신이 없으면 원문을 둔다. */
export function refineNote(raw: string): RefineResult {
  const text = raw.trim();
  if (!text) return { kind: 'failed', reason: '내용을 먼저 적어 주세요.' };
  if (/(요|다|까)[.?!]?$/.test(text) && text.length > 8) {
    return { kind: 'asis', reason: '이미 잘 전달되는 문장이에요.' };
  }
  if (RISKY_RE.test(`${text} `)) {
    return { kind: 'failed', reason: '뜻이 바뀔 수 있어서 적은 내용을 그대로 두었어요.' };
  }

  const tokens = text.split(/[\s,]+/).filter(Boolean);
  let part: string | undefined;
  let symptom: [string, boolean] | undefined;
  let duration: string | undefined;
  let timeOfDay: string | undefined;
  let worse = false;
  const leftover: string[] = [];

  for (const token of tokens) {
    const bare = token.replace(/(이|가|은|는|에|도)$/, '');
    const sym = SYMPTOMS.find(([re]) => re.test(token));
    const dur = token.match(DURATION_RE);
    if (sym && !symptom) symptom = [sym[1], sym[2]];
    else if (dur && !duration) duration = `${dur[1]}${dur[2]} 전부터`;
    else if (WORSE_RE.test(token)) worse = true;
    else if (TIME_OF_DAY.includes(bare) && !timeOfDay) timeOfDay = bare;
    else if ((PARTS.includes(token) || PARTS.includes(bare)) && !part) part = PARTS.includes(token) ? token : bare;
    else leftover.push(token);
  }

  // 담지 못한 말이 있으면 빠뜨리지 않기 위해 원문을 유지한다
  if (leftover.length || !symptom || (symptom[1] && !part)) {
    return { kind: 'failed', reason: '모든 내용을 담지 못해서 적은 내용을 그대로 두었어요.' };
  }

  const [ending, needsPart] = symptom;
  const subject = needsPart && part ? `${part}${hasFinalConsonant(part) ? '이' : '가'} ` : '';
  const head = duration ? `${duration} ` : '';

  if (timeOfDay && worse) {
    return { kind: 'refined', text: `${head}${subject}${ending}. ${timeOfDay}에 더 심해요.` };
  }
  if (timeOfDay) return { kind: 'refined', text: `${head}${timeOfDay}에 ${subject}${ending}.` };
  if (worse) return { kind: 'refined', text: `${head}${subject}많이 ${ending}.` };
  return { kind: 'refined', text: `${head}${subject}${ending}.` };
}

export interface Term {
  word: string;
  meaning: string;
}

/** 일반적인 낱말 풀이. 개인별 지시를 새로 만들지 않는다 (FR-007). */
const GLOSSARY: Term[] = [
  { word: '위내시경', meaning: '가는 카메라를 입으로 넣어 위 안을 보는 검사예요.' },
  { word: '위염', meaning: '위 안쪽이 붓거나 헐어서 아픈 상태를 말해요.' },
  { word: '확진', meaning: '어떤 병인지 확실하게 정해진 것을 말해요.' },
  { word: '의심', meaning: '그럴 수 있다는 뜻이에요. 아직 확실하지 않아요.' },
  { word: '식후', meaning: '밥을 먹은 뒤를 말해요.' },
  { word: '식전', meaning: '밥을 먹기 전을 말해요.' },
  { word: '금식', meaning: '정해진 시간 동안 음식을 먹지 않는 것을 말해요.' },
  { word: '재진', meaning: '같은 병원에 다시 가서 진료받는 것을 말해요.' },
  { word: '처방', meaning: '의사가 먹을 약을 정해 주는 것을 말해요.' },
  { word: '복용', meaning: '약을 먹는 것을 말해요.' },
  { word: '고려', meaning: '할지 말지 생각하고 있다는 뜻이에요. 아직 정해지지 않았어요.' },
];

export function explainTerms(text: string): Term[] {
  return GLOSSARY.filter((t) => text.includes(t.word));
}
