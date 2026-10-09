import { isMockMode } from '../runtime';
const compact = (date: string, time: string) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
const escapeText = (text: string) => text.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

export interface CalendarEvent {
  /** Stable per-visit/action slot: retries update the same Google event. */
  key?: string;
  title: string;
  date: string;
  time: string;
  location?: string;
  minutes?: number;
  /** 매일 반복 횟수 */
  repeatDays?: number;
  alarmMinutesBefore?: number;
}

export function eventBounds(event: CalendarEvent) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !/^\d{2}:\d{2}$/.test(event.time)) throw new Error('INVALID_EVENT');
  const start = new Date(`${event.date}T${event.time}:00+09:00`);
  const localStamp = (value: Date) => new Date(value.getTime() + 9 * 3600000).toISOString().slice(0, 19);
  if (!Number.isFinite(start.getTime()) || localStamp(start).slice(0, 16) !== `${event.date}T${event.time}` ||
      !Number.isInteger(event.minutes ?? 30) || (event.minutes ?? 30) < 1 ||
      !Number.isInteger(event.repeatDays ?? 1) || (event.repeatDays ?? 1) < 1 || (event.repeatDays ?? 1) > 366 ||
      !Number.isInteger(event.alarmMinutesBefore ?? 0) || (event.alarmMinutesBefore ?? 0) < 0 || (event.alarmMinutesBefore ?? 0) > 40320) throw new Error('INVALID_EVENT');
  return { start: localStamp(start), end: localStamp(new Date(start.getTime() + (event.minutes ?? 30) * 60000)) };
}

export function buildICS(events: CalendarEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pulda//Visit//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE'];
  events.forEach((e, i) => {
    const bounds = eventBounds(e);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.key ? encodeURIComponent(e.key) : `${stamp}-${i}`}@pulda.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Seoul:${compact(e.date, e.time)}`,
      `DTEND;TZID=Asia/Seoul:${bounds.end.replace(/[-:]/g, '')}`,
      `SUMMARY:${escapeText(`${isMockMode ? '[목업] ' : ''}${e.title}`)}`,
    );
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.repeatDays && e.repeatDays > 1) lines.push(`RRULE:FREQ=DAILY;COUNT=${e.repeatDays}`);
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(e.title)}`,
      `TRIGGER:-PT${e.alarmMinutesBefore ?? 0}M`,
      'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(line => {
    let folded = '', length = 0;
    for (const char of line) {
      const bytes = new TextEncoder().encode(char).length;
      if (length + bytes > 75) { folded += '\r\n '; length = 1; }
      folded += char; length += bytes;
    }
    return folded;
  }).join('\r\n') + '\r\n';
}

/** Opening the OS share sheet is a handoff, never proof of calendar import. */
export async function shareCalendar(events: CalendarEvent[]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const content = buildICS(events);
  const file = new File([content], 'pulda-일정과-알림.ics', { type: 'text/calendar' });
  if (!isMockMode && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '풀다 진료 일정과 알림' });
      return 'shared';
    } catch (reason) {
      if ((reason as Error).name === 'AbortError') return 'cancelled';
      throw reason;
    }
  }
  if (!downloadFile(file.name, content)) throw new Error('FILE_FAILED');
  return 'downloaded';
}

/** 파일을 실제로 내려받게 한다. 브라우저가 막으면 false. */
export function downloadFile(filename: string, content: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
