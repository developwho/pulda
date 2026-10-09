import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import { ArrowDown, Check, Mic, Pause, Play, MessageSquareText, RotateCcw } from 'lucide-react'
import { Button, Notice, Sheet } from './components'
import { sourceId } from './model'
import type { Source } from './model'
import { createLiveVoice } from './liveVoice'
import { errorMessage } from './api'

export type CaptionStatus = 'idle' | 'playing' | 'paused' | 'ready' | 'ended'
type Props = {
  sources: Source[]
  add: (source: Source) => void
  finish: () => void
  active: boolean
  status: CaptionStatus
  setStatus: Dispatch<SetStateAction<CaptionStatus>>
  requestStart: () => void
  onGap: () => void
}
const sizes = [
  { label: '기본', value: 24 },
  { label: '크게', value: 28 },
  { label: '아주 크게', value: 34 },
  { label: '두 배', value: 48 },
]

export function Consult({
  sources,
  add,
  finish,
  active,
  status,
  setStatus,
  requestStart,
  onGap,
}: Props) {
  const [panel, setPanel] = useState<'writing' | 'size' | null>(null)
  const [draft, setDraft] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(24)
  const [partial, setPartial] = useState<Source | null>(null)
  const [unread, setUnread] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const [finishing, setFinishing] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const manualScroll = useRef(false)
  const lastScrollTop = useRef(0)
  const voice = useRef<ReturnType<typeof createLiveVoice> | null>(null)
  const createVoice = () =>
    createLiveVoice({
      partial: setPartial,
      final: add,
      gap: onGap,
      listening: () => setListening(true),
      error: (reason) => {
        setError(errorMessage(reason))
        setListening(false)
        setStatus('paused')
      },
    })
  useEffect(
    () => () => {
      voice.current?.dispose()
      voice.current = null
    },
    [],
  )
  const transcript = sources.filter((s) => s.kind === 'transcript' || s.kind === 'patient_note')
  useEffect(() => {
    if (!voice.current) voice.current = createVoice()
    if (!active) {
      setStatus((s) => (s === 'playing' ? 'paused' : s))
      setPanel(null)
      setShown(null)
    }
  }, [active, setStatus])
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        voice.current?.pause()
        setStatus((s) => (s === 'playing' ? 'paused' : s))
      }
    }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [setStatus])
  useEffect(() => {
    if (active && status === 'playing' && !panel && !shown) {
      setError('')
      setListening(false)
      void voice.current?.start()
    } else voice.current?.pause()
    return () => {
      void voice.current?.pause()
    }
  }, [active, status, panel, shown])
  useEffect(() => {
    if (follow.current && log.current) {
      log.current.scrollTop = log.current.scrollHeight
      lastScrollTop.current = log.current.scrollTop
    } else if (transcript.length || partial) setUnread(true)
  }, [transcript.length, partial])
  const pause = () => {
    voice.current?.pause()
    setStatus((s) => (s === 'playing' ? 'paused' : s))
  }
  const open = (next: typeof panel) => {
    pause()
    setPanel(next)
  }
  const showMessage = (text: string) => {
    pause()
    add({ id: sourceId(), kind: 'patient_note', text, example: false })
    setPanel(null)
    setShown(text)
  }
  const complete = async () => {
    if (finishing) return
    setFinishing(true)
    try {
      await voice.current?.finish()
      setPanel(null)
      setStatus('ended')
      finish()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setFinishing(false)
    }
  }
  const statusText =
    status === 'playing'
      ? listening
        ? '듣고 있어요'
        : '마이크를 연결하고 있어요'
      : status === 'paused'
        ? '잠시 멈췄어요'
        : status === 'ready'
          ? '자막 변환을 마쳤어요'
          : status === 'ended'
            ? '진료를 마쳤어요'
            : '들을 준비가 됐어요'
  return (
    <section className="consult-page">
      <header className="consult-heading">
        <div>
          <h1>실시간 자막</h1>
        </div>
        <button
          className="text-action"
          disabled={finishing}
          aria-label={status === 'ended' ? '진료 후 내용 보기' : '변환 완료'}
          onClick={() => void complete()}
        >
          {finishing ? '마지막 자막 확인 중' : status === 'ended' ? '내용 보기' : '변환 완료'}
        </button>
      </header>
      <div className={`voice-control ${status === 'playing' ? 'is-listening' : ''}`}>
        <span role="status">
          <Mic size={23} aria-hidden="true" />
          {statusText}
        </span>
        {status === 'playing' ? (
          <button aria-label="자막 일시정지" onClick={pause}>
            <Pause size={18} aria-hidden="true" />
            멈춤
          </button>
        ) : status === 'idle' || status === 'paused' ? (
          <button
            aria-label={status === 'idle' ? '듣기 시작' : '이어 듣기'}
            onClick={status === 'idle' ? requestStart : () => setStatus('playing')}
          >
            <Play size={18} aria-hidden="true" />
            {status === 'idle' ? '시작' : '이어 듣기'}
          </button>
        ) : (
          <Check size={23} aria-hidden="true" />
        )}
      </div>
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
      <div className="caption-toolbar">
        <p>날짜와 숫자는 다시 확인해요</p>
        <button
          className="font-button"
          aria-label="자막 글자 크기"
          aria-haspopup="dialog"
          onClick={() => open('size')}
        >
          <span aria-hidden="true">
            가<span>가</span>
          </span>
        </button>
      </div>
      <div className="caption-reading-area">
        <div
          className="live-transcript"
          style={{ '--caption-size': `${fontSize / 16}rem` } as CSSProperties}
          ref={log}
          role="log"
          aria-label="진료 대화 기록"
          aria-live="polite"
          aria-relevant="additions"
          tabIndex={0}
          onWheel={(event) => {
            manualScroll.current = true
            if (event.deltaY < 0) follow.current = false
          }}
          onTouchStart={() => {
            manualScroll.current = true
          }}
          onPointerDown={() => {
            manualScroll.current = true
          }}
          onKeyDown={(event) => {
            if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) follow.current = false
            if (
              ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
            )
              manualScroll.current = true
          }}
          onScroll={(event) => {
            if (!manualScroll.current) return
            const el = event.currentTarget
            const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48
            const movedDown = el.scrollTop > lastScrollTop.current
            if (!nearEnd || el.scrollTop < lastScrollTop.current) follow.current = false
            if (nearEnd && movedDown) {
              follow.current = true
              manualScroll.current = false
              setUnread(false)
            }
            lastScrollTop.current = el.scrollTop
          }}
        >
          {!transcript.length && !partial && (
            <div className="caption-empty">
              <Mic size={36} strokeWidth={1.5} aria-hidden="true" />
              <p>{status === 'playing' ? '말씀을 기다리고 있어요' : '말한 내용이 여기에 보여요'}</p>
            </div>
          )}
          {transcript.map((source) => (
            <article
              className={`caption-line ${source.kind === 'patient_note' ? 'mine' : ''}`}
              key={source.id}
            >
              <span className="caption-label">
                {source.kind === 'patient_note' ? '내가 쓴 말' : '들은 말'}
                {source.incomplete ? ' · 미완성' : ''}
              </span>
              <p>{source.text}</p>
            </article>
          ))}
          {partial && (
            <article className="caption-line interim" aria-live="off">
              <span className="caption-label">
                {status === 'playing' ? '글자로 바꾸는 중' : '이어서 변환할 말'}
              </span>
              <p>
                {partial.text}
                <span className="caption-cursor" aria-hidden="true">
                  ▍
                </span>
              </p>
            </article>
          )}
        </div>
        {unread && (
          <button
            className="latest-caption"
            onClick={() => {
              follow.current = true
              manualScroll.current = false
              setUnread(false)
              if (log.current) log.current.scrollTop = log.current.scrollHeight
              lastScrollTop.current = log.current?.scrollTop || 0
            }}
          >
            <ArrowDown size={18} aria-hidden="true" />새 자막 보기
          </button>
        )}
      </div>
      <p className="small-note">
        변환 완료를 누르면 기록을 OpenAI에 보내 진료 후 할 일을 자동으로 정리해요.
      </p>
      <div className="consult-actions">
        <Button onClick={() => open('writing')}>
          <MessageSquareText size={22} aria-hidden="true" />
          {draft ? '쓰던 말 이어 쓰기' : '글로 말하기'}
        </Button>
        <button className="quick-speak" onClick={() => showMessage('다시 설명해 주세요.')}>
          <RotateCcw size={18} aria-hidden="true" />
          다시 설명해 주세요
        </button>
      </div>
      {panel === 'writing' && (
        <Sheet title="의료진에게 보여줄 말" onClose={() => setPanel(null)}>
          <p className="small-note">글을 쓰는 동안 자막은 잠시 멈춰요.</p>
          <label className="form-field">
            직접 입력하기
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={2000}
              placeholder="짧게 적어도 돼요."
            />
          </label>
          <Button
            disabled={!draft.trim()}
            onClick={() => {
              showMessage(draft.trim())
              setDraft('')
            }}
          >
            내 말 크게 보여주기
          </Button>
          <div className="quick-replies">
            {['천천히 말씀해 주세요.', '글로 적어 주세요.'].map((text) => (
              <button key={text} onClick={() => showMessage(text)}>
                {text}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {shown && (
        <Sheet title="의료진에게 보여주세요" onClose={() => setShown(null)} wide>
          <div className="present-content">
            <p>{shown}</p>
          </div>
          <Button onClick={() => setShown(null)}>자막으로 돌아가기</Button>
          <Button
            variant="quiet"
            onClick={() => {
              setDraft(shown)
              setShown(null)
              setPanel('writing')
            }}
          >
            고쳐 쓰기
          </Button>
        </Sheet>
      )}
      {panel === 'size' && (
        <Sheet title="자막 글자 크기" onClose={() => setPanel(null)}>
          <p className="small-note">이 크기는 자막에만 적용돼요.</p>
          <div className="caption-size-options" role="group" aria-label="자막 크기 선택">
            {sizes.map((size) => (
              <button
                key={size.value}
                aria-pressed={fontSize === size.value}
                onClick={() => setFontSize(size.value)}
              >
                {size.label}
              </button>
            ))}
          </div>
          <p className="caption-size-preview" style={{ fontSize: `${fontSize / 16}rem` }}>
            편하게 읽을 수 있나요?
          </p>
          <Button onClick={() => setPanel(null)}>이 크기로 읽기</Button>
        </Sheet>
      )}
    </section>
  )
}
