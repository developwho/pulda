import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, SlidersHorizontal } from 'lucide-react'
import { ThinkingOrb } from 'thinking-orbs'
import type { ConciergeStep } from './flow'
import { phaseFor } from './flow'

export function ConciergeFrame({
  step,
  title,
  description,
  onBack,
  onSettings,
  footer,
  children,
}: {
  step: ConciergeStep | 'connecting' | 'expired'
  title: string
  description?: string
  onBack: () => void
  onSettings?: () => void
  footer?: ReactNode
  children?: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [step])
  const phase = step === 'connecting' || step === 'expired' ? 1 : phaseFor(step)
  const utility = ['preferences', 'delete', 'close', 'expired'].includes(step)
  return (
    <div className={`screen concierge-flow concierge-step-${step}`} data-concierge-step={step}>
      <header className="bar">
        <button className="icon-btn" onClick={onBack}>
          <ChevronLeft size={24} aria-hidden />
          뒤로
        </button>
        <span className="bar-label">병원 컨시어지</span>
        {onSettings && (
          <button className="icon-btn" onClick={onSettings} aria-label="문의 설정">
            <SlidersHorizontal size={21} aria-hidden />
          </button>
        )}
      </header>
      <main className="body" key={step}>
        {!utility && (
          <p className="concierge-eyebrow">
            {phase} / 3 <span>{['병원 찾기', '문의하기', '답변 확인'][phase - 1]}</span>
          </p>
        )}
        <h1 className="title" tabIndex={-1} ref={heading}>
          {title}
        </h1>
        {description && <p className="concierge-description">{description}</p>}
        <div className="concierge-content">{children}</div>
      </main>
      {footer && <footer className="cta concierge-cta">{footer}</footer>}
    </div>
  )
}

/** The orb appears only while an actual request is pending; status also lives in text. */
export function SearchProgress({ connecting = false }: { connecting?: boolean }) {
  return (
    <div className="concierge-thinking" role="status" aria-live="polite">
      <div className="concierge-orb" aria-hidden="true">
        <ThinkingOrb
          state={connecting ? 'connecting' : 'searching'}
          size={64}
          theme="light"
          speed={0.8}
        />
      </div>
      <p>
        {connecting
          ? '이전 진행 내용을 불러오고 있어요.'
          : '요청에 맞는 병원과 연락처의 출처를 확인하고 있어요.'}
      </p>
    </div>
  )
}
