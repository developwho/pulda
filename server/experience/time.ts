import type { When } from './types.js';

const WORD: Record<string, number> = {
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12,
};
const PM = ['오후', '저녁', '밤', '낮'];
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

const CLOCK_RE = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/;
const SPOKEN_RE =
  /(오전|오후|아침|저녁|밤|낮|새벽)?\s*(열한|열두|열|한|두|세|네|다섯|여섯|일곱|여덟|아홉|\d{1,2})\s*시(?!간)(?:\s*(반)|\s*(\d{1,2})\s*분)?/;
const DATE_RE = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
const ISO_DATE_RE = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/;
// 자막은 숫자를 한글로 적기도 한다. 예: "시월 십육 일", "삼십 분"
const SINO = '일이삼사오육칠팔구';
const SINO_NUM = '(?:[이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])';
const SINO_DATE_RE = new RegExp(`(시|유|십이|십일|십|[일이삼사오육칠팔구])\\s*월\\s*(${SINO_NUM})\\s*일`);
const SINO_MIN_RE = new RegExp(`^\\s*(${SINO_NUM})\\s*분`);

/** 한글로 적은 1~99의 수를 숫자로 바꾼다. 아니면 NaN. */
export function sinoToNumber(text: string): number {
  const t = text.replace(/\s/g, '');
  if (t === '시') return 10;
  if (t === '유') return 6;
  const m = t.match(/^([이삼사오육칠팔구])?(십)?([일이삼사오육칠팔구])?$/);
  if (!m || !t) return NaN;
  const [, tens, ten, ones] = m;
  if (!ten) return tens && !ones ? SINO.indexOf(tens) + 1 : ones && !tens ? SINO.indexOf(ones) + 1 : NaN;
  return (tens ? SINO.indexOf(tens) + 1 : 1) * 10 + (ones ? SINO.indexOf(ones) + 1 : 0);
}

const pad = (n: number) => String(n).padStart(2, '0');

export interface ParsedTime {
  time?: string;
  /** 오전·오후를 알 수 없음. 추측하지 않는다 (BR-01) */
  ambiguous: boolean;
}

export function parseTime(text: string): ParsedTime | null {
  const clock = text.match(CLOCK_RE);
  if (clock) return { time: `${pad(Number(clock[1]))}:${clock[2]}`, ambiguous: false };

  const m = text.match(SPOKEN_RE);
  if (!m) return null;
  const [, meridiem, hourRaw, half, minRaw] = m;
  let hour = WORD[hourRaw] ?? Number(hourRaw);
  if (Number.isNaN(hour) || hour > 24) return null;
  // "두 시 삼십 분"처럼 분을 한글로 적은 경우
  const sinoMin = !half && !minRaw ? text.slice(m.index! + m[0].length).match(SINO_MIN_RE) : null;
  const minute = half ? 30 : minRaw ? Number(minRaw) : sinoMin ? sinoToNumber(sinoMin[1]) : 0;

  if (!meridiem) {
    if (hour >= 13) return { time: `${pad(hour)}:${pad(minute)}`, ambiguous: false };
    return { ambiguous: true };
  }
  if (PM.includes(meridiem)) {
    if (hour < 12) hour += 12;
  } else if (hour === 12) {
    hour = 0;
  }
  return { time: `${pad(hour)}:${pad(minute)}`, ambiguous: false };
}

export function parseDate(text: string, fallbackYear: number): string | null {
  const iso = text.match(ISO_DATE_RE);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  const m = text.match(DATE_RE);
  const sino = m ? null : text.match(SINO_DATE_RE);
  if (!m && !sino) return null;
  const year = m?.[1] ? Number(m[1]) : fallbackYear;
  const month = m ? Number(m[2]) : sinoToNumber(sino![1]);
  const day = m ? Number(m[3]) : sinoToNumber(sino![2]);
  if (Number.isNaN(month) || Number.isNaN(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const hour12 = h % 12 || 12;
  return `${h < 12 ? '오전' : '오후'} ${hour12}시${m ? ` ${m}분` : ''}`;
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = DAYS[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 ${day}요일`;
}

export function formatDateWithYear(date: string): string {
  return `${date.slice(0, 4)}년 ${formatDate(date)}`;
}

export function formatWhen(when?: When): string {
  if (!when) return '';
  return [when.date && formatDate(when.date), when.time && formatTime(when.time)]
    .filter(Boolean)
    .join(' ');
}

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + days));
}
