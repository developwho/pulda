/* 모든 내용은 시연을 위해 만든 합성 예시다. 실제 병원·진료·의료 안내가 아니다. */
import { isMockMode } from '../runtime';
import { MOCK_CASE } from '../../mock/fixtures';

export const DEMO_APPOINTMENT = isMockMode ? MOCK_CASE.appointment : {
  hospital: '한빛내과의원',
  dept: '소화기내과',
  date: '2026-10-09',
  time: '10:30',
};

export const DEMO_NOTE = isMockMode ? MOCK_CASE.note : '배 아픔 3일 밤 심함';

export const DEMO_CONSULT = isMockMode ? MOCK_CASE.consultation : [
  '어디가 불편해서 오셨어요?',
  '위염이 의심됩니다.',
  '확진은 아니고, 검사를 해 봐야 알 수 있어요.',
  '위내시경 검사를 고려하고 있어요.',
  '약을 7일분 드릴게요.',
  '하루 두 번, 식후에 드세요.',
  '맵고 짠 음식과 커피는 당분간 피하세요.',
  '다음 진료는 10월 16일 금요일 오후 2시에 오세요.',
];

export const DEMO_HANDOUT = isMockMode ? MOCK_CASE.handout : [
  '한빛내과의원 진료 안내',
  '다음 방문: 2026년 10월 16일(금) 15:00',
  '소화기내과 2진료실, 1층 원무과에서 접수',
  '처방: 위장약 7일분, 1일 2회 식후 30분',
].join('\n');

export const REQUEST_OPTIONS = [
  '소리를 듣기 어려워요. 글로 적어 주세요.',
  '이름을 부를 때 직접 와서 알려 주세요.',
  '천천히, 입 모양이 보이게 말해 주세요.',
  '수어통역 지원을 요청하고 싶어요.',
];

export const QUICK_PHRASES = ['다시 설명해 주세요.', '잠시만 기다려 주세요.', '글로 적어 주세요.', '이해했어요. 고맙습니다.'];
