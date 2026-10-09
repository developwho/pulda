import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import '../styles/onboarding.css';
import { storageKey } from '../runtime';

const GUIDE_KEY = storageKey('pulda-first-use-guide-v1');
let completedInMemory = false;

export function hasCompletedGuide() {
  try { return completedInMemory || localStorage.getItem(GUIDE_KEY) === 'done'; }
  catch { return completedInMemory; }
}

const STEPS = [
  { title: '할 말을 미리 준비해요', description: '짧게 적은 말을 정리하고, 의료진에게 큰 글씨로 보여줄 수 있어요.' },
  { title: '설명은 자막으로 읽어요', description: '진료 중에는 자막을 읽고, 글로 대답해요. 자막은 내가 시작할 때만 켜져요.' },
  { title: '다음 할 일을 확인해요', description: '진료가 끝나면 받은 안내와 할 일을 모아 봐요. 헷갈리는 내용은 병원에 다시 물어봐요.' },
];

/** 실제 시작 화면 위에 처음 한 번만 띄우는 안내. 진료/마이크를 시작하지 않는다. */
export default function Guide({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 0, height: 0, cardTop: 0, cardLeft: 0, arrow: 0, above: false });

  useLayoutEffect(() => {
    const node = dialog.current!;
    node.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-tour-step="${step}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    const position = () => {
      const rect = target.getBoundingClientRect();
      const width = card.current?.offsetWidth ?? 320;
      const height = card.current?.offsetHeight ?? 230;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const above = rect.bottom + height + 36 > viewportHeight && rect.top > height + 36;
      const cardLeft = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
      const preferredTop = above ? rect.top - height - 24 : rect.bottom + 24;
      setPlacement({ top: rect.top - 8, left: rect.left - 8, width: rect.width + 16, height: rect.height + 16,
        cardTop: Math.max(16, Math.min(preferredTop, viewportHeight - height - 16)), cardLeft,
        arrow: Math.max(24, Math.min(rect.left + rect.width / 2 - cardLeft, width - 24)), above });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(target);
    if (card.current) observer.observe(card.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
    };
  }, [step]);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);

  const confirm = () => {
    if (step < STEPS.length - 1) { setStep(step + 1); return; }
    completedInMemory = true;
    try { localStorage.setItem(GUIDE_KEY, 'done'); } catch { /* 저장 제한 시 이번 실행에서는 다시 열지 않는다. */ }
    onFinish();
  };

  return (
    <dialog ref={dialog} className="coach-tour" aria-labelledby="coach-title" aria-describedby="coach-description" onCancel={(event) => event.preventDefault()}>
      <div className="coach-spotlight" aria-hidden style={{ top: placement.top, left: placement.left, width: placement.width, height: placement.height }} />
      <div ref={card} className={`coach-card${placement.above ? ' above' : ''}`} style={{ top: placement.cardTop, left: placement.cardLeft, '--coach-arrow': `${placement.arrow}px` } as CSSProperties}>
        <span className="coach-progress">{step + 1} / {STEPS.length}</span>
        <h2 id="coach-title" ref={heading} tabIndex={-1}>{STEPS[step].title}</h2>
        <p id="coach-description">{STEPS[step].description}</p>
        <div className="coach-actions">
          <div className="coach-dots" aria-hidden>{STEPS.map((_, i) => <span key={i} className={i === step ? 'active' : ''} />)}</div>
          <button onClick={confirm}>확인{step === STEPS.length - 1 ? <Check size={20} aria-hidden /> : <ArrowRight size={20} aria-hidden />}</button>
        </div>
      </div>
    </dialog>
  );
}
