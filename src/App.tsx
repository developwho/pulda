import { useCallback, useEffect, useRef, useState } from 'react'
import {
  HeartHandshake,
  ClipboardList,
  FileText,
  MessageCircle,
  Settings2,
  ArrowLeft,
  Trash2,
  Mic,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { Start } from './Start'
import { Prepare } from './Prepare'
import { Consult } from './Consult'
import type { CaptionStatus } from './Consult'
import { Review } from './Review'
import { Button, Notice, Sheet } from './components'
import { addSource, approve, newVisit, sourceId } from './model'
import type { Approval, Phase, Source, Visit } from './model'
import { eraseVisit, loadVisit, saveVisit, SEVEN_DAYS } from './storage'
import type { SavedVisit } from './storage'

const tabs = [
  { id: 'prepare', title: '준비', icon: FileText },
  { id: 'consult', title: '진료 중', icon: MessageCircle },
  { id: 'review', title: '진료 후', icon: ClipboardList },
] as const
type Screen = Phase | 'start'
function initialPhase(): Screen {
  const hash = window.location.hash.slice(1)
  return tabs.some((tab) => tab.id === hash) ? (hash as Phase) : 'start'
}
export default function App() {
  const [visit, setVisit] = useState(newVisit)
  const [phase, setPhase] = useState<Screen>(initialPhase)
  const [presentation, setPresentation] = useState<string[] | null>(null)
  const [settings, setSettings] = useState(false)
  const [reset, setReset] = useState(false)
  const [captionIntro, setCaptionIntro] = useState(false)
  const [captionStatus, setCaptionStatus] = useState<CaptionStatus>('idle')
  const [session, setSession] = useState(0)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [saved, setSaved] = useState<SavedVisit | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [storageMessage, setStorageMessage] = useState('')
  const retentionChannel = useRef<BroadcastChannel | null>(null)
  const storageGeneration = useRef(0)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('pulda-retention')
    retentionChannel.current = channel
    channel.onmessage = (event) => {
      if (event.data?.type !== 'stop-saving') return
      storageGeneration.current++
      setExpiresAt(null)
      setSaved(null)
      void eraseVisit().catch(() =>
        setStorageMessage('기기 기록을 지우지 못했어요. 브라우저에서 사이트 데이터를 지워 주세요.'),
      )
      if (event.data.clearVisit) {
        setVisit(newVisit())
        window.location.hash = 'start'
        setSession((value) => value + 1)
        setCaptionStatus('idle')
        setPresentation(null)
        setCaptionIntro(false)
        setSettings(false)
        setReset(false)
        setStorageMessage('다른 화면에서 이번 진료 기록을 지웠어요.')
      }
    }
    return () => {
      channel.close()
      retentionChannel.current = null
    }
  }, [])
  const [operator, setOperator] = useState<{ operator: string; privacyEmail: string } | null>(null)
  useEffect(() => {
    if (settings && !operator)
      void fetch('/api/info')
        .then((response) => (response.ok ? response.json() : null))
        .then(setOperator)
        .catch(() => {})
  }, [settings, operator])
  useEffect(() => {
    let alive = true
    const generation = storageGeneration.current
    void loadVisit()
      .then((value) => {
        if (alive && generation === storageGeneration.current) setSaved(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (!expiresAt) return
    void saveVisit(visit, expiresAt).catch(() => {
      setStorageMessage('기기에 보관하지 못했어요. 이 화면에서는 계속 이용할 수 있어요.')
      setExpiresAt(null)
    })
  }, [visit, expiresAt])
  useEffect(() => {
    if (!expiresAt && !saved) return
    const check = () => {
      if ((expiresAt || saved!.expiresAt) <= Date.now()) {
        setExpiresAt(null)
        setSaved(null)
        void eraseVisit().catch(() => {})
        setStorageMessage('7일 보관 기간이 끝나 기기에 저장한 기록을 지웠어요.')
      }
    }
    const timer = setInterval(check, 30000)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [expiresAt, saved])
  const scrollPositions = useRef<Record<Screen, number>>({
    start: 0,
    prepare: 0,
    consult: 0,
    review: 0,
  })
  const current = useRef(phase)
  useEffect(() => {
    const navigate = () => {
      scrollPositions.current[current.current] = window.scrollY
      const next = initialPhase()
      setCaptionIntro(false)
      current.current = next
      setPhase(next)
      requestAnimationFrame(() => window.scrollTo(0, scrollPositions.current[next]))
    }
    const online = () => setOffline(!navigator.onLine)
    window.addEventListener('hashchange', navigate)
    window.addEventListener('online', online)
    window.addEventListener('offline', online)
    return () => {
      window.removeEventListener('hashchange', navigate)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', online)
    }
  }, [])
  const update = useCallback(
    (patch: Partial<Visit>) =>
      setVisit((value) => {
        const updated = { ...value, ...patch }
        if (patch.prepared && patch.prepared !== value.prepared) {
          return addSource(updated, {
            id: sourceId(),
            kind: 'patient_note',
            text: value.note,
            example: false,
          })
        }
        return updated
      }),
    [],
  )
  const add = useCallback((source: Source) => setVisit((value) => addSource(value, source)), [])
  const approveAction = useCallback(
    (approval: Approval) => setVisit((value) => approve(value, approval)),
    [],
  )
  const go = (next: Screen) => {
    window.location.hash = next
  }
  return (
    <div className={`app ${phase === 'consult' ? 'is-consult' : ''}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        본문으로 이동
      </a>
      <header className="app-header">
        <a className="wordmark" href="#start" aria-label="풀다 시작 화면">
          <HeartHandshake size={24} aria-hidden="true" /> 풀다
        </a>
        <div className="header-actions">
          <button className="icon-button" aria-label="이용 안내" onClick={() => setSettings(true)}>
            <Settings2 size={22} aria-hidden="true" />
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {saved && (
          <Notice>
            이 기기에 보관한 기록이 있어요.
            <Button
              variant="quiet"
              onClick={() => {
                setVisit(saved.visit)
                setExpiresAt(saved.expiresAt)
                setSaved(null)
                setSession((value) => value + 1)
                setCaptionStatus('idle')
                go(
                  saved.visit.consultationCompleted
                    ? 'review'
                    : saved.visit.sources.some((source) => source.kind === 'transcript')
                      ? 'consult'
                      : 'prepare',
                )
                setStorageMessage('보관한 기록을 열었어요. 질문과 일정은 다시 검토해 주세요.')
              }}
            >
              보관한 기록 이어 보기
            </Button>
          </Notice>
        )}
        {storageMessage && (
          <p className="small-note" role="status">
            {storageMessage}
          </p>
        )}
        {offline && (
          <Notice warning>인터넷 연결이 끊겼어요. 작성한 글은 이 화면에 남아 있어요.</Notice>
        )}
        {phase === 'start' && <Start visit={visit} update={update} go={go} />}
        <div key={session}>
          <div hidden={phase !== 'prepare'}>
            <Prepare
              visit={visit}
              update={update}
              present={setPresentation}
              finish={() => go('consult')}
            />
          </div>
          <div hidden={phase !== 'consult'}>
            <Consult
              sources={visit.sources}
              add={add}
              status={captionStatus}
              setStatus={setCaptionStatus}
              requestStart={() => setCaptionIntro(true)}
              onGap={() => update({ captureInterrupted: true })}
              active={phase === 'consult' && !presentation && !settings && !reset && !captionIntro}
              finish={() => {
                update({ consultationCompleted: true })
                go('review')
              }}
            />
          </div>
          <div hidden={phase !== 'review'}>
            <Review
              visit={visit}
              active={phase === 'review'}
              add={add}
              approve={approveAction}
              update={update}
              present={setPresentation}
            />
          </div>
        </div>
      </main>
      <nav hidden={phase === 'start'} className="bottom-nav" aria-label="진료 단계">
        {tabs.map(({ id, title, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={phase === id ? 'page' : undefined}
            onClick={(event) => {
              if (
                id === 'consult' &&
                phase === 'prepare' &&
                captionStatus !== 'ended' &&
                captionStatus !== 'ready'
              ) {
                event.preventDefault()
                setCaptionIntro(true)
              }
            }}
          >
            <Icon size={23} strokeWidth={1.8} aria-hidden="true" />
            <span>{title}</span>
          </a>
        ))}
      </nav>
      {captionIntro && (
        <Sheet title="자막을 켤까요?" onClose={() => setCaptionIntro(false)} tall>
          <ul className="caption-intro-list" role="list">
            <li>
              <Mic aria-hidden="true" />
              <span>
                대화 내용을 <br />
                실시간 글자로 바꿔요
              </span>
            </li>
            <li>
              <ShieldCheck aria-hidden="true" />
              <span>
                풀다는 음성을 저장하지 않아요. <br />
                변환된 텍스트만 검토해요.
              </span>
            </li>
            <li>
              <UserRound aria-hidden="true" />
              <span>
                시작하기 전에 의료진에게 먼저 알리고 <br />
                괜찮은지 물어봐주세요.
              </span>
            </li>
          </ul>
          <p className="caption-intro-caution">
            * 자동 자막은 잘못 들을 수 있어요. <br />
            날짜와 숫자는 꼭 다시 확인해요.
          </p>
          <div className="caption-intro-actions">
            <p className="small-note">시작하면 음성을 OpenAI에 보내요.</p>
            <details className="record-disclosure">
              <summary>음성 처리와 보관 안내</summary>
              <p className="small-note">
                시작하면 마이크 음성을 OpenAI에 보내 글자로 바꿔요. 풀다는 음성을 보관하지 않아요.
                OpenAI는 오용 방지를 위해 최대 30일 보관할 수 있어요. 멈추거나 다른 화면으로
                이동하면 음성 전송을 멈춰요.
              </p>
            </details>
            <Button
              onClick={() => {
                setCaptionIntro(false)
                setCaptionStatus('playing')
                go('consult')
              }}
            >
              확인하고 시작하기
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setCaptionIntro(false)
                setCaptionStatus('idle')
                go('consult')
              }}
            >
              글로만 소통하기
            </Button>
          </div>
        </Sheet>
      )}
      {presentation && (
        <Sheet title="선택한 내용을 보여줘요" onClose={() => setPresentation(null)} wide>
          <div className="present-content">
            {presentation.map((text, index) => (
              <p key={index}>{text}</p>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setPresentation(null)}>
            <ArrowLeft size={20} aria-hidden="true" />내 화면으로 돌아가기
          </Button>
        </Sheet>
      )}
      {settings && (
        <Sheet title="풀다 이용 안내" onClose={() => setSettings(false)}>
          <Notice>진료에서 읽고, 쓰고, 확인하는 일을 도와요.</Notice>
          <h3>나에게 편한 방법으로 소통해요</h3>
          <p>
            글과 자막, 한국수어 통역 요청을 함께 쓸 수 있어요. 풀다는 수어 통역이나 의료 판단을
            대신하지 않아요.
          </p>
          <h3>기록 보관은 내가 선택해요</h3>
          <p>
            기본으로 이 화면에만 남아요. 선택하면 같은 브라우저에 7일 보관해요. 공용 기기에서는
            보관하지 않는 편이 좋아요.
          </p>
          <label className="request-option">
            <input
              type="checkbox"
              checked={!!expiresAt}
              onChange={async (e) => {
                if (e.target.checked) {
                  setExpiresAt(Date.now() + SEVEN_DAYS)
                  setSaved(null)
                  setStorageMessage('이 기기에 7일 보관해요.')
                } else {
                  storageGeneration.current++
                  retentionChannel.current?.postMessage({ type: 'stop-saving', clearVisit: false })
                  setExpiresAt(null)
                  setSaved(null)
                  try {
                    await eraseVisit()
                    setStorageMessage('기기 보관을 껐어요. 지금 화면의 기록은 남아 있어요.')
                  } catch {
                    setStorageMessage(
                      '기기 기록을 지우지 못했어요. 브라우저의 사이트 데이터 삭제를 이용해 주세요.',
                    )
                  }
                }
              }}
            />
            <span>이 기기에 7일 보관할게요</span>
          </label>
          {expiresAt && (
            <p className="small-note">
              {new Date(expiresAt).toLocaleString('ko-KR')}까지 보관해요. 앱을 닫아두면 다시 열 때
              만료된 기록을 지워요.
            </p>
          )}
          <details className="record-disclosure">
            <summary>개인정보 처리 알아보기</summary>
            {operator?.operator && (
              <p>
                운영자: {operator.operator}
                <br />
                개인정보 문의:{' '}
                <a href={`mailto:${operator.privacyEmail}`}>{operator.privacyEmail}</a>
              </p>
            )}
            <p>
              음성·사진·분석할 글은 선택한 기능을 실행할 때 OpenAI로 전송해요. 풀다 서버는 처리 후
              진료 내용을 보관하지 않아요. OpenAI는 오용 방지를 위해 최대 30일 보관할 수 있어요.
              이용량 제한용 정보에는 진료 내용을 넣지 않아요.
            </p>
            <a
              href="https://developers.openai.com/api/docs/guides/your-data"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI 데이터 처리 안내
            </a>
          </details>
          <Button
            variant="quiet"
            onClick={() => {
              setSettings(false)
              setReset(true)
            }}
          >
            <Trash2 size={18} aria-hidden="true" />
            이번 진료 기록 지우기
          </Button>
        </Sheet>
      )}
      {reset && (
        <Sheet title="이번 진료 기록을 지울까요?" onClose={() => setReset(false)}>
          <p>
            작성한 말, 대화, 추가한 기록과 승인 내용을 이 화면에서 모두 지워요. 지운 내용은 되돌릴
            수 없어요.
          </p>
          <div className="button-row">
            <Button variant="secondary" onClick={() => setReset(false)}>
              닫기
            </Button>
            <Button
              onClick={async () => {
                storageGeneration.current++
                retentionChannel.current?.postMessage({ type: 'stop-saving', clearVisit: true })
                setExpiresAt(null)
                setSaved(null)
                setVisit(newVisit())
                setPresentation(null)
                setSession((value) => value + 1)
                setReset(false)
                setCaptionStatus('idle')
                setCaptionIntro(false)
                scrollPositions.current = { start: 0, prepare: 0, consult: 0, review: 0 }
                go('start')
                try {
                  await eraseVisit()
                  setStorageMessage('이번 진료 기록을 지웠어요.')
                } catch {
                  setStorageMessage(
                    '화면 기록은 지웠어요. 기기 보관 기록은 브라우저의 사이트 데이터 삭제로 지워 주세요.',
                  )
                }
              }}
            >
              기록 지우기
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
