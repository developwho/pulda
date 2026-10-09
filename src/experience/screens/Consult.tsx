import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AArrowDown, AArrowUp, ArrowDown, Captions, Loader2, Mic, Pause, PenLine, ShieldCheck, UserRound,
} from 'lucide-react';
import { createExplanationSession, termSpans, type ExplanationInput } from '../agent/explain';
import ExplanationCard from './ExplanationCard';
import '../styles/explanation.css';
import { QUICK_PHRASES } from '../lib/demo';
import { captions, useCaptions, type CaptionError } from '../store/captions';
import { finishConsult, setPresenting, useVisit } from '../store/visit';
import { Notice, Screen, Sheet, TabBar } from '../ui';

const SIZES = [22, 26, 30];

/** 자막에서 꼭 다시 확인해야 하는 날짜·시간·횟수를 굵게 보여준다. 글자는 바꾸지 않는다. */
const KEY_RE = /(\d+\s*월\s*\d+\s*일|\d{1,2}:\d{2}|(?:오전|오후)\s*(?:\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열한|열두|열)\s*시(?:\s*\d+\s*분|\s*반)?|하루\s*\S+\s*번|\d+\s*(?:일분|일|주|번|회|알|정))/g;
function emphasize(text: string) {
  return text.split(KEY_RE).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

function CaptionWords({ text }: { text: string }) {
  const spans = termSpans(text);
  let end = 0;
  return <>{spans.map(span => {
    const before = text.slice(end, span.start);
    end = span.end;
    return <span key={span.start}>{emphasize(before)}<span className="caption-term" data-explain-term={span.term.word}>{span.term.word}</span></span>;
  })}{emphasize(text.slice(end))}</>;
}

const ERROR_TEXT: Record<CaptionError, string> = {
  MIC_DENIED: '마이크를 사용할 수 없어요. 글로 소통할 수 있어요.',
  STREAM_LOST: '연결이 끊겨 이 구간의 자막이 없어요.',
  UNSUPPORTED: '이 브라우저는 자막을 지원하지 않아요. 글로 소통할 수 있어요.',
};
const PAUSE_TEXT = {
  user: '자막이 멈춰 있어요',
  present: '보여주는 동안 자막을 멈췄어요',
  explain: '설명을 보는 동안 자막을 멈췄어요',
  leave: '다른 화면에 있는 동안 자막을 멈췄어요',
};

/** O01 — 시작을 고르기 전에는 소리를 모으지도 마이크 권한을 묻지도 않는다. */
function CaptionConsent({ onStart, onSkip }: { onStart: (mode: 'mic' | 'demo') => void; onSkip: () => void }) {
  const navigate = useNavigate();
  return (
    <Screen label="진료 중" tabs>
      <Sheet open title="자막을 켤까요?" className="caption-consent" onClose={() => navigate('/prepare')}>
        <ul className="caption-intro-list">
          <li><Mic aria-hidden /><span>대화 내용을 <br />실시간 글자로 바꿔요</span></li>
          <li><ShieldCheck aria-hidden /><span>풀다는 음성을 저장하지 않아요. <br />변환된 텍스트만 검토해요.</span></li>
          <li><UserRound aria-hidden /><span>시작하기 전에 의료진에게 먼저 알리고 <br />괜찮은지 물어봐주세요.</span></li>
        </ul>
        <p className="caption-intro-caution">* 자동 자막은 잘못 들을 수 있어요. <br />날짜와 숫자는 꼭 다시 확인해요.</p>
        <div className="caption-intro-actions">
          <p className="hint">시작하면 음성을 OpenAI에 보내요.</p>
          <details className="record-disclosure">
            <summary>음성 처리와 보관 안내</summary>
            <p className="hint">시작하면 마이크 음성을 OpenAI에 보내 글자로 바꿔요. 풀다는 음성을 보관하지 않아요. OpenAI는 오용 방지를 위해 최대 30일 보관할 수 있어요. 멈추거나 다른 화면으로 이동하면 음성 전송을 멈춰요.</p>
          </details>
          <button className="btn btn-primary btn-block" onClick={() => onStart('mic')}>확인하고 시작하기</button>
          <button className="btn btn-quiet btn-block" onClick={onSkip}>글로만 소통하기</button>
          <details className="caption-demo">
            <summary>마이크 없이 예시로 체험하기</summary>
            <p className="hint">만든 예시 대화예요. 소리를 모으지 않아요.</p>
            <button className="btn btn-secondary btn-block" onClick={() => onStart('demo')}>예시 대화로 자막 보기</button>
          </details>
        </div>
      </Sheet>
    </Screen>
  );
}
export default function Consult() {
  const visit = useVisit()!;
  const cap = useCaptions();
  const navigate = useNavigate();
  const [consent, setConsent] = useState(visit.segments.length === 0 && cap.status === 'off');
  const [size, setSize] = useState(0);
  const [explanation, setExplanation] = useState<(ExplanationInput & { segmentId: string }) | null>(null);
  const explanationSession = useMemo(() => createExplanationSession(), [visit.id]);
  const explanationOpener = useRef<HTMLElement | null>(null);
  const [sheet, setSheet] = useState<'say' | 'finish' | null>(null);
  const [text, setText] = useState('');
  const [unseen, setUnseen] = useState(0);
  const captionCount = visit.segments.filter(seg => seg.status === 'final').length;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seen = useRef(captionCount);

  // 화면을 떠나면 수집을 멈춘다. 돌아와도 스스로 다시 켜지 않는다.
  useEffect(() => () => captions.pause('leave'), []);

  // 최신 문장을 보고 있을 때만 따라 내려간다. 이전 문장을 읽는 중에는 움직이지 않는다.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!explanation && stick.current) {
      el.scrollTop = el.scrollHeight;
      seen.current = captionCount;
    } else {
      setUnseen(Math.max(0, captionCount - seen.current));
    }
  }, [captionCount, cap.interim, explanation]);

  if (consent) {
    return (
      <CaptionConsent
        onStart={(mode) => {
          setConsent(false);
          captions.start(mode);
        }}
        onSkip={() => setConsent(false)}
      />
    );
  }

  const onScroll = () => {
    if (explanation) { stick.current = false; return; }
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current) {
      seen.current = captionCount;
      setUnseen(0);
    }
  };
  const toLatest = () => {
    setExplanation(null);
    stick.current = true;
    setUnseen(0);
    seen.current = captionCount;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  };

  const showToOther = (line: string) => {
    captions.pause('present');
    setSheet(null);
    setText('');
    setPresenting([line]);
    navigate('/present');
  };
  const finish = () => {
    captions.stop();
    finishConsult();
    navigate('/after');
  };
  const openExplanation = (id: string, selected?: string) => {
    const index = visit.segments.findIndex(seg => seg.id === id);
    const segment = visit.segments[index];
    if (!segment || segment.status !== 'final') return;
    if (!explanation) explanationOpener.current = document.activeElement as HTMLElement;
    stick.current = false;
    const context = visit.segments.slice(Math.max(0, index - 2), index).filter(seg => seg.status === 'final').map(seg => seg.text).join('\n').slice(-1200);
    setExplanation({ segmentId: id, text: segment.text, selected, context });
  };
  const closeExplanation = () => { setExplanation(null); explanationOpener.current?.focus({ preventScroll: true }); };

  const statusText =
    cap.status === 'live'
      ? `자막 사용 중${cap.mode === 'demo' ? ' · 예시 대화' : ''}`
      : cap.status === 'connecting'
        ? '자막 연결 중'
        : cap.status === 'paused'
          ? PAUSE_TEXT[cap.pauseReason ?? 'user']
          : cap.status === 'failed'
            ? ERROR_TEXT[cap.error ?? 'STREAM_LOST']
            : '자막 없이 글로 소통하고 있어요';
  const StatusIcon = cap.status === 'live' ? Captions : cap.status === 'connecting' ? Loader2 : cap.status === 'off' ? PenLine : Pause;
  const hasContent = captionCount > 0 || cap.interim;
  const latestId = visit.segments.filter((seg) => seg.status === 'final').at(-1)?.id;

  return (
    <div className="screen consult" style={{ ['--caption-size' as string]: `${SIZES[size]}px` }}>
      <header className="bar">
        <h1 className="bar-label" style={{ color: 'var(--ink)', fontSize: 20 }}>
          진료 중
        </h1>
        <button className="icon-btn" disabled={size === 0} onClick={() => setSize(size - 1)} aria-label="글자 작게">
          <AArrowDown size={24} aria-hidden />
        </button>
        <button className="icon-btn" disabled={size === SIZES.length - 1} onClick={() => setSize(size + 1)} aria-label="글자 크게">
          <AArrowUp size={24} aria-hidden />
        </button>
      </header>

      <div className={`status ${cap.status}`} role="status">
        <StatusIcon size={22} aria-hidden className={cap.status === 'connecting' ? 'spin' : undefined} />
        <span className="grow">{statusText}</span>
      </div>

      <div className="captions" ref={scroller} onScroll={onScroll}>
        {!hasContent && (
          <p className="sub" style={{ marginTop: 24 }}>
            {cap.status === 'off' ? '자막을 켜면 여기에 대화가 나와요.' : '말소리가 들리면 여기에 자막이 나와요.'}
          </p>
        )}
        {hasContent && <span className="cap-meta">진료 대화 · 자동 자막은 잘못 들을 수 있어요</span>}
        {visit.segments.map((seg) =>
          seg.status === 'gap' ? null : (
            <div key={seg.id} className={`caption-entry${explanation?.segmentId === seg.id ? ' selected' : ''}`}>
              <button
                className={`cap${seg.origin === 'typed' ? ' typed' : ''}${seg.id === latestId ? ' latest' : ''}`}
                aria-expanded={explanation?.segmentId === seg.id}
                aria-controls="caption-explanation"
                onClick={event => {
                  const word = (event.target as HTMLElement).closest<HTMLElement>('[data-explain-term]')?.dataset.explainTerm;
                  openExplanation(seg.id, word);
                }}
              >
                {seg.origin === 'typed' && <span className="cap-meta">글로 적은 말</span>}
                <CaptionWords text={seg.text} />
              </button>
            </div>
          ),
        )}
        {cap.interim && (
          <p className="cap interim" aria-hidden>
            {cap.interim}
          </p>
        )}
        {unseen > 0 && !explanation && (
          <button className="btn btn-primary btn-sm new-caps" onClick={toLatest}>
            <ArrowDown size={18} aria-hidden />새 자막 {unseen}개 보기
          </button>
        )}
      </div>

      {explanation && <div id="caption-explanation" className="explanation-dock"><ExplanationCard key={`${explanation.segmentId}:${explanation.selected ?? ''}`} input={explanation} session={explanationSession} unseen={unseen} close={closeExplanation} latest={toLatest} explainSentence={() => openExplanation(explanation.segmentId)} ask={() => {
        setText(`“${explanation.selected || explanation.text}”을 더 쉬운 말로 설명해 주세요.`);
        closeExplanation(); setSheet('say');
      }} /></div>}

      <div className="controls">
        <div className="controls-row consult-actions">
          <button className="btn btn-secondary" onClick={() => setSheet('say')}>
            내 말 보여주기
          </button>
          {cap.status === 'live' || cap.status === 'connecting' ? (
            <button className="btn btn-secondary" onClick={() => captions.pause('user')}>
              자막 멈추기
            </button>
          ) : cap.status === 'off' ? (
            <button className="btn btn-secondary" onClick={() => setConsent(true)}>
              자막 켜기
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => captions.resume()}>
              자막 다시 시작
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setSheet('finish')}>
            진료 마치기
          </button>
        </div>
      </div>
      <TabBar />

      <Sheet open={sheet === 'say'} title="내 말 보여주기" onClose={() => setSheet(null)}>
        <div className="stack-sm">
          {[...visit.notes.map((n) => n.text), ...QUICK_PHRASES].map((line) => (
            <button key={line} className="choice" onClick={() => showToOther(line)}>
              {line}
            </button>
          ))}
          <div className="field mt16">
            <label htmlFor="say-new">새로 적기</label>
            <textarea id="say-new" className="textarea" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block" disabled={!text.trim()} onClick={() => showToOther(text.trim())}>
            크게 보여주기
          </button>
          <p className="hint">보여주는 동안에는 자막을 멈춰요.</p>
        </div>
      </Sheet>

      <Sheet open={sheet === 'finish'} title="진료를 마칠까요?" onClose={() => setSheet(null)}>
        <div className="stack">
          <p>자막을 끄고, 지금까지의 대화를 정리해요.</p>
          {visit.segments.some((s) => s.status === 'gap') && (
            <Notice tone="warn">자막이 멈춘 구간은 정리에서 빠져요.</Notice>
          )}
          <button className="btn btn-primary btn-block" onClick={finish}>
            마치고 정리하기
          </button>
        </div>
      </Sheet>
    </div>
  );
}
