import { useEffect, useId, useRef } from 'react'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { X, ArrowUpRight, Info } from 'lucide-react'

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet'
  children: ReactNode
}) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  )
}
export function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return (
    <div className={`notice ${warning ? 'warning' : ''}`}>
      <Info size={20} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
export function SectionTitle({
  number,
  children,
  extra,
}: {
  number?: string
  children: ReactNode
  extra?: ReactNode
}) {
  return (
    <div className="section-title">
      <h2>
        {number && <span>{number}</span>}
        {children}
      </h2>
      {extra}
    </div>
  )
}
export function SourceLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="source-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={18} aria-hidden="true" />
    </button>
  )
}
export function Sheet({
  title,
  children,
  onClose,
  wide = false,
  tall = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  tall?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const element = ref.current!
    const trigger = document.activeElement as HTMLElement | null
    element.showModal()
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handlePop = () => closeRef.current()
    window.addEventListener('popstate', handlePop)
    return () => {
      element.close()
      document.body.style.overflow = originalOverflow
      trigger?.focus({ preventScroll: true })
      window.removeEventListener('popstate', handlePop)
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`sheet ${wide ? 'presentation' : ''} ${tall ? 'sheet-tall' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet-inner">
        <div className="sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" aria-label="닫기" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
