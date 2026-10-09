import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Check, ChevronRight, MessageCircle } from 'lucide-react'
import { Button, Notice, SectionTitle, Sheet } from './components'
import { arrangeNote, requestOptions } from './model'
import type { Visit } from './model'
import { api, errorMessage } from './api'

type Props = {
  visit: Visit
  update: (patch: Partial<Visit>) => void
  present: (lines: string[]) => void
  finish: () => void
}
export function Prepare({ visit, update, present, finish }: Props) {
  const [modal, setModal] = useState<'appointment' | 'note' | 'requests' | null>(null)
  const [appointment, setAppointment] = useState({
    hospital: visit.hospital,
    date: visit.date,
    time: visit.time,
  })
  useEffect(
    () => setAppointment({ hospital: visit.hospital, date: visit.date, time: visit.time }),
    [visit.hospital, visit.date, visit.time],
  )
  const [selectedNote, setSelectedNote] = useState(true)
  const [candidate, setCandidate] = useState('')
  const [candidateOrigin, setCandidateOrigin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const latestNote = useRef(visit.note)
  latestNote.current = visit.note
  useEffect(() => () => request.current?.abort(), [])
  const closeNote = () => {
    request.current?.abort()
    setBusy(false)
    setModal(null)
  }
  const prepare = async () => {
    const original = visit.note
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const result = await api<{ candidate: string }>('prepare', { original }, controller.signal)
      if (!controller.signal.aborted && latestNote.current === original)
        setCandidate(result.candidate)
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const chosen = [...(selectedNote && visit.prepared ? [visit.prepared] : []), ...visit.requests]
  const toggleRequest = (value: string) =>
    update({
      requests: visit.requests.includes(value)
        ? visit.requests.filter((x) => x !== value)
        : [...visit.requests, value],
    })
  return (
    <>
      <header className="page-heading">
        <h1>
          진료 전에,
          <br />내 이야기를 준비해요
        </h1>
      </header>
      <section className="prepare-note">
        <SectionTitle>전달할 말</SectionTitle>
        <label className="sr-only" htmlFor="patient-note">
          현재 내 상태를 적어 주세요.
        </label>
        <div className="textarea-wrap">
          <textarea
            id="patient-note"
            placeholder={'짧게 적어도 돼요.\n예시: 배 아픔 3일 밤 계속 심함'}
            value={visit.note}
            maxLength={2000}
            onChange={(e) => update({ note: e.target.value, prepared: '' })}
          />
          <span className="counter">{visit.note.length.toLocaleString()}/2,000</span>
        </div>
        <button
          className="text-action note-action"
          disabled={!visit.note.trim()}
          onClick={() => {
            if (candidateOrigin !== visit.note) {
              setCandidate(arrangeNote(visit.note))
              setCandidateOrigin(visit.note)
            }
            setModal('note')
          }}
        >
          {visit.prepared ? '정리한 말 수정하기' : '내 말 정리하기'}
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        {visit.prepared && (
          <label className="request-option selected-note">
            <input
              type="checkbox"
              checked={selectedNote}
              onChange={(e) => setSelectedNote(e.target.checked)}
            />
            <span>정리한 말을 함께 보여줘요</span>
          </label>
        )}
      </section>
      <div className="summary-list">
        <button className="summary-row" onClick={() => setModal('requests')} aria-haspopup="dialog">
          <MessageCircle size={22} aria-hidden="true" />
          <span>
            <strong>소통 요청</strong>
            <small>
              {visit.requests.length
                ? `${visit.requests.length}개 선택했어요`
                : '편한 방법을 골라 주세요'}
            </small>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        <button
          className="summary-row"
          aria-haspopup="dialog"
          onClick={() => {
            setModal('appointment')
          }}
        >
          <CalendarDays size={22} aria-hidden="true" />
          <span>
            <strong>{visit.hospital || '이번 진료'}</strong>
            <small>
              {[visit.date, visit.time].filter(Boolean).join(' ') || '예약 정보 추가 · 선택'}
            </small>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <Button
        className="main-action"
        onClick={() => {
          if (visit.note.trim() && !visit.prepared) update({ prepared: arrangeNote(visit.note) })
          finish()
        }}
      >
        준비 완료하고 진료 시작 <ArrowRight size={20} aria-hidden="true" />
      </Button>
      <Button
        variant="secondary"
        className="main-action"
        disabled={!chosen.length}
        onClick={() => present(chosen)}
      >
        선택한 내용 보여주기
        <ArrowRight size={20} aria-hidden="true" />
      </Button>
      {modal === 'requests' && (
        <Sheet title="편한 소통 방법을 골라요" onClose={() => setModal(null)}>
          <p className="small-note">여러 개를 골라도 좋아요.</p>
          <div className="request-list">
            {requestOptions.map((option) => (
              <label className="request-option" key={option.title}>
                <input
                  type="checkbox"
                  checked={visit.requests.includes(option.title)}
                  onChange={() => toggleRequest(option.title)}
                />
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
          {visit.requests.includes(requestOptions[2].title) && (
            <p className="small-note">
              통역 요청을 화면으로 보여줘요. 통역사 연결이나 배정은 병원에 확인해 주세요.
            </p>
          )}
          <Button onClick={() => setModal(null)}>선택 마치기</Button>
        </Sheet>
      )}
      {modal === 'appointment' && (
        <Sheet title="이번 진료를 적어요" onClose={() => setModal(null)}>
          <p>아는 내용만 적어도 괜찮아요.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              update(appointment)
              setModal(null)
            }}
          >
            <label className="form-field">
              병원 이름 <span className="muted">선택</span>
              <input
                value={appointment.hospital}
                maxLength={100}
                onChange={(e) => setAppointment({ ...appointment, hospital: e.target.value })}
                placeholder="병원 이름을 적어 주세요"
              />
            </label>
            <div className="form-grid">
              <label className="form-field">
                진료 날짜 <span className="muted">선택</span>
                <input
                  type="date"
                  value={appointment.date}
                  onChange={(e) => setAppointment({ ...appointment, date: e.target.value })}
                />
              </label>
              <label className="form-field">
                진료 시간 <span className="muted">선택</span>
                <input
                  type="time"
                  value={appointment.time}
                  onChange={(e) => setAppointment({ ...appointment, time: e.target.value })}
                />
              </label>
            </div>
            <Notice>이 화면에만 적어 둬요. 병원 예약을 신청하거나 변경하지 않아요.</Notice>
            <div className="button-row">
              <Button variant="secondary" type="button" onClick={() => setModal(null)}>
                닫기
              </Button>
              <Button type="submit">정보 적용하기</Button>
            </div>
          </form>
        </Sheet>
      )}
      {modal === 'note' && (
        <Sheet title="내 말과 비교해요" onClose={closeNote}>
          <Notice>
            적지 않은 진단이나 복용법은 추가하지 않아요. 원문과 비교하고 선택해 주세요.
          </Notice>
          <h3>내가 적은 원문</h3>
          <blockquote className="preserve-lines">{visit.note}</blockquote>
          <details className="record-disclosure">
            <summary>AI로 읽기 쉽게 다듬기</summary>
            <p className="small-note">
              적은 글을 OpenAI에 보내 문장을 다듬어요. 처리 업체는 최대 30일 보관할 수 있어요.
              의미가 바뀌지 않았는지 확인한 뒤에만 사용해 주세요.
            </p>
            <Button variant="secondary" disabled={busy} onClick={() => void prepare()}>
              {busy ? '뜻이 같은지 확인하고 있어요' : '동의하고 문장 다듬기'}
            </Button>
          </details>
          {error && (
            <div role="alert">
              <Notice warning>{error}</Notice>
            </div>
          )}
          <label className="form-field">
            보여줄 말
            <textarea
              value={candidate}
              disabled={busy}
              onChange={(e) => setCandidate(e.target.value)}
              maxLength={2000}
            />
          </label>
          <p className="small-note">
            아닌 것, 언제부터인지, 기간·숫자·부위, 확실하지 않은 내용이 그대로인지 확인해 주세요.
          </p>
          <div className="button-row">
            <Button variant="secondary" onClick={closeNote}>
              닫기
            </Button>
            <Button
              disabled={!candidate.trim() || busy}
              onClick={() => {
                update({ prepared: candidate.trim() })
                setSelectedNote(true)
                setModal(null)
              }}
            >
              <Check size={18} aria-hidden="true" />이 말 선택하기
            </Button>
          </div>
        </Sheet>
      )}
    </>
  )
}
