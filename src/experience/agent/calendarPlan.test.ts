import { describe, expect, it } from 'vitest';
import { makeCalendarTask, schedulingBlock } from './calendarPlan';
import { buildICS, eventBounds } from './actions';
import type { PlanAction, Visit } from '../lib/types';

const med: PlanAction = { id: 'med', kind: 'medication', title: '약 먹기', status: 'ready', med: { perDay: 2, days: 7 }, conditions: ['식후 30분'], evidence: [{ sourceId: 'rx', quote: '7일 동안 하루 2회 식후 30분' }], issueIds: [] };
const visit = { id: 'visit-a', appointment: { hospital: '예시 의원' } } as Visit;
const choice = { selected: true, date: '2026-10-10', times: ['19:00','08:00'], alarm: 60 };
const now = Date.parse('2026-10-09T00:00:00+09:00');
describe('analysis to calendar plan', () => {
  it('uses prescribed frequency and duration with user-selected times, without exporting clinical text', () => {
    const result = makeCalendarTask(visit, med, choice, now);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ time: '08:00', repeatDays: 7, alarmMinutesBefore: 0, title: '약 먹을 시간', key: 'visit-a/med/0' });
    expect(JSON.stringify(result.events)).not.toContain('식후');
  });
  it('blocks unknown duration, uncertain medication and duplicate or missing times', () => {
    expect(schedulingBlock({ ...med, med: { perDay: 2 } })).toContain('기간');
    expect(() => makeCalendarTask(visit, { ...med, status: 'needs_provider' }, choice, now)).toThrow();
    expect(() => makeCalendarTask(visit, med, { ...choice, times: ['08:00','08:00'] }, now)).toThrow();
    expect(() => makeCalendarTask(visit, med, { ...choice, times: ['08:00',''] }, now)).toThrow();
  });
  it('blocks past start times and invalid dates', () => {
    expect(() => makeCalendarTask(visit, med, choice, Date.parse('2026-10-10T09:00:00+09:00'))).toThrow('지난');
    expect(() => makeCalendarTask(visit, med, { ...choice, date: '2026-02-30' }, now)).toThrow();
  });
  it('keeps identity stable across edited schedules but changes the approval fingerprint', () => {
    const before = makeCalendarTask(visit, med, choice, now);
    const after = makeCalendarTask(visit, med, { ...choice, times: ['09:00','20:00'] }, now);
    expect(before.events[0].key).toBe(after.events[0].key);
    expect(before.fingerprint).not.toBe(after.fingerprint);
  });
  it('carries calendar event end over midnight in both Google and ICS inputs', () => {
    const event = { title: '알림', date: '2026-12-31', time: '23:55', minutes: 10 };
    expect(eventBounds(event).end).toBe('2027-01-01T00:05:00');
    expect(buildICS([event])).toContain('DTEND;TZID=Asia/Seoul:20270101T000500');
  });
});
