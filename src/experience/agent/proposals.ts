import { formatTime, formatWhen } from '../lib/time';
import type { PlanAction, Visit } from '../lib/types';
import type { CalendarEvent } from './actions';
import { pendingReply } from './plan';

/**
 * 에이전트가 진료 뒤에 미리 준비해 두는 일.
 * 준비만 하고 실행하지 않는다. 사용자가 내용을 보고 승인해야 실행된다.
 */
export interface Proposal {
  id: string;
  kind: 'ask' | 'calendar' | 'reminder' | 'booking';
  title: string;
  /** 실제로 나갈 내용. 승인 화면에 그대로 보여준다 */
  detail: string;
  /** 목록에서 보여줄 짧은 이름. 없으면 detail을 쓴다 */
  short?: string;
  /**
   * ready: 지금 실행할 수 있음 / choose: 사용자가 정할 것이 남음 / review: 온 답을 확인해야 함
   * waiting: 보냈고 답을 기다림 / blocked: 먼저 풀어야 할 것이 있음 / done: 끝남
   */
  state: 'ready' | 'choose' | 'review' | 'waiting' | 'blocked' | 'done';
  note?: string;
  actionId?: string;
  issueId?: string;
  infoId?: string;
  event?: CalendarEvent;
  link?: string;
}

export const calendarKey = (action: PlanAction) => `${action.when?.date}T${action.when?.time}|${action.title}`;

export function eventFor(visit: Visit, action: PlanAction): CalendarEvent {
  const { hospital, dept } = visit.appointment;
  return {
    title: action.kind === 'revisit' ? [hospital, dept, '진료'].filter(Boolean).join(' ') || '병원 진료' : action.title,
    date: action.when!.date!,
    time: action.when!.time!,
    location: hospital || undefined,
    alarmMinutesBefore: 60,
  };
}

export function deriveProposals(visit: Visit): Proposal[] {
  const plan = visit.plan;
  if (!plan) return [];
  const out: Proposal[] = [];

  for (const issue of plan.issues.filter((i) => i.state !== 'resolved')) {
    const waiting = visit.pending.some((p) => p.kind === 'confirm_time' && p.issueId === issue.id);
    const replied = !!pendingReply(issue, visit.sources);
    out.push({
      id: `ask-${issue.id}`, kind: 'ask', issueId: issue.id,
      title: replied ? '병원 답이 왔어요' : '병원에 물어보기',
      detail: issue.question,
      state: waiting ? 'waiting' : replied ? 'review' : 'ready',
      note: waiting ? '직원 화면에 질문을 올렸어요. 답을 기다리는 중이에요.' : replied ? '바꿀 내용을 확인해 주세요.' : undefined,
    });
  }

  for (const action of plan.actions.filter((a) => a.kind === 'revisit' || a.kind === 'test')) {
    const exec = visit.executions.find((e) => e.kind === 'calendar' && e.actionId === action.id);
    const fresh = exec && exec.payloadKey === calendarKey(action);
    const complete = action.status === 'ready' && action.when?.date && action.when.time;
    out.push({
      id: `cal-${action.id}`, kind: 'calendar', actionId: action.id,
      title: `${action.kind === 'revisit' ? '다음 진료' : action.title.replace(/ 받기$/, '')}를 캘린더에 넣기`,
      detail: formatWhen(action.when) || '날짜와 시간을 아직 몰라요',
      state: !complete ? 'blocked' : fresh ? 'done' : 'ready',
      note: !complete
        ? '병원 답을 받으면 넣을 수 있어요.'
        : fresh
          ? exec.via === 'google' ? '캘린더에 넣고 다시 확인했어요.' : '일정 파일을 만들었어요.'
          : exec ? '일정이 바뀌었어요. 다시 넣어야 해요.' : undefined,
      event: complete ? eventFor(visit, action) : undefined,
      link: fresh ? exec.link : undefined,
    });
  }

  const med = plan.actions.find((a) => a.kind === 'medication');
  if (med) {
    const exec = visit.executions.find((e) => e.kind === 'reminder' && e.actionId === med.id);
    out.push({
      id: `rem-${med.id}`, kind: 'reminder', actionId: med.id,
      title: '약 먹을 시간 알림 만들기',
      detail: med.conditions.join(' · ') || '먹는 방법을 아직 몰라요',
      state: med.status !== 'ready' ? 'blocked' : exec ? 'done' : 'choose',
      note: med.status !== 'ready'
        ? med.missing
        : exec ? `알림 시간: ${visit.reminderTimes.map(formatTime).join(', ')}` : '알림 받을 시간을 골라 주세요.',
      link: exec?.link,
    });
  }

  const bookable = plan.infos.find((i) => i.bookable);
  if (bookable) {
    const { state, subject, offer } = visit.booking;
    const name = subject ?? bookable.bookable!;
    out.push({
      id: `book-${bookable.id}`, kind: 'booking', infoId: bookable.id,
      title: state === 'offered' ? '병원이 시간을 알려 줬어요' : '병원에 물어보기',
      short: state === 'offered' ? undefined : `${name} 예약할 수 있는 날`,
      detail: state === 'offered' && offer ? formatWhen(offer) : `${name} 예약을 하고 싶어요. 할 수 있는 날짜와 시간을 알려 주세요.`,
      state: state === 'none' ? 'ready' : state === 'offered' ? 'review' : state === 'confirmed' ? 'done' : 'waiting',
      note:
        state === 'asked' ? '예약을 물어봤어요. 답을 기다리는 중이에요.'
          : state === 'requested' ? '예약을 부탁했어요. 답을 기다리는 중이에요.'
            : state === 'offered' ? '이 시간으로 할지 정해 주세요.'
              : state === 'confirmed' ? '병원이 예약을 접수했어요.' : undefined,
    });
  }
  return out;
}
