import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ChevronLeft, Loader2, Settings, Sparkles } from 'lucide-react'
import { agent, type RefineResult } from '../agent'
import { REQUEST_OPTIONS } from '../lib/demo'
import { formatDate, formatTime } from '../lib/time'
import type { Note, Preparation, Visit } from '../lib/types'
import { addTrace, getVisit, mutate, setPresenting, uid, useVisit } from '../store/visit'
import { finishPreparationSection, preparationOf, savePreparationNote } from '../store/preparation'
import { Notice } from '../ui'
import PreparationSummary from './PreparationSummary'
import '../styles/preparation.css'

const TITLES = {
  reason: '오늘 어떤 일로 병원에 가나요?',
  appointment: '병원 예약 정보가 있나요?',
  hospital: '어느 병원에 가나요?',
  schedule: '언제 방문하나요?',
  requests: '접수할 때 어떤 도움이 필요한가요?',
  summary: '',
}
const GROUP = { reason: 0, appointment: 1, hospital: 1, schedule: 1, requests: 2, summary: 3 }
const EMPTY_APPOINTMENT = { hospital: '', dept: '', date: '', time: '' }

export default function Prepare() {
  const visit = useVisit()!
  const prep = preparationOf(visit)
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  const request = useRef(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RefineResult | null>(null)
  const [direction, setDirection] = useState('forward')
  const step = prep.step

  const change = (fn: (p: Preparation, v: Visit) => void) =>
    mutate((v) => {
      v.preparation ??= preparationOf(v)
      fn(v.preparation, v)
    })
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
    setResult(null)
    setBusy(false)
    return () => {
      request.current++
    }
  }, [step])
  useEffect(() => {
    if (result) heading.current?.focus({ preventScroll: true })
  }, [result])

  const go = (next: Preparation['step'], back = false) => {
    setDirection(back ? 'back' : 'forward')
    change((p) => {
      p.step = next
    })
  }
  const consult = () => {
    request.current++
    mutate((v) => {
      if (v.stage === 'preparing') v.stage = 'consulting'
    })
    navigate('/consult')
  }
  const present = (lines: string[]) => {
    setPresenting(lines)
    navigate('/present')
  }
  const edit = (next: Preparation['step'], noteId?: string) => {
    setDirection('forward')
    change((p, v) => {
      p.editing = true
      p.step = next
      if (next === 'reason') {
        p.noteId = noteId
        p.reason =
          v.notes.find((note) => note.id === noteId)?.text ?? (v.notes.length ? '' : p.reason)
      }
      if (next === 'appointment') p.appointmentDraft = { ...v.appointment }
      if (next === 'requests') p.requestsDraft = [...v.requests]
    })
  }
  const saveReason = (text = prep.reason, chosen: Note['chosen'] = 'raw') => {
    request.current++
    change((p, v) => {
      savePreparationNote(v, text, chosen, uid('note'))
      finishPreparationSection(p, 'appointment')
    })
  }
  const refine = async () => {
    const sequence = ++request.current
    const raw = prep.reason
    setBusy(true)
    setResult(null)
    try {
      const response = await agent.refine(raw)
      if (
        sequence !== request.current ||
        getVisit()?.id !== visit.id ||
        preparationOf(getVisit()!).reason !== raw
      )
        return
      addTrace(response.trace)
      setResult(response.result)
    } catch {
      if (sequence === request.current)
        setResult({
          kind: 'failed',
          reason: '문장을 다듬지 못했어요. 적은 말 그대로 계속할 수 있어요.',
        })
    } finally {
      if (sequence === request.current) setBusy(false)
    }
  }
  const back = () => {
    setDirection('back')
    if (result) {
      setResult(null)
      return
    }
    if (prep.editing) {
      change((p) => {
        p.step = 'summary'
        p.editing = false
      })
      return
    }
    if (step === 'reason') {
      navigate('/settings')
      return
    }
    go(
      step === 'schedule'
        ? 'hospital'
        : step === 'hospital'
          ? 'appointment'
          : step === 'requests'
            ? 'appointment'
            : 'reason',
      true,
    )
  }
  const appointmentDone = (none = false) =>
    change((p, v) => {
      p.appointmentChoice = none ? 'no' : 'yes'
      v.appointment = none ? { ...EMPTY_APPOINTMENT } : { ...p.appointmentDraft }
      finishPreparationSection(p, 'requests')
    })
  const requestsDone = (none = false) =>
    change((p, v) => {
      if (none) p.requestsDraft = []
      v.requests = [...p.requestsDraft]
      p.complete = true
      p.editing = false
      p.step = 'summary'
    })
  const knownAppointment = Object.values(visit.appointment).some(Boolean)
  const reviewing = result?.kind === 'refined'
  const title = reviewing ? '이렇게 전달하면 어떨까요?' : TITLES[step]

  if (step === 'summary')
    return <PreparationSummary visit={visit} edit={edit} present={present} consult={consult} />

  return (
    <div className="screen prepare-flow">
      <header className="bar prepare-flow-bar">
        {step === 'reason' && !prep.editing && !result ? (
          <Link className="icon-btn" to="/settings" aria-label="보관과 삭제">
            <Settings size={22} aria-hidden />
          </Link>
        ) : (
          <button
            className="icon-btn"
            onClick={back}
            aria-label={prep.editing ? '수정 취소' : '이전 단계'}
          >
            <ChevronLeft size={24} aria-hidden />
          </button>
        )}
        <span className="prepare-flow-label">진료 준비</span>
        <button className="btn-text prepare-shortcut" onClick={consult}>
          바로 진료 중으로
        </button>
      </header>
      <div className="prepare-progress" aria-label={`진료 준비 ${GROUP[step] + 1} / 3단계`}>
        {['전달할 말', '예약 정보', '접수 부탁'].map((label, i) => (
          <span
            key={label}
            className={i <= GROUP[step] ? 'active' : ''}
            aria-current={i === GROUP[step] ? 'step' : undefined}
          >
            <i />
            {label}
          </span>
        ))}
      </div>
      <main className={`body prepare-step ${direction}`} key={step + String(reviewing)}>
        <h1 className="title" tabIndex={-1} ref={heading}>
          {title}
        </h1>
        {step === 'reason' && (
          <>
            <p className="lead">
              불편한 곳이나 방문 이유를 적어 주세요.
              <br />
              짧게 적어도 괜찮아요.
            </p>
            {reviewing ? (
              <div className="prepare-review">
                <div>
                  <p className="label">내가 적은 말</p>
                  <p className="quote mt8">{prep.reason}</p>
                </div>
                <div>
                  <p className="label">다듬은 문장</p>
                  <p className="quote mt8 big-value">{result.text}</p>
                </div>
                <p className="hint">뜻과 숫자가 그대로인지 확인해 주세요.</p>
                <button
                  className="btn-text"
                  onClick={() => {
                    const text = result.text
                    change((p) => {
                      p.reason = text
                    })
                    setResult(null)
                  }}
                >
                  직접 고치기
                </button>
              </div>
            ) : (
              <div className="prepare-input-group">
                <label className="sr-only" htmlFor="prepare-reason">
                  방문 이유
                </label>
                <textarea
                  id="prepare-reason"
                  className="textarea prepare-reason"
                  maxLength={4000}
                  placeholder={'예: 배가 3일째 아파요. 밤에 더 심해요.\n검사 결과를 들으러 왔어요.'}
                  value={prep.reason}
                  onChange={(e) => {
                    request.current++
                    setBusy(false)
                    setResult(null)
                    const value = e.target.value
                    change((p) => {
                      p.reason = value
                    })
                  }}
                />
                <button
                  className="btn-text prepare-refine"
                  disabled={!prep.reason.trim() || busy}
                  onClick={() => void refine()}
                >
                  {busy ? (
                    <Loader2 size={18} className="spin" aria-hidden />
                  ) : (
                    <Sparkles size={18} aria-hidden />
                  )}
                  {busy ? '문장을 다듬고 있어요' : '전달하기 쉽게 다듬기'}
                </button>
                {result && <Notice>{result.reason}</Notice>}
              </div>
            )}
          </>
        )}
        {step === 'appointment' && (
          <>
            <p className="lead">예약이 없어도 준비할 수 있어요.</p>
            {knownAppointment ? (
              <div className="prepare-known">
                <span className="label">이미 적어 둔 예약</span>
                <p className="item-title">
                  {[visit.appointment.hospital, visit.appointment.dept]
                    .filter(Boolean)
                    .join(' · ') || '병원 이름 미정'}
                </p>
                <p>
                  {[
                    visit.appointment.date && formatDate(visit.appointment.date),
                    visit.appointment.time && formatTime(visit.appointment.time),
                  ]
                    .filter(Boolean)
                    .join(' ') || '날짜·시간 미정'}
                </p>
                <button
                  className="btn btn-primary btn-block"
                  onClick={() =>
                    change((p, v) => {
                      p.appointmentDraft = { ...v.appointment }
                      p.appointmentChoice = 'yes'
                      finishPreparationSection(p, 'requests')
                    })
                  }
                >
                  이 예약으로 계속
                </button>
              </div>
            ) : null}
            <div className="prepare-options">
              <button className="prepare-option" onClick={() => go('hospital')}>
                <span>{knownAppointment ? '예약 정보를 고칠게요' : '네, 예약했어요'}</span>
                <ArrowRight size={22} aria-hidden />
              </button>
              <button className="prepare-option" onClick={() => appointmentDone(true)}>
                <span>
                  {knownAppointment ? '예약 정보 없이 진행할게요' : '아니요, 예약이 없어요'}
                </span>
                <ArrowRight size={22} aria-hidden />
              </button>
            </div>
            <Link className="prepare-find-link" to="/concierge">
              아직 병원을 찾고 있나요? 병원 찾기
            </Link>
          </>
        )}
        {step === 'hospital' && (
          <>
            <p className="lead">아는 정보만 적어 주세요.</p>
            <div className="prepare-input-group field">
              <label htmlFor="prepare-hospital">병원 이름</label>
              <input
                className="input"
                id="prepare-hospital"
                autoComplete="off"
                maxLength={150}
                placeholder="예: 한빛내과의원"
                value={prep.appointmentDraft.hospital}
                onChange={(e) => {
                  const value = e.target.value
                  change((p) => {
                    p.appointmentDraft.hospital = value
                  })
                }}
              />
            </div>
            <details className="prepare-department">
              <summary>진료과도 알고 있어요 (선택)</summary>
              <div className="field">
                <label htmlFor="prepare-dept">진료과</label>
                <input
                  className="input"
                  id="prepare-dept"
                  autoComplete="off"
                  maxLength={100}
                  value={prep.appointmentDraft.dept}
                  onChange={(e) => {
                    const value = e.target.value
                    change((p) => {
                      p.appointmentDraft.dept = value
                    })
                  }}
                />
              </div>
            </details>
          </>
        )}
        {step === 'schedule' && (
          <>
            <p className="lead">
              예약한 날짜와 시간을 적어 주세요.
              <br />
              아직 모르면 비워 두어도 괜찮아요.
            </p>
            <div className="prepare-input-group stack">
              <div className="field">
                <label htmlFor="prepare-date">날짜</label>
                <input
                  className="input"
                  type="date"
                  id="prepare-date"
                  value={prep.appointmentDraft.date}
                  onChange={(e) => {
                    const value = e.target.value
                    change((p) => {
                      p.appointmentDraft.date = value
                    })
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="prepare-time">시간</label>
                <input
                  className="input"
                  type="time"
                  id="prepare-time"
                  value={prep.appointmentDraft.time}
                  onChange={(e) => {
                    const value = e.target.value
                    change((p) => {
                      p.appointmentDraft.time = value
                    })
                  }}
                />
              </div>
            </div>
            <p className="hint mt24">
              이 앱에 적어 두는 정보예요. 병원에 예약을 신청하는 것은 아니에요.
            </p>
          </>
        )}
        {step === 'requests' && (
          <>
            <p className="lead">
              접수 직원에게 보여줄 부탁을 골라요.
              <br />
              여러 개를 골라도 괜찮아요.
            </p>
            <div className="prepare-options">
              {REQUEST_OPTIONS.map((text) => {
                const selected = prep.requestsDraft.includes(text)
                return (
                  <button
                    className="choice"
                    aria-pressed={selected}
                    key={text}
                    onClick={() =>
                      change((p) => {
                        p.requestsDraft = selected
                          ? p.requestsDraft.filter((r) => r !== text)
                          : [...p.requestsDraft, text]
                      })
                    }
                  >
                    <span className="check" aria-hidden>
                      {selected && <Check size={20} />}
                    </span>
                    {text}
                  </button>
                )
              })}
            </div>
            {prep.requestsDraft.some((text) => text.includes('수어통역')) && (
              <p className="hint mt16">
                통역을 부탁하는 문구예요. 통역사가 자동으로 연결되지는 않아요.
              </p>
            )}
          </>
        )}
      </main>
      {step !== 'appointment' && (
        <footer className="cta prepare-flow-footer">
          {step === 'reason' && (
            <>
              <button
                className="btn btn-primary btn-block"
                disabled={!prep.reason.trim()}
                onClick={() => (reviewing ? saveReason(result.text, 'refined') : saveReason())}
              >
                {reviewing ? '이 문장으로 계속' : prep.editing ? '수정 완료' : '다음'}
                <ArrowRight size={20} aria-hidden />
              </button>
              <button
                className="btn-text"
                onClick={() =>
                  reviewing
                    ? saveReason()
                    : change((p) => finishPreparationSection(p, 'appointment'))
                }
              >
                {reviewing
                  ? '내가 적은 말 그대로 사용'
                  : prep.editing
                    ? '수정 취소'
                    : '나중에 적을게요'}
              </button>
              {prep.editing && prep.noteId && !reviewing && (
                <button
                  className="btn-text prepare-delete"
                  onClick={() =>
                    change((p, v) => {
                      v.notes = v.notes.filter((note) => note.id !== p.noteId)
                      p.reason = ''
                      p.noteId = undefined
                      p.step = 'summary'
                      p.editing = false
                    })
                  }
                >
                  이 말 지우기
                </button>
              )}
            </>
          )}
          {step === 'hospital' && (
            <button className="btn btn-primary btn-block" onClick={() => go('schedule')}>
              다음
              <ArrowRight size={20} aria-hidden />
            </button>
          )}
          {step === 'schedule' && (
            <button className="btn btn-primary btn-block" onClick={() => appointmentDone()}>
              {prep.editing ? '수정 완료' : '다음'}
              <ArrowRight size={20} aria-hidden />
            </button>
          )}
          {step === 'requests' && (
            <>
              <button className="btn btn-primary btn-block" onClick={() => requestsDone()}>
                {prep.requestsDraft.length
                  ? prep.editing
                    ? '수정 완료'
                    : '선택 완료'
                  : '부탁할 내용 없어요'}
                <Check size={20} aria-hidden />
              </button>
              {prep.requestsDraft.length > 0 && (
                <button className="btn-text" onClick={() => requestsDone(true)}>
                  부탁할 내용 없어요
                </button>
              )}
            </>
          )}
        </footer>
      )}
    </div>
  )
}
