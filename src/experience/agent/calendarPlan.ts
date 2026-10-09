import type { PlanAction, Visit } from '../lib/types';
import { eventBounds, type CalendarEvent } from './actions';

export interface CalendarChoice { selected: boolean; date: string; times: string[]; alarm: number }
export interface CalendarTask { actionId: string; kind: 'calendar' | 'reminder'; events: CalendarEvent[]; fingerprint: string }
export const calendarActions = (visit: Visit) => visit.plan?.actions.filter(a => ['revisit', 'test', 'medication'].includes(a.kind)) ?? [];
export const planFingerprint = (visit: Visit) => JSON.stringify({ actions: calendarActions(visit), sources: visit.sources, hospital: visit.appointment.hospital });

export function schedulingBlock(action: PlanAction) {
  if (action.status !== 'ready') return action.missing || '병원에 확인한 뒤 등록할 수 있어요.';
  if (action.kind === 'medication') {
    if (!Number.isInteger(action.med?.perDay) || !action.med?.perDay || action.med.perDay < 1 || action.med.perDay > 12) return '하루 복용 횟수를 의료진에게 확인해 주세요.';
    if (!Number.isInteger(action.med?.days) || !action.med?.days || action.med.days < 1 || action.med.days > 366) return '복용 기간을 의료진에게 확인해 주세요.';
  } else if (!action.when?.date || !action.when.time) return '방문 날짜와 시간을 병원에 확인해 주세요.';
  return '';
}

export function makeCalendarTask(visit: Visit, action: PlanAction, choice: CalendarChoice, now = Date.now()): CalendarTask {
  const blocked = schedulingBlock(action);
  if (blocked) throw new Error(blocked);
  const medication = action.kind === 'medication';
  const times = medication ? [...choice.times].sort() : [action.when!.time!];
  if (medication && (times.length !== action.med!.perDay || new Set(times).size !== times.length)) throw new Error('복용 횟수만큼 서로 다른 알림 시간을 골라 주세요.');
  if (times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || (medication && !/^\d{4}-\d{2}-\d{2}$/.test(choice.date))) throw new Error('시작 날짜와 모든 알림 시간을 입력해 주세요.');
  const events = times.map((time, slot): CalendarEvent => ({
    key: `${visit.id}/${action.id}/${slot}`,
    title: medication ? '약 먹을 시간' : action.kind === 'revisit' ? '병원 진료' : action.title,
    date: medication ? choice.date : action.when!.date!, time,
    minutes: medication ? 10 : 30,
    repeatDays: medication ? action.med!.days! : undefined,
    alarmMinutesBefore: medication ? 0 : choice.alarm,
    location: medication ? undefined : visit.appointment.hospital || undefined,
  }));
  for (const event of events) {
    try { eventBounds(event); } catch { throw new Error('날짜와 알림 설정을 다시 확인해 주세요.'); }
    if (new Date(`${event.date}T${event.time}:00+09:00`).getTime() <= now) throw new Error('지난 시각에는 알림을 만들 수 없어요. 시작 날짜와 시간을 다시 골라 주세요.');
  }
  return { actionId: action.id, kind: medication ? 'reminder' : 'calendar', events, fingerprint: JSON.stringify({ events, evidence: action.evidence, conditions: action.conditions }) };
}
