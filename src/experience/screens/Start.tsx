import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from '../BrandMark';
import { checkAccessCode, getAccessCode, serverStatus } from '../agent';
import { dismissExpired, RETENTION_DAYS, startVisit, useStore } from '../store/visit';
import { Notice } from '../ui';
import Guide from './Guide';

const STEPS = ['할 말을 미리 준비해요', '진료 중 자막을 읽어요', '진료 후 할 일을 정리해요'];

export default function Start({ showGuide = false, onGuideFinish = () => {} }: { showGuide?: boolean; onGuideFinish?: () => void }) {
  const expired = useStore((s) => s.expired);
  // 공개 주소에서는 접근 코드를 아는 사람만 AI 기능을 쓴다
  const [gate, setGate] = useState<'checking' | 'open' | 'locked' | 'offline'>('checking');
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    void (async () => {
      const status = await serverStatus();
      if (!status) return setGate('offline');
      if (!status.locked) return setGate('open');
      setGate(getAccessCode() && (await checkAccessCode(getAccessCode())) ? 'open' : 'locked');
    })();
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await checkAccessCode(code.trim()).catch(() => false);
    setWrong(!ok);
    if (ok) setGate('open');
  };

  return (
    <div className="screen">
      <header className="bar">
        <span className="bar-label brand">
          <BrandMark />
        </span>
      </header>
      <main className="body">
        <h1 className="title" tabIndex={-1}>병원 진료를 함께 준비해요.</h1>

        <ol className="steps" aria-label="풀다가 돕는 일">
          {STEPS.map((step, i) => (
            <li key={step} data-tour-step={i}>
              <span className="step-num" aria-hidden>
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>

        {expired && (
          <div className="mt16">
            <Notice title={`보관한 지 ${RETENTION_DAYS}일이 지나 기록을 지웠어요.`}>
              <button className="btn-text" onClick={dismissExpired}>
                확인했어요
              </button>
            </Notice>
          </div>
        )}

        {gate === 'offline' && (
          <div className="mt16">
            <Notice tone="warn" title="AI에 연결하지 못했어요.">기본 기능만 쓸 수 있어요. 인터넷 연결을 확인해 주세요.</Notice>
          </div>
        )}
        {gate === 'locked' && (
          <form className="panel stack mt24" onSubmit={unlock}>
            <div className="field">
              <label htmlFor="access-code">접근 코드</label>
              <input id="access-code" className="input" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
              <p className="hint">안내받은 코드를 넣으면 시작할 수 있어요.</p>
            </div>
            {wrong && <Notice tone="error">코드가 맞지 않아요. 다시 확인해 주세요.</Notice>}
            <button className="btn btn-primary btn-block" type="submit" disabled={!code.trim()}>
              확인
            </button>
          </form>
        )}

        <div className="stack mt24" hidden={gate === 'locked' || gate === 'checking'}>
          <Link to="/concierge" className="concierge-entry"><strong>병원 찾기부터 도와드릴게요</strong><span>조건에 맞는 병원을 찾고 전화·문자 문의를 준비해요.</span></Link>
          <button className="btn btn-primary btn-block" onClick={() => startVisit()}>
            진료 준비하기
          </button>
        </div>

        <div className="btn-row mt16" hidden={gate === 'locked' || gate === 'checking'}>
          <button className="btn-text" onClick={() => startVisit({ stage: 'consulting' })}>
            지금 진료 중이에요
          </button>
          <button className="btn-text" onClick={() => startVisit({ stage: 'aftercare' })}>
            진료를 마쳤어요
          </button>
        </div>

        <section className="section panel" aria-labelledby="demo-title" hidden={gate === 'locked' || gate === 'checking'}>
          <h2 id="demo-title" className="item-title">
            예시로 먼저 보기
          </h2>
          <p className="sub mt8">만든 예시 진료로 처음부터 끝까지 볼 수 있어요. 실제 진료 내용이 아니에요.</p>
          <button className="btn btn-soft btn-block mt16" onClick={() => startVisit({ demo: true })}>
            예시 진료 열기
          </button>
        </section>
      </main>

      {showGuide && <Guide onFinish={onGuideFinish} />}
    </div>
  );
}
