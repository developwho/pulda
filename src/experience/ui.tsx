import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Captions, CheckCircle2, ChevronLeft, ClipboardList, FileText, Hospital, Info, MessageSquareText,
  MessageCircle, NotebookPen, PenLine, X,
} from 'lucide-react';
import type { Source, SourceType } from './lib/types';
import BrandMark from './BrandMark';

export function TabBar() {
  const tabs = [
    { to: '/prepare', label: '준비', icon: FileText },
    { to: '/consult', label: '진료 중', icon: MessageCircle },
    { to: '/after', label: '진료 후', icon: ClipboardList },
  ];
  return (
    <nav className="tabs" aria-label="진료 단계">
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className="tab">
          <Icon size={23} strokeWidth={1.8} aria-hidden />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

interface ScreenProps {
  /** 상단의 작은 위치 이름 */
  label: string;
  /** 사용자의 목적을 말하는 큰 제목 */
  title?: string;
  back?: boolean | string;
  right?: ReactNode;
  footer?: ReactNode;
  tabs?: boolean;
  children: ReactNode;
}

export function Screen({ label, title, back, right, footer, tabs = false, children }: ScreenProps) {
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  // 화면이 바뀌면 제목으로 포커스를 옮겨 현재 위치를 알린다
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className={`screen${tabs ? ' with-tabs' : ''}`}>
      <header className="bar">
        {back && (
          <button
            className="icon-btn"
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
          >
            <ChevronLeft size={24} aria-hidden />
            뒤로
          </button>
        )}
        {tabs ? (
          <span className="bar-label brand"><BrandMark /></span>
        ) : <span className="bar-label">{label}</span>}
        {right}
      </header>
      <main className="body">
        {title && (
          <h1 className="title" tabIndex={-1} ref={heading}>
            {title}
          </h1>
        )}
        {children}
      </main>
      {footer && <div className="cta">{footer}</div>}
      {tabs && <TabBar />}
    </div>
  );
}

export function Notice({
  tone = 'info', title, children,
}: { tone?: 'info' | 'warn' | 'error' | 'ok'; title?: string; children?: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={22} aria-hidden />
      <div className="grow">
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Sheet({
  open, title, onClose, children, className = '', dismissible = true,
}: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // 첫 버튼(닫기)이 강조돼 보이지 않게 제목으로 포커스를 옮긴다
      heading.current?.focus({ preventScroll: true });
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet ${className}`}
      onClose={onClose}
      onCancel={(e) => { if (!dismissible) e.preventDefault(); }}
      onClick={(e) => dismissible && e.target === ref.current && onClose()}
      aria-label={title}
    >
      {open && (
        <>
          <div className="sheet-head">
            <h2 className="sheet-title" tabIndex={-1} ref={heading}>
              {title}
            </h2>
            <button className="icon-btn" disabled={!dismissible} onClick={onClose}>
              <X size={22} aria-hidden />
              닫기
            </button>
          </div>
          <div className="sheet-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

const SOURCE_ICON: Record<SourceType, typeof FileText> = {
  transcript: Captions,
  written: PenLine,
  handout: FileText,
  patient_note: NotebookPen,
  reported_reply: MessageSquareText,
  patient_fix: PenLine,
  hospital_reply: Hospital,
};

/** 어디에서 가져온 내용인지 항상 이름으로 보여준다. */
export function SourceTag({ source }: { source?: Source }) {
  if (!source) return <span className="tag">지운 자료</span>;
  const Icon = SOURCE_ICON[source.type];
  return (
    <span className="tag">
      <Icon size={16} aria-hidden />
      {source.label}
    </span>
  );
}

/** 출처 원문 안에서 해당 문장을 강조해 보여준다. */
export function SourceQuote({ source, quote }: { source: Source; quote: string }) {
  const index = source.text.indexOf(quote);
  if (index < 0 || source.text === quote) return <p className="quote">{source.text}</p>;
  return (
    <p className="quote">
      {source.text.slice(0, index)}
      <mark>{quote}</mark>
      {source.text.slice(index + quote.length)}
    </p>
  );
}

/** 병원 답을 대화 말풍선으로 보여준다. 누가 한 말인지는 위에 작게 적는다. */
export function ReplyBubble({ from, text }: { from: string; text: string }) {
  return (
    <div className="bubble-wrap">
      <span className="bubble-from">{from}</span>
      <p className="bubble">{text}</p>
    </div>
  );
}

/** 무엇이 어떻게 바뀌는지 한 줄로. 예: 일정 미정 → 10월 13일 화요일 */
export function ChangeLine({ before, after }: { before: string; after: string }) {
  return (
    <p className="change-line">
      <span className="change-before">{before}</span>
      <span className="change-arrow" aria-hidden>
        →
      </span>
      <span className="sr-only">에서</span>
      <strong className="change-after">{after}</strong>
    </p>
  );
}
