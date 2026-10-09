import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate, todayISO } from '../lib/time';
import { deleteVisit, RETENTION_DAYS, setStorage, useVisit } from '../store/visit';
import { Notice, Screen, Sheet } from '../ui';

/** O04 — 무엇이 어디에 남는지 말하고, 지울 범위를 설명한 뒤 지운다. */
export default function Settings() {
  const visit = useVisit()!;
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  const kept = visit.storage === 'local';

  return (
    <Screen label="이번 진료" title="보관과 삭제" back>
      <section className="section">
        <h2 className="section-title">보관</h2>
        <div className="stack mt16">
          {kept ? (
            <Notice tone="ok" title="이 기기에 보관하고 있어요.">
              {visit.expiresAt && `${formatDate(todayISO(new Date(visit.expiresAt)))}까지 볼 수 있어요.`}
            </Notice>
          ) : (
            <Notice title="보관하지 않고 있어요.">이 창을 닫으면 기록이 사라져요.</Notice>
          )}
          {visit.storageFailed && <Notice tone="error">이 기기에 저장하지 못했어요.</Notice>}
          <button className="btn btn-secondary btn-block" onClick={() => setStorage(kept ? 'session' : 'local')}>
            {kept ? '보관 그만하기' : `${RETENTION_DAYS}일간 보관`}
          </button>
          <ul className="sub" style={{ margin: 0, paddingLeft: 20 }}>
            <li>이 브라우저에만 남아요. 다른 기기에서는 볼 수 없어요.</li>
            <li>대화 소리는 저장하지 않아요. 자막 글자만 남아요.</li>
            <li>브라우저 기록을 지우면 함께 사라져요.</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">삭제</h2>
        <button className="btn btn-danger btn-block mt16" onClick={() => setConfirming(true)}>
          이 진료 기록 지우기
        </button>
      </section>

      <section className="section">
        <h2 className="section-title">개발자용</h2>
        <button className="btn btn-secondary btn-block mt16" onClick={() => navigate('/trace')}>
          AI 실행 기록 보기
        </button>
      </section>

      <Sheet open={confirming} title="이 진료 기록을 지울까요?" onClose={() => setConfirming(false)}>
        <div className="stack">
          <p>준비한 말, 자막, 추가한 자료, 정리한 내용이 모두 지워져요. 되돌릴 수 없어요.</p>
          <p className="sub">이미 내려받은 일정 파일과 캘린더에 넣은 일정은 지워지지 않아요.</p>
          <button className="btn btn-danger btn-block" onClick={deleteVisit}>
            지우기
          </button>
        </div>
      </Sheet>
    </Screen>
  );
}
