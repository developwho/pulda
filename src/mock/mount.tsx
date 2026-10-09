import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';
import App from '../experience/App';
import { captions } from '../experience/store/captions';
import { addSource, deleteVisit, finishConsult, getVisit, mutate, startVisit, useVisit } from '../experience/store/visit';
import { MOCK_CASE } from './fixtures';
import '../experience/styles/app.css';
import '../experience/styles/brand.css';
import './toolbar.css';

function Controls() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [resetting, setResetting] = useState(false);
  const visit = useVisit();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const handler = (event: Event) => setNotice((event as CustomEvent<string>).detail);
    window.addEventListener('pulda-mock-notice', handler);
    return () => window.removeEventListener('pulda-mock-notice', handler);
  }, []);
  const reset = () => {
    captions.stop(); deleteVisit();
    try {
      for (const storage of [localStorage, sessionStorage]) {
        for (let i = storage.length - 1; i >= 0; i--) { const key = storage.key(i); if (key?.startsWith('pulda.mock.')) storage.removeItem(key); }
      }
    } catch { /* Reload also resets an in-memory-only presentation. */ }
    location.replace(`${location.pathname}#/welcome`); location.reload();
  };
  const seed = (stage: 'preparing' | 'consulting' | 'aftercare') => {
    captions.stop(); startVisit({ demo: true, stage });
    if (stage !== 'preparing') mutate(v => { v.notes = [{ id: 'mock-note', raw: MOCK_CASE.note, text: '3일 전부터 배가 아프고, 밤에 더 심해요.', chosen: 'refined' }]; });
    if (stage === 'aftercare') {
      mutate(v => { v.segments = MOCK_CASE.consultation.map((text, i) => ({ id: `mock-caption-${i}`, text, status: 'final', origin: 'caption', at: Date.now() })); });
      finishConsult(); addSource('handout', MOCK_CASE.handout);
    }
    navigate(stage === 'preparing' ? '/prepare' : stage === 'consulting' ? '/consult' : '/after');
    setOpen(false);
  };
  const completeCaptions = () => {
    captions.stop();
    mutate(v => { const texts = new Set(v.segments.map(s => s.text)); MOCK_CASE.consultation.forEach((text, i) => { if (!texts.has(text)) v.segments.push({ id: `mock-fast-${i}`, text, origin: 'caption', status: 'final', at: Date.now() }); }); });
    setNotice('남은 예시 자막을 채웠어요. 화면의 ‘진료 마치기’로 계속 진행해 주세요.');
  };
  const hint = pathname === '/concierge' ? '채워진 조건으로 검색 → 병원 선택 → 문의문 확인 → 문의를 마쳤어요 → 받은 답변 확인 → 확정 일정 기록 → 진료 준비'
    : pathname === '/prepare' ? '채워진 메모를 정리하고 사용할 문장을 선택한 뒤 진료를 시작해 주세요.'
      : pathname === '/consult' ? '기존 시작 버튼으로 예시 자막이 재생돼요. 모두 읽은 뒤 진료 마치기 → 자료 추가로 안내문을 받아보세요.'
        : pathname.startsWith('/after') ? '안내문 추가 → 시간 차이 확인 → 병원 질문 → 가상 답변 반영 → 검사 예약 문의·확정 → 일정 파일 수령'
          : '기존 서비스 화면 그대로예요. 가입·로그인도 예시로 진행하고 ‘병원 찾기’부터 시작해 주세요.';
  return <aside className="mock-toolbar" aria-label="목업 시연 도구">
    <div className="mock-toolbar-row"><strong>목업 모드</strong><span>가상 데이터 · 실제 전송 없음</span><button aria-expanded={open} onClick={() => setOpen(!open)}>시연 도구</button></div>
    {open && <div className="mock-tools"><p>{hint}</p><p className="mock-tool-note">가상의 김하늘님 · 복통으로 내과 방문 → 안내 시간 차이 확인 → 검사 예약. 아래 바로가기는 목업 진료 데이터를 해당 장면의 예시로 다시 채웁니다.</p><div className="mock-tool-buttons"><button onClick={() => { navigate('/concierge'); setOpen(false); }}>병원 예약 화면</button><button onClick={() => seed('preparing')}>준비 사례 채우기</button><button onClick={() => seed('consulting')}>대화 사례 채우기</button><button onClick={() => seed('aftercare')}>진료 후 사례 채우기</button>{visit && pathname === '/consult' && <button onClick={completeCaptions}>남은 자막 채우기</button>}</div><button onClick={() => setResetting(true)}>목업만 처음부터</button>{resetting && <div role="alert"><p>목업 진행만 지우고 처음부터 시작할까요?</p><button onClick={reset}>초기화하고 시작</button><button onClick={() => setResetting(false)}>취소</button></div>}</div>}
    {notice && <div className="mock-tool-notice" role="status">{notice}<button aria-label="목업 알림 닫기" onClick={() => setNotice('')}>닫기</button></div>}
  </aside>;
}

// Fresh sessions enter the exact same welcome/onboarding flow as the real service.
if (!location.hash) location.hash = getVisit() ? `#/${getVisit()!.stage === 'preparing' ? 'prepare' : getVisit()!.stage === 'consulting' ? 'consult' : 'after'}` : '#/welcome';
createRoot(document.getElementById('root')!).render(<StrictMode><HashRouter><Controls /><App /></HashRouter></StrictMode>);
