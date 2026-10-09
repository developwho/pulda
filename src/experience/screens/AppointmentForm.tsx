import { useState } from 'react';
import type { Appointment } from '../lib/types';

interface Props {
  initial?: Partial<Appointment>;
  submitLabel: string;
  onSubmit: (appointment: Appointment) => void;
}

/** 모든 칸은 비워 둘 수 있다. 저장은 병원 예약을 새로 만들지 않는다 (FR-001). */
export default function AppointmentForm({ initial, submitLabel, onSubmit }: Props) {
  const [form, setForm] = useState<Appointment>({ hospital: '', dept: '', date: '', time: '', ...initial });
  const field = (key: keyof Appointment) => ({
    id: `appt-${key}`,
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <p className="sub">아는 것만 적어요. 비워 두어도 괜찮아요.</p>
      <div className="field">
        <label htmlFor="appt-hospital">병원 이름</label>
        <input className="input" autoComplete="off" {...field('hospital')} />
      </div>
      <div className="field">
        <label htmlFor="appt-dept">진료과</label>
        <input className="input" autoComplete="off" {...field('dept')} />
      </div>
      <div className="field">
        <label htmlFor="appt-date">날짜</label>
        <input className="input" type="date" {...field('date')} />
      </div>
      <div className="field">
        <label htmlFor="appt-time">시간</label>
        <input className="input" type="time" {...field('time')} />
      </div>
      <button className="btn btn-primary btn-block mt8" type="submit">
        {submitLabel}
      </button>
      <p className="hint">이 앱에 적어 두는 것이에요. 병원에 예약을 하는 것은 아니에요.</p>
    </form>
  );
}
