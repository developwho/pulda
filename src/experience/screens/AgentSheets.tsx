import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { buildICS, downloadFile, type CalendarEvent } from '../agent/actions';
import { googleCalendarAvailable, registerToGoogle } from '../agent/calendar';
import { formatDate, formatTime, todayISO } from '../lib/time';
import type { PlanAction, Visit } from '../lib/types';
import { mutate, recordExecution } from '../store/visit';
import { Notice, Sheet } from '../ui';

export const CALENDAR_ERROR: Record<string, string> = {
  STALE_PLAN: '진료 정보가 바뀌어 남은 등록을 멈췄어요. 새 내용을 확인해 주세요.',
  DENIED: 'Google 캘린더 사용을 허락하지 않았어요. 아래에서 파일로 받을 수 있어요.',
  MISMATCH: '캘린더에 저장된 시간이 보낸 시간과 달라요. 캘린더에서 확인해 주세요.',
  FAILED: '캘린더에 넣지 못했어요. 잠시 뒤 다시 하거나 파일로 받아 주세요.',
};

export interface CalendarOutcome {
  ok: boolean;
  via: 'google' | 'file';
  link?: string;
  error?: string;
}

/**
 * 일정을 실제로 넣는다. Google 캘린더를 쓸 수 있으면 넣은 뒤 다시 읽어 확인하고,
 * 아니면 일정 파일을 만든다. 파일은 "넣었다"가 아니라 "만들었다"로만 기록한다.
 */
export async function putOnCalendar(events: CalendarEvent[], prefer: 'google' | 'file'): Promise<CalendarOutcome> {
  if (prefer === 'google' && googleCalendarAvailable) {
    try {
      const registered = [];
      for (const event of events) registered.push(await registerToGoogle(event));
      return { ok: true, via: 'google', link: registered[0]?.link };
    } catch (error) {
      return { ok: false, via: 'google', error: CALENDAR_ERROR[(error as Error).message] ?? CALENDAR_ERROR.FAILED };
    }
  }
  const ok = downloadFile('pulda-일정.ics', buildICS(events));
  return { ok, via: 'file', error: ok ? undefined : '일정 파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.' };
}

export function OutcomeNotice({ outcome }: { outcome: CalendarOutcome | null }) {
  if (!outcome) return null;
  if (!outcome.ok) return <Notice tone="error">{outcome.error}</Notice>;
  if (outcome.via === 'google') {
    return (
      <Notice tone="ok" title="캘린더에 넣고 다시 확인했어요.">
        {outcome.link && (
          <a className="btn-text" href={outcome.link} target="_blank" rel="noreferrer">
            캘린더에서 보기
          </a>
        )}
      </Notice>
    );
  }
  return (
    <Notice tone="ok" title="일정 파일을 만들었어요.">
      내려받은 파일을 열어 캘린더에 넣어 주세요. 잘 들어갔는지는 캘린더 앱에서 확인해요.
    </Notice>
  );
}

const PRESETS = ['08:00', '13:00', '19:00', '22:00'];

/** 먹는 횟수와 기간은 안내 원문 그대로, 시각은 사용자가 고른다 (BR-04). */
export function ReminderSheet({ visit, action, onClose }: { visit: Visit; action: PlanAction; onClose: () => void }) {
  const [times, setTimes] = useState<string[]>(visit.reminderTimes);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CalendarOutcome | null>(null);
  const perDay = action.med?.perDay;
  const days = action.med?.days;
  const options = [...new Set([...PRESETS, ...times])].sort();
  const matches = !perDay || times.length === perDay;

  const toggle = (time: string) => {
    setOutcome(null);
    setTimes((prev) => (prev.includes(time) ? prev.filter((t) => t !== time) : [...prev, time].sort()));
  };

  const run = async (prefer: 'google' | 'file') => {
    const detail = action.conditions.filter((c) => !c.startsWith('하루')).join(', ');
    setBusy(true);
    const result = await putOnCalendar(
      times.map((time) => ({
        title: `약 먹을 시간${detail ? ` (${detail})` : ''}`,
        date: todayISO(),
        time,
        minutes: 10,
        repeatDays: days ?? 1,
      })),
      prefer,
    );
    setBusy(false);
    if (result.ok) {
      mutate((v) => {
        v.reminderTimes = times;
      });
      recordExecution('reminder', action.id, times.join(','), result.via, result.link);
    }
    setOutcome(result);
  };

  return (
    <Sheet open title="약 먹을 시간 알림" onClose={onClose}>
      <div className="stack">
        <div className="panel">
          <p className="sub">안내받은 내용</p>
          <p className="big-value">{action.conditions.join(' · ')}</p>
        </div>

        <div>
          <p className="label">언제 알려 줄까요?{perDay ? ` ${perDay}개를 골라요.` : ''}</p>
          <p className="hint">내가 밥 먹는 시간에 맞춰 직접 골라요.</p>
          <div className="chips mt8">
            {options.map((time) => (
              <button key={time} className="chip" aria-pressed={times.includes(time)} onClick={() => toggle(time)}>
                {formatTime(time)}
              </button>
            ))}
          </div>
          <div className="row mt16">
            <div className="field grow">
              <label htmlFor="rem-custom">다른 시간</label>
              <input id="rem-custom" className="input" type="time" value={custom} onChange={(e) => setCustom(e.target.value)} />
            </div>
            <button
              className="btn btn-secondary"
              style={{ alignSelf: 'flex-end' }}
              disabled={!custom || times.includes(custom)}
              onClick={() => {
                toggle(custom);
                setCustom('');
              }}
            >
              추가
            </button>
          </div>
        </div>

        <dl className="kv">
          <dt>시작</dt>
          <dd>오늘 ({formatDate(todayISO())})</dd>
          <dt>기간</dt>
          <dd>{days ? `${days}일 동안 매일` : '오늘 하루'}</dd>
        </dl>
        {!days && <p className="hint">며칠 동안 먹는지 안내가 없어서 오늘 하루만 만들어요.</p>}
        {!matches && (
          <Notice tone="warn">
            안내는 하루 {perDay}번이에요. 지금 {times.length}개를 골랐어요.
          </Notice>
        )}
        <OutcomeNotice outcome={outcome} />
        {outcome?.ok ? (
          <button className="btn btn-primary btn-block" onClick={onClose}>
            확인했어요
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary btn-block"
              disabled={!times.length || !matches || busy}
              onClick={() => run(googleCalendarAvailable ? 'google' : 'file')}
            >
              {busy && <Loader2 size={20} className="spin" aria-hidden />}
              {googleCalendarAvailable ? 'Google 캘린더에 알림 넣기' : '알림 일정 파일 만들기'}
            </button>
            {googleCalendarAvailable && (
              <button className="btn-text" disabled={!times.length || !matches || busy} onClick={() => run('file')}>
                파일로 받기
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
