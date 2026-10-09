import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type {
  createExplanationSession,
  ExplanationInput,
  ExplanationResult,
} from '../agent/explain'

interface Props {
  input: ExplanationInput
  session: ReturnType<typeof createExplanationSession>
  unseen: number
  close: () => void
  latest: () => void
  explainSentence: () => void
  ask: () => void
}
export default function ExplanationCard({
  input,
  session,
  unseen,
  close,
  latest,
  explainSentence,
  ask,
}: Props) {
  const [result, setResult] = useState<ExplanationResult | undefined>(() => session.peek(input))
  const [retry, setRetry] = useState(0)
  const [chunked, setChunked] = useState(true)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const hit = session.peek(input)
    setResult(hit)
    // StrictMode may mount/clean up once before the real mount. Skip that abandoned request.
    if (!hit)
      void Promise.resolve().then(async () => {
        if (controller.signal.aborted) return
        const value = await session.load(input, controller.signal)
        if (!controller.signal.aborted) setResult(value)
      })
    return () => controller.abort()
  }, [input.text, input.selected, input.context, session, retry])
  return (
    <section
      className="explanation-card"
      role="region"
      aria-labelledby="explanation-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
    >
      <div className="explanation-head">
        <div>
          <span className="explanation-eyebrow">쉬운 말</span>
          <h2 id="explanation-title" ref={title} tabIndex={-1}>
            {input.selected || '이 문장의 뜻'}
          </h2>
        </div>
        <button className="icon-btn" aria-label="설명 닫기" onClick={close}>
          <X size={22} aria-hidden />
        </button>
      </div>
      <div className="explanation-content">
        <details className="explanation-original">
          <summary>원문 보기</summary>
          <p>{input.text}</p>
        </details>
        <div className="explanation-result" aria-live="polite" aria-busy={!result}>
          {!result ? (
            <p className="explanation-wait">
              <Loader2 size={19} className="spin" aria-hidden />
              짧게 풀고 있어요…
            </p>
          ) : result.kind === 'ready' ? (
            <>
              {chunked ? (
                <ol className="explanation-chunks">
                  {result.chunks.map((part, i) => (
                    <li key={i}>{part}</li>
                  ))}
                </ol>
              ) : (
                <div className="explanation-lines">
                  {result.lines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
              <div className="explanation-view" aria-label="설명 읽는 방법">
                <button aria-pressed={chunked} onClick={() => setChunked(true)}>
                  뜻 나눠 보기
                </button>
                <button aria-pressed={!chunked} onClick={() => setChunked(false)}>
                  문장으로 보기
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{result.reason}</p>
              <button className="btn-text" onClick={() => setRetry((n) => n + 1)}>
                다시 시도
              </button>
            </>
          )}
        </div>
        <div className="explanation-links">
          {input.selected && (
            <button className="btn-text" onClick={explainSentence}>
              문장 전체 쉽게 보기
            </button>
          )}
          <button className="btn-text" onClick={ask}>
            다시 설명해 달라고 하기
          </button>
        </div>
      </div>
      {unseen > 0 && (
        <div className="explanation-foot">
          <button onClick={latest}>새 자막 {unseen}개 보기</button>
        </div>
      )}
    </section>
  )
}
