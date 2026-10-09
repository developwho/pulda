import { useState } from 'react'
import { Button, Notice, Sheet } from './components'
import { demoTranscript } from './model'
import type { Phase, Visit } from './model'

export function Start({
  visit,
  update,
  go,
}: {
  visit: Visit
  update: (patch: Partial<Visit>) => void
  go: (phase: Phase) => void
}) {
  const [appointment, setAppointment] = useState(false)
  const [hospital, setHospital] = useState(visit.hospital)
  const [date, setDate] = useState(visit.date)
  const [time, setTime] = useState(visit.time)
  return (
    <section className="start-page">
      <h1>병원 진료를 함께 준비해요.</h1>
      <ol className="start-steps" aria-label="풀다가 돕는 일">
        {['할 말을 미리 준비해요', '진료 중 자막을 읽어요', '진료 후 할 일을 정리해요'].map(
          (step, index) => (
            <li key={step}>
              <span aria-hidden="true">{index + 1}</span>
              {step}
            </li>
          ),
        )}
      </ol>
      <div className="start-actions">
        <Button onClick={() => setAppointment(true)}>예약 정보 적고 시작</Button>
        <Button variant="secondary" onClick={() => go('prepare')}>
          예약 없이 시작
        </Button>
      </div>
      <div className="start-shortcuts">
        <button className="text-action" onClick={() => go('consult')}>
          지금 진료 중이에요
        </button>
        <button
          className="text-action"
          onClick={() => {
            update({ consultationCompleted: true })
            go('review')
          }}
        >
          진료를 마쳤어요
        </button>
      </div>
      {!visit.note && !visit.sources.length && (
        <section className="start-example">
          <h2>예시로 먼저 보기</h2>
          <p>만든 예시 진료로 처음부터 끝까지 볼 수 있어요. 실제 진료 내용이 아니에요.</p>
          <Button
            variant="secondary"
            onClick={() => {
              update({ hospital: '풀다 예시 의원', sources: demoTranscript })
              go('prepare')
            }}
          >
            예시 진료 열기
          </Button>
        </section>
      )}
      <p className="small-note start-disclosure">
        진료 후에는 입력한 기록을 OpenAI에 보내 할 일을 자동으로 정리해요. 분석 결과는 원문과 함께
        확인해 주세요.
      </p>
      {appointment && (
        <Sheet title="예약 정보" onClose={() => setAppointment(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              update({ hospital, date, time })
              go('prepare')
            }}
          >
            <label className="form-field">
              병원 이름 · 선택
              <input
                value={hospital}
                maxLength={100}
                onChange={(event) => setHospital(event.target.value)}
              />
            </label>
            <label className="form-field">
              진료 날짜 · 선택
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="form-field">
              진료 시간 · 선택
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
            <Notice>아는 내용만 적어도 괜찮아요. 병원 예약을 신청하거나 변경하지 않아요.</Notice>
            <Button type="submit">이 정보로 시작</Button>
          </form>
        </Sheet>
      )}
    </section>
  )
}
