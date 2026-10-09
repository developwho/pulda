import { isMockMode } from '../experience/runtime';
// Entirely synthetic. Dates are anchored once per session so repeat presentations stay usable.
const KEY = 'pulda.mock.case-date';
function anchor() {
  if (!isMockMode) return '2026-10-11';
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
  } catch { /* Restricted storage still permits an in-memory demo. */ }
  const d = new Date(); d.setDate(d.getDate() + 2);
  d.setDate(d.getDate() + (3 - d.getDay() + 7) % 7); // Next Wednesday, at least two days away.
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try { sessionStorage.setItem(KEY, date); } catch { /* optional */ }
  return date;
}
export const FIRST_DATE = anchor();
const next = new Date(`${FIRST_DATE}T12:00:00+09:00`); next.setDate(next.getDate() + 7);
export const NEXT_DATE = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
export const dateText = (date: string) => `${Number(date.slice(0, 4))}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`;
export const MOCK_CASE = {
  name: '김하늘',
  appointment: { hospital: '한빛내과의원 (가상)', dept: '소화기내과', date: FIRST_DATE, time: '10:30' },
  query: '글로 안내받을 수 있는 가까운 내과를 찾아줘',
  preferredTime: `${dateText(FIRST_DATE)} 오전 10시 30분`,
  note: '배 아픔 3일 밤 심함',
  reply: `${dateText(FIRST_DATE)} 오전 10시 30분 소화기내과 진료 예약을 확인했어요. 접수할 때 김하늘님 성함을 알려주세요. 글로 안내해 드릴게요. (가상 병원 답변)`,
  consultation: [
    '어디가 불편해서 오셨어요?', '위염이 의심됩니다.', '확진은 아니고, 검사를 해 봐야 알 수 있어요.',
    '위내시경 검사를 고려하고 있어요.', '약을 7일분 드릴게요.', '하루 두 번, 식후에 드세요.',
    '맵고 짠 음식과 커피는 당분간 피하세요.', `다음 진료는 ${dateText(NEXT_DATE)} 오후 2시에 오세요.`,
  ],
  handout: ['한빛내과의원 진료 안내 (가상)', `다음 방문: ${dateText(NEXT_DATE)} 15:00`, '소화기내과 2진료실, 1층 원무과에서 접수', '처방: 위장약 7일분, 1일 2회 식후 30분'].join('\n'),
};
