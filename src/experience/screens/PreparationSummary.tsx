import { Link } from 'react-router-dom'
import { CalendarDays, Check, Maximize2, Pencil, Plus, Settings } from 'lucide-react'
import { formatDate, formatTime } from '../lib/time'
import type { Preparation, Visit } from '../lib/types'
import { DemoTag, Screen } from '../ui'

interface Props {
  visit: Visit
  edit: (step: Preparation['step'], noteId?: string) => void
  present: (lines: string[]) => void
  consult: () => void
}

export default function PreparationSummary({ visit, edit, present, consult }: Props) {
  const { hospital, dept, date, time } = visit.appointment
  const hasAppointment = hospital || dept || date || time
  const message = visit.notes
    .map((note) => note.text)
    .filter(Boolean)
    .join('\n\n')
  return (
    <Screen
      label="준비"
      title={visit.stage === 'preparing' ? '진료 준비가 끝났어요.' : '준비한 내용을 확인해요.'}
      tabs
      right={
        <Link className="icon-btn" to="/settings" aria-label="보관과 삭제">
          <Settings size={22} aria-hidden />
        </Link>
      }
      footer={
        <div className="prepare-summary-actions">
          {visit.requests.length > 0 && (
            <button className="btn btn-primary btn-block" onClick={() => present(visit.requests)}>
              <Maximize2 size={20} aria-hidden />
              접수할 때 보여주기
            </button>
          )}
          <button
            className={`btn btn-block ${visit.requests.length ? 'btn-secondary' : 'btn-primary'}`}
            onClick={consult}
          >
            {visit.stage === 'aftercare' ? '진료 대화 다시 보기' : '진료실에 들어왔어요'}
          </button>
        </div>
      }
    >
      <p className="lead">
        필요할 때 꺼내 보여주세요.
        <br />
        내용은 언제든 고칠 수 있어요.
      </p>
      {visit.demo && (
        <p className="mt16">
          <DemoTag />
        </p>
      )}
      <section className="prepare-summary-section">
        <div className="section-head">
          <h2 className="section-title">이번 진료</h2>
          <button className="link" onClick={() => edit('appointment')}>
            예약 정보 수정
          </button>
        </div>
        {hasAppointment ? (
          <div className="row">
            <CalendarDays size={22} aria-hidden />
            <div>
              <p className="item-title">
                {[hospital, dept].filter(Boolean).join(' · ') || '병원 이름 미정'}
              </p>
              <p className="item-when">
                {[date && formatDate(date), time && formatTime(time)].filter(Boolean).join(' ') ||
                  '날짜·시간 미정'}
              </p>
              <p className="hint">내가 입력하거나 확인한 정보예요.</p>
            </div>
          </div>
        ) : (
          <p className="sub">예약 정보 없이 준비했어요.</p>
        )}
      </section>
      <section className="prepare-summary-section">
        <div className="section-head">
          <h2 className="section-title">의사에게 전달할 말</h2>
        </div>
        {message ? (
          <div className="prepare-summary-note">
            <p>{message}</p>
            <button
              className="icon-btn"
              aria-label="전달할 말 크게 보기"
              title="전달할 말 크게 보기"
              onClick={() => present([message])}
            >
              <Maximize2 size={21} aria-hidden />
            </button>
          </div>
        ) : (
          <p className="sub">아직 적은 말이 없어요. 나중에 추가해도 괜찮아요.</p>
        )}
        <button className="btn-text" onClick={() => edit('reason')}>
          <Plus size={17} aria-hidden />
          전달할 말 추가
        </button>
      </section>
      <section className="prepare-summary-section">
        <div className="section-head">
          <h2 className="section-title">접수할 때 부탁할 것</h2>
          <button
            className="icon-btn"
            aria-label="부탁 수정"
            title="부탁 수정"
            onClick={() => edit('requests')}
          >
            <Pencil size={20} aria-hidden />
          </button>
        </div>
        {visit.requests.length ? (
          <ul className="prepare-request-summary">
            {visit.requests.map((request) => (
              <li key={request}>
                <Check size={19} aria-hidden />
                <span>{request}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub">따로 부탁할 내용은 없어요.</p>
        )}
      </section>
      <Link to="/concierge" className="prepare-find-link">
        병원 찾기 · 문의 준비
      </Link>
    </Screen>
  )
}
