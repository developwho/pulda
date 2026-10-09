import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, ExternalLink, MessageSquareText, Phone, Check, Clock3 } from 'lucide-react'
import { Notice } from '../ui'
import { mutate, startVisit, useVisit } from '../store/visit'
import {
  openConcierge,
  conciergeAction,
  conciergeState,
  forgetConcierge,
  resetConciergeConnection,
  ApiError,
  type ConciergeState,
  type Hospital,
} from '../concierge/api'
import { ConciergeFrame, SearchProgress } from '../concierge/ConciergeFrame'
import { resolveStep, resumeStep, type ConciergeStep } from '../concierge/flow'
import { isMockMode } from '../runtime'
import { MOCK_CASE } from '../../mock/fixtures'
import '../styles/concierge.css'

export default function Concierge() {
  const visit = useVisit()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<ConciergeState | null>(null)
  const [memoryAvailable, setMemoryAvailable] = useState(false)
  const [query, setQuery] = useState('')
  const [clarification, setClarification] = useState('')
  const [busy, setBusy] = useState(false)
  const [submittingSearch, setSubmittingSearch] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const [pollFailed, setPollFailed] = useState(false)
  const [channel, setChannel] = useState<'text' | 'phone'>('text')
  const [preferredTime, setPreferredTime] = useState(isMockMode ? MOCK_CASE.preferredTime : '')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [smsNumber, setSmsNumber] = useState('')
  const [smsConfirmed, setSmsConfirmed] = useState(false)
  const [reply, setReply] = useState('')
  const [confirmed, setConfirmed] = useState<boolean | null>(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [copied, setCopied] = useState(false)
  const [contactOpened, setContactOpened] = useState(false)
  const [preferenceDraft, setPreferenceDraft] = useState({
    contact: 'text' as 'text' | 'phone',
    communication: 'written' as 'written' | 'none',
    remember: false,
  })
  const settingsReturn = useRef<ConciergeStep>('request')
  const navigationVersion = useRef(0)
  const requestBusy = useRef(false)
  const searching = state?.search?.status === 'queued' || state?.search?.status === 'running'
  const inquiry = state?.inquiry?.status !== 'cancelled' ? state?.inquiry : undefined
  const hospital =
    state?.hospitals.find((h) => h.id === params.get('hospital')) ?? inquiry?.hospital
  const step = state
    ? resolveStep(params.get('step'), state, !!hospital, !!reply.trim(), submittingSearch)
    : 'request'

  function report(e: unknown) {
    setError(e instanceof Error ? e.message : '연결을 확인하고 다시 시도해 주세요.')
    if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') setExpired(true)
  }
  function go(next: ConciergeStep, selected = hospital, replace = false) {
    navigationVersion.current++
    setError('')
    setParams({ step: next, ...(selected ? { hospital: selected.id } : {}) }, { replace })
  }
  useEffect(() => {
    let alive = true
    void openConcierge()
      .then(async (boot) => {
        const latest = await conciergeState()
        if (!alive) return
        setState(latest)
        setMemoryAvailable(boot.memoryAvailable)
        setQuery(latest.search?.query ?? (isMockMode ? MOCK_CASE.query : ''))
        setReply(latest.inquiry?.reply ?? (isMockMode ? MOCK_CASE.reply : ''))
        setDate(latest.inquiry?.appointment?.date ?? (isMockMode ? MOCK_CASE.appointment.date : ''))
        setTime(latest.inquiry?.appointment?.time ?? (isMockMode ? MOCK_CASE.appointment.time : ''))
        setChannel(latest.inquiry?.channel ?? latest.preferences.contact)
        setPreferenceDraft({ ...latest.preferences, remember: latest.memory === 'agentcore' })
      })
      .catch((e) => alive && report(e))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (!searching || pollFailed) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await conciergeState()
        if (!stopped) setState(next)
      } catch (e) {
        if (!stopped) {
          report(e)
          setPollFailed(true)
          stopped = true
        }
      }
      if (!stopped) timer = setTimeout(poll, 1800)
    }
    timer = setTimeout(poll, 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [searching, pollFailed])

  async function action(path: string, data: object = {}, next?: ConciergeStep) {
    if (!state || requestBusy.current) return false
    requestBusy.current = true
    const navigation = navigationVersion.current
    setBusy(true)
    setError('')
    try {
      const updated = await conciergeAction(path, state.version, data)
      setState(updated)
      if (next && navigationVersion.current === navigation) go(next)
      return true
    } catch (e) {
      report(e)
      try {
        setState(await conciergeState())
      } catch {
        /* Keep the original error. */
      }
      return false
    } finally {
      requestBusy.current = false
      setBusy(false)
    }
  }
  async function search(text: string) {
    if (text.trim().length < 2 || requestBusy.current) return
    setQuery(text)
    setClarification('')
    setPollFailed(false)
    setSubmittingSearch(true)
    go('searching')
    const ok = await action('/search', { query: text, requestId: crypto.randomUUID() })
    setSubmittingSearch(false)
    if (!ok) setPollFailed(true)
  }
  function select(h: Hospital) {
    setCopied(false)
    setName(isMockMode ? MOCK_CASE.name : '')
    setNote('')
    setSmsNumber('')
    setSmsConfirmed(false)
    setContactOpened(false)
    setReply(isMockMode ? MOCK_CASE.reply : '')
    setConfirmed(null)
    setDate(isMockMode ? MOCK_CASE.appointment.date : '')
    setTime(isMockMode ? MOCK_CASE.appointment.time : '')
    setChannel(!h.phone || (state?.preferences.contact === 'text' && h.smsPhone) ? 'text' : 'phone')
    go('hospital', h)
  }
  async function saveReply(withAppointment: boolean) {
    if (!inquiry) return
    await action(
      '/reply',
      {
        id: inquiry.id,
        text: reply,
        confirmedByUser: true,
        ...(withAppointment
          ? { appointment: { date, time, department: inquiry.hospital.department } }
          : {}),
      },
      'recorded',
    )
  }
  function useAppointment() {
    if (!inquiry?.appointment) return
    const a = inquiry.appointment
    const appointment = {
      hospital: inquiry.hospital.name,
      dept: a.department,
      date: a.date,
      time: a.time,
    }
    if (visit)
      mutate((v) => {
        v.appointment = appointment
        if (v.preparation) v.preparation.appointmentDraft = { ...appointment }
      })
    else startVisit({ appointment })
    navigate('/prepare')
  }
  function openSettings() {
    if (!state) return
    settingsReturn.current = step
    setPreferenceDraft({ ...state.preferences, remember: state.memory === 'agentcore' })
    go('preferences')
  }
  function back() {
    if (['contact', 'waiting'].includes(step) || (step === 'results' && inquiry)) {
      navigate(visit ? '/prepare' : '/')
      return
    }
    const previous: Partial<Record<ConciergeStep, ConciergeStep>> = {
      searching: 'request',
      clarify: 'request',
      results: 'request',
      hospital: 'results',
      facts: 'hospital',
      channel: 'hospital',
      sms: 'channel',
      schedule: channel === 'text' && !hospital?.smsPhone ? 'sms' : 'channel',
      details: 'schedule',
      review: inquiry?.status === 'draft' ? 'schedule' : resumeStep(state!),
      reply: inquiry?.reply ? 'recorded' : 'waiting',
      confirmation: 'reply',
      appointment: 'confirmation',
      'saved-reply': 'recorded',
      preferences: settingsReturn.current,
      delete: 'preferences',
      close: 'preferences',
      failure: 'request',
    }
    if (previous[step]) go(previous[step]!)
    else navigate(visit ? '/prepare' : '/')
  }
  const primary = (label: string, onClick: () => void, disabled = false) => (
    <button
      className="btn btn-primary btn-block"
      type="button"
      disabled={busy || disabled}
      onClick={(event) => {
        event.preventDefault()
        onClick()
      }}
    >
      {busy ? '처리하고 있어요' : label}
    </button>
  )
  const submit = (label: string, form: string, disabled = false) => (
    <button
      className="btn btn-primary btn-block"
      form={form}
      type="submit"
      disabled={busy || disabled}
    >
      {busy ? '처리하고 있어요' : label}
    </button>
  )
  const secondary = (label: string, onClick: () => void) => (
    <button className="concierge-text-action" type="button" disabled={busy} onClick={onClick}>
      {label}
    </button>
  )
  const restart = () => {
    resetConciergeConnection()
    window.location.reload()
  }

  if (expired)
    return (
      <ConciergeFrame
        step="expired"
        title="다시 시작해 주세요"
        description="한 시간이 지나 검색과 문의가 만료됐어요."
        onBack={() => navigate(visit ? '/prepare' : '/')}
        footer={primary('새로 시작하기', restart)}
      />
    )
  if (!state)
    return (
      <ConciergeFrame
        step="connecting"
        title={error ? '연결을 확인해 주세요' : '병원 찾기를 준비해요'}
        onBack={() => navigate(visit ? '/prepare' : '/')}
        footer={error ? primary('다시 연결하기', restart) : undefined}
      >
        {error ? <Notice tone="error">{error}</Notice> : <SearchProgress connecting />}
      </ConciergeFrame>
    )

  let title = '',
    description: string | undefined,
    content: ReactNode,
    footer: ReactNode
  switch (step) {
    case 'request':
      title = '어떤 도움이 필요해요?'
      description = '불편한 곳이나 찾는 진료과를 알려주세요.'
      content = (
        <form
          id="concierge-request"
          onSubmit={(e) => {
            e.preventDefault()
            void search(query)
          }}
        >
          <label className="sr-only" htmlFor="concierge-query">
            증상이나 찾는 병원
          </label>
          <textarea
            className="textarea concierge-request-input"
            id="concierge-query"
            value={query}
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 종로구에서 내과를 찾고 싶어요"
            required
            minLength={2}
          />
          <p className="hint mt16">이름이나 연락처는 적지 않아도 돼요.</p>
        </form>
      )
      footer = inquiry ? (
        <>
          {primary('진행하던 문의 보기', () => go(resumeStep(state)))}
          {secondary('현재 문의 닫고 새로 찾기', () => go('close'))}
        </>
      ) : searching ? (
        primary('진행 중인 검색 보기', () => go('searching'))
      ) : (
        submit('병원 찾아보기', 'concierge-request', query.trim().length < 2)
      )
      break
    case 'searching':
      title = pollFailed ? '연결을 다시 확인해요' : '맞는 병원을 찾고 있어요'
      content = pollFailed ? (
        <p className="sub">검색 진행 내용을 다시 불러올 수 있어요.</p>
      ) : (
        <SearchProgress />
      )
      footer = pollFailed ? (
        primary('진행 상황 다시 확인하기', () => {
          setBusy(true)
          void conciergeState()
            .then((next) => {
              setState(next)
              setPollFailed(false)
              setError('')
            })
            .catch(report)
            .finally(() => setBusy(false))
        })
      ) : (
        <p className="hint concierge-center">이전 화면으로 돌아가도 검색을 이어가요.</p>
      )
      break
    case 'clarify':
      title = '한 가지만 더 알려주세요'
      description = state.search?.clarification
      content = (
        <form
          id="concierge-clarify"
          onSubmit={(e) => {
            e.preventDefault()
            void search(clarification)
          }}
        >
          <label className="sr-only" htmlFor="clarification">
            추가 답변
          </label>
          <textarea
            className="textarea concierge-request-input"
            id="clarification"
            value={clarification}
            maxLength={500}
            required
            minLength={2}
            onChange={(e) => setClarification(e.target.value)}
            placeholder="여기에 답해 주세요"
          />
        </form>
      )
      footer = submit('이 조건으로 찾아보기', 'concierge-clarify', clarification.trim().length < 2)
      break
    case 'results':
      title = state.hospitals.length ? '어느 병원을 알아볼까요?' : '조건을 조금 바꿔볼까요?'
      description = state.hospitals.length
        ? '병원을 고르면 자세한 정보를 볼 수 있어요.'
        : '출처를 확인할 수 있는 병원을 찾지 못했어요.'
      content = (
        <div className="concierge-results" aria-label="찾은 병원">
          {state.hospitals.map((h) => (
            <button className="concierge-result" key={h.id} onClick={() => select(h)}>
              <span>
                <span className="concierge-result-dept">{h.department || '진료과 확인 필요'}</span>
                <strong>{h.name}</strong>
                <span className="concierge-result-address">{h.address || '주소 확인 필요'}</span>
              </span>
              <ChevronRight size={22} aria-hidden />
            </button>
          ))}
        </div>
      )
      footer = state.hospitals.length
        ? secondary('검색 조건 바꾸기', () => go(inquiry ? 'close' : 'request'))
        : primary('검색 조건 바꾸기', () => go('request'))
      break
    case 'hospital':
      title = hospital!.name
      description = hospital!.department || '진료과는 병원에 확인해 주세요.'
      content = (
        <div className="concierge-hospital-overview">
          <p className="concierge-address">{hospital!.address || '주소 확인이 필요해요.'}</p>
          <p className="concierge-reason">{hospital!.reason}</p>
          {secondary('연락처와 출처 보기', () => go('facts'))}
        </div>
      )
      footer = primary(
        inquiry && inquiry.hospital.id === hospital!.id
          ? '진행하던 문의 보기'
          : '이 병원에 문의하기',
        () =>
          go(
            inquiry && inquiry.hospital.id === hospital!.id
              ? resumeStep(state)
              : inquiry
                ? 'close'
                : 'channel',
          ),
      )
      break
    case 'facts':
      title = '연락하기 전에 확인해요'
      description = hospital!.name
      content = (
        <div className="stack concierge-facts">
          <dl>
            <dt>대표 전화</dt>
            <dd>{hospital!.phone || '출처에서 확인해 주세요'}</dd>
            <dt>문자 수신 번호</dt>
            <dd>{hospital!.smsPhone || '병원에 확인이 필요해요'}</dd>
          </dl>
          <a
            className="concierge-source"
            href={hospital!.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            병원 정보 출처 <ExternalLink size={16} aria-hidden />
          </a>
          <p className="hint">{new Date(hospital!.checkedAt).toLocaleString('ko-KR')} 조회</p>
          {!!hospital!.questions.length && (
            <div className="concierge-fact-questions">
              <h2>병원에 물어볼 내용</h2>
              <ul>
                {hospital!.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )
      footer = primary('병원 정보로 돌아가기', () => go('hospital'))
      break
    case 'channel':
      title = '어떻게 문의할까요?'
      description = hospital!.name
      content = (
        <fieldset className="concierge-choices">
          <legend className="sr-only">문의 방법</legend>
          <label className={`concierge-choice${channel === 'text' ? ' selected' : ''}`}>
            <MessageSquareText size={24} aria-hidden />
            <span>
              <strong>문자로 문의해요</strong>
              <small>
                {hospital!.smsPhone
                  ? '확인한 문자 번호로 연결해요.'
                  : '병원에 확인한 문자 번호를 넣어요.'}
              </small>
            </span>
            <input
              type="radio"
              name="channel"
              value="text"
              checked={channel === 'text'}
              onChange={() => setChannel('text')}
            />
          </label>
          <label className={`concierge-choice${channel === 'phone' ? ' selected' : ''}`}>
            <Phone size={24} aria-hidden />
            <span>
              <strong>전화로 문의해요</strong>
              <small>
                {hospital!.phone
                  ? '물어볼 말을 미리 준비해요.'
                  : '출처에서 전화번호 확인이 필요해요.'}
              </small>
            </span>
            <input
              type="radio"
              name="channel"
              value="phone"
              disabled={!hospital!.phone}
              checked={channel === 'phone'}
              onChange={() => setChannel('phone')}
            />
          </label>
        </fieldset>
      )
      footer = primary(
        '문의할 일정 정하기',
        () => go(channel === 'text' && !hospital!.smsPhone ? 'sms' : 'schedule'),
        channel === 'phone' && !hospital!.phone,
      )
      if (channel === 'text' && !hospital!.smsPhone)
        footer = primary('문자 번호 입력하기', () => go('sms'))
      break
    case 'sms':
      title = '문자를 받는 번호를 알려주세요'
      description = '병원에 직접 확인한 번호를 넣어주세요.'
      content = (
        <form
          id="concierge-sms"
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            go('schedule')
          }}
        >
          <label className="label" htmlFor="sms-number">
            병원의 문자 수신 번호
          </label>
          <input
            id="sms-number"
            className="input"
            type="tel"
            required
            maxLength={40}
            value={smsNumber}
            onChange={(e) => {
              setSmsNumber(e.target.value)
              setSmsConfirmed(false)
            }}
          />
          <label className="concierge-check mt16">
            <input
              type="checkbox"
              required
              checked={smsConfirmed}
              onChange={(e) => setSmsConfirmed(e.target.checked)}
            />
            병원에서 문자를 받는 번호임을 확인했어요
          </label>
        </form>
      )
      footer = submit('문의할 일정 정하기', 'concierge-sms', !smsNumber.trim() || !smsConfirmed)
      break
    case 'schedule':
      title = '언제 진료받고 싶어요?'
      description = hospital!.name
      content = (
        <form
          id="concierge-schedule"
          onSubmit={(e) => {
            e.preventDefault()
            if (channel === 'text' && !hospital!.smsPhone && (!smsNumber.trim() || !smsConfirmed)) {
              go('sms')
              return
            }
            void action(
              '/draft',
              {
                input: {
                  hospitalId: hospital!.id,
                  channel,
                  preferredTime,
                  department: hospital!.department,
                  name,
                  note,
                  ...(channel === 'text' && !hospital!.smsPhone
                    ? { smsNumber, smsConfirmedByUser: smsConfirmed }
                    : {}),
                },
              },
              'review',
            )
          }}
        >
          <label className="label" htmlFor="preferred-time">
            희망 날짜와 시간
          </label>
          <input
            id="preferred-time"
            className="input mt8"
            required
            maxLength={120}
            value={preferredTime}
            onChange={(e) => setPreferredTime(e.target.value)}
            placeholder="예: 다음 주 화요일 오후"
          />
          <p className="hint mt16">가능한 일정인지는 병원 답변으로 확인해요.</p>
          {secondary(
            name || note ? '이름·추가 요청 고치기' : '이름이나 추가 요청 넣기 (선택)',
            () => go('details'),
          )}
        </form>
      )
      footer = submit('문의문 만들기', 'concierge-schedule', !preferredTime.trim())
      break
    case 'details':
      title = '더 전할 말이 있나요?'
      description = '문의문에 넣을 내용만 적어주세요.'
      content = (
        <form
          id="concierge-details"
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            go('schedule')
          }}
        >
          <div className="field">
            <label htmlFor="inquiry-name">이름 (선택)</label>
            <input
              id="inquiry-name"
              className="input"
              maxLength={40}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="inquiry-note">추가 요청 (선택)</label>
            <textarea
              id="inquiry-note"
              className="textarea"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 처음 방문할 때 준비할 것이 있나요?"
            />
          </div>
        </form>
      )
      footer = submit('문의문에 반영하기', 'concierge-details')
      break
    case 'review':
      title = '이 내용으로 문의할까요?'
      description = `${inquiry!.hospital.name} · ${inquiry!.phone}`
      content = (
        <>
          <div className="concierge-letter">
            <p>{inquiry!.text}</p>
          </div>
          <p className="hint mt16">
            {inquiry!.contactSource === 'user_provided'
              ? '직접 입력한 번호와 내용을 확인해 주세요.'
              : '번호와 내용을 확인해 주세요.'}{' '}
            {inquiry!.status === 'draft' && '아직 병원에 전달하지 않았어요.'}
          </p>
        </>
      )
      footer =
        inquiry!.status === 'draft'
          ? primary(
              '확인했어요 · 연락하기',
              () => void action('/approve', { id: inquiry!.id }, 'contact'),
            )
          : primary('진행하던 문의로 돌아가기', () => go(resumeStep(state)))
      break
    case 'contact':
      title = contactOpened ? '문의를 마쳤나요?' : '병원에 직접 문의해요'
      description = inquiry!.hospital.name
      content = (
        <div className="concierge-contact">
          <span className="concierge-contact-icon">
            {inquiry!.channel === 'text' ? (
              <MessageSquareText size={30} aria-hidden />
            ) : (
              <Phone size={30} aria-hidden />
            )}
          </span>
          <strong>{inquiry!.phone}</strong>
          <p className="sub">
            {inquiry!.channel === 'text'
              ? '문자 앱에서 내용을 확인하고 보내주세요.'
              : '전화 앱에서 연결해 물어볼 말을 전해요.'}
          </p>
          {secondary(copied ? '문의문을 복사했어요' : '문의문 복사하기', () => {
            void navigator.clipboard
              .writeText(inquiry!.text)
              .then(() => setCopied(true))
              .catch(() => setError('문의문 보기에서 내용을 길게 눌러 복사해 주세요.'))
          })}
          {secondary('문의문 보기', () => go('review'))}
        </div>
      )
      footer =
        inquiry!.status !== 'ready' ? (
          primary('답변 확인으로 돌아가기', () => go(resumeStep(state)))
        ) : (
          <>
            {contactOpened ? (
              primary(
                '문의를 마쳤어요',
                () => void action('/contacted', { id: inquiry!.id }, 'waiting'),
              )
            ) : (
              <a
                className="btn btn-primary btn-block"
                onClick={() => setContactOpened(true)}
                href={
                  inquiry!.channel === 'text'
                    ? `sms:${inquiry!.phone}?body=${encodeURIComponent(inquiry!.text)}`
                    : `tel:${inquiry!.phone}`
                }
              >
                {inquiry!.channel === 'text' ? '문자 앱 열기' : '전화 앱 열기'}
              </a>
            )}
            {!contactOpened &&
              secondary(
                '이미 문의를 마쳤어요',
                () => void action('/contacted', { id: inquiry!.id }, 'waiting'),
              )}
            {contactOpened && secondary('연락 화면 다시 보기', () => setContactOpened(false))}
          </>
        )
      break
    case 'waiting':
      title = '병원 답변을 기다려요'
      description = inquiry!.hospital.name
      content = (
        <div className="concierge-waiting">
          <Clock3 size={44} strokeWidth={1.4} aria-hidden />
          <p>
            문자나 전화로 답변을 받으면
            <br />
            여기에 옮겨 적어주세요.
          </p>
        </div>
      )
      footer = primary('받은 답변 적기', () => go('reply'))
      break
    case 'reply':
      title = '어떤 답변을 받았나요?'
      description = '병원에서 받은 말을 그대로 적어주세요.'
      content = (
        <form
          id="concierge-reply"
          onSubmit={(e) => {
            e.preventDefault()
            setConfirmed(null)
            go('confirmation')
          }}
        >
          <label className="sr-only" htmlFor="hospital-reply">
            내가 받은 병원 답변
          </label>
          <textarea
            id="hospital-reply"
            className="textarea concierge-request-input"
            required
            maxLength={1500}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="받은 문자를 붙여 넣어도 돼요."
          />
        </form>
      )
      footer = submit('답변 확인하기', 'concierge-reply', !reply.trim())
      break
    case 'confirmation':
      title = '예약을 확정했나요?'
      description = '병원에서 날짜와 시간을 확정해 주었는지 알려주세요.'
      content = (
        <fieldset className="concierge-choices">
          <legend className="sr-only">예약 확정 여부</legend>
          <label className={`concierge-choice${confirmed === true ? ' selected' : ''}`}>
            <span>
              <strong>네, 확정받았어요</strong>
              <small>받은 날짜와 시간을 기록해요.</small>
            </span>
            <input
              type="radio"
              name="confirmed"
              checked={confirmed === true}
              onChange={() => setConfirmed(true)}
            />
          </label>
          <label className={`concierge-choice${confirmed === false ? ' selected' : ''}`}>
            <span>
              <strong>아직 확인 중이에요</strong>
              <small>받은 답변만 먼저 보관해요.</small>
            </span>
            <input
              type="radio"
              name="confirmed"
              checked={confirmed === false}
              onChange={() => setConfirmed(false)}
            />
          </label>
        </fieldset>
      )
      footer = primary(
        confirmed === false ? '답변만 보관하기' : '확정 일정 적기',
        () => (confirmed ? go('appointment') : void saveReply(false)),
        confirmed === null,
      )
      break
    case 'appointment':
      title = '확정한 일정을 알려주세요'
      description = inquiry!.hospital.name
      content = (
        <form
          id="concierge-appointment"
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void saveReply(true)
          }}
        >
          <div className="field">
            <label htmlFor="booking-date">확정 날짜</label>
            <input
              id="booking-date"
              className="input"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="booking-time">확정 시간</label>
            <input
              id="booking-time"
              className="input"
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </form>
      )
      footer = submit('확정 일정 기록하기', 'concierge-appointment', !date || !time)
      break
    case 'recorded':
      title = inquiry!.appointment ? '예약 정보를 기록했어요' : '받은 답변을 보관했어요'
      description = inquiry!.appointment
        ? '병원에서 확인받은 일정이에요.'
        : '추가 답변이 오면 이어서 적을 수 있어요.'
      content = (
        <div className="concierge-recorded">
          <Check size={36} aria-hidden />
          <strong>{inquiry!.hospital.name}</strong>
          {inquiry!.appointment && (
            <p className="concierge-booked-time">
              {inquiry!.appointment.date}
              <br />
              {inquiry!.appointment.time}
            </p>
          )}
          {secondary('받은 답변 보기', () => go('saved-reply'))}
        </div>
      )
      footer = (
        <>
          {inquiry!.appointment
            ? primary(
                visit ? '이번 진료에 일정 반영하기' : '이 일정으로 진료 준비하기',
                useAppointment,
              )
            : primary('추가 답변 적기', () => go('reply'))}
          {secondary('다른 병원 찾기', () => void action('/cancel', {}, 'request'))}
        </>
      )
      break
    case 'saved-reply':
      title = '병원에서 받은 답변이에요'
      description = '내가 옮겨 적은 내용이에요.'
      content = (
        <div className="concierge-letter">
          <p>{inquiry!.reply}</p>
        </div>
      )
      footer = primary('답변 고치기', () => go('reply'))
      break
    case 'preferences':
      title = '내 문의 방식을 정해요'
      content = (
        <form
          id="concierge-preferences"
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void action(
              '/preferences',
              {
                preferences: {
                  contact: preferenceDraft.contact,
                  communication: preferenceDraft.communication,
                },
                remember: preferenceDraft.remember,
              },
              settingsReturn.current,
            )
          }}
        >
          <div className="field">
            <label htmlFor="contact-preference">선호하는 연락 방식</label>
            <select
              id="contact-preference"
              className="input"
              value={preferenceDraft.contact}
              onChange={(e) =>
                setPreferenceDraft({
                  ...preferenceDraft,
                  contact: e.target.value as 'text' | 'phone',
                })
              }
            >
              <option value="text">문자 우선</option>
              <option value="phone">전화 우선</option>
            </select>
          </div>
          <label className="concierge-check mt16">
            <input
              type="checkbox"
              checked={preferenceDraft.communication === 'written'}
              onChange={(e) =>
                setPreferenceDraft({
                  ...preferenceDraft,
                  communication: e.target.checked ? 'written' : 'none',
                })
              }
            />
            문의문에 ‘글로 안내해 주세요’ 넣기
          </label>
          {memoryAvailable && (
            <label className="concierge-check">
              <input
                type="checkbox"
                checked={preferenceDraft.remember}
                onChange={(e) =>
                  setPreferenceDraft({ ...preferenceDraft, remember: e.target.checked })
                }
              />
              이번 세션의 AI 기억에도 이 선택 저장하기
            </label>
          )}
          <p className="hint mt16">검색과 문의는 최대 1시간 동안 다시 볼 수 있어요.</p>
          {inquiry && secondary('현재 문의 닫기', () => go('close'))}
          {secondary('검색·문의 기록 지우기', () => go('delete'))}
        </form>
      )
      footer = submit('문의 방식 저장하기', 'concierge-preferences', !!searching)
      break
    case 'close':
      title = '현재 문의를 닫을까요?'
      description =
        '이 문의를 마치고 다른 병원을 알아봐요. 병원에 연락하거나 실제 예약을 취소하지는 않아요.'
      footer = (
        <>
          {primary('문의 닫고 다시 찾기', () => void action('/cancel', {}, 'request'))}
          {secondary('진행하던 문의 보기', () => go(resumeStep(state)))}
        </>
      )
      break
    case 'delete':
      title = '검색·문의 기록을 지울까요?'
      description = '이 세션의 검색, 문의와 AI 기억을 지워요. 실제 병원 예약은 그대로예요.'
      footer = (
        <>
          {primary('기록 지우기', () => {
            setBusy(true)
            void forgetConcierge()
              .then(() => navigate(visit ? '/prepare' : '/'))
              .catch(report)
              .finally(() => setBusy(false))
          })}
          {secondary('닫기', () => go('preferences'))}
        </>
      )
      break
    case 'failure':
      title = '다시 찾아볼까요?'
      description = state.search?.message || '병원 정보를 확인하지 못했어요.'
      footer = primary('검색 조건 확인하기', () => go('request'))
      break
  }
  return (
    <ConciergeFrame
      step={step}
      title={title}
      description={description}
      onBack={back}
      onSettings={!['preferences', 'delete'].includes(step) ? openSettings : undefined}
      footer={footer}
    >
      {error && (
        <div className="concierge-error">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {content}
    </ConciergeFrame>
  )
}
