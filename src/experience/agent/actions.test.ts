// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildICS, shareCalendar } from './actions';

const events = [{ key: 'visit/medicine/0', title: '약 먹을 시간', date: '2026-10-10', time: '08:00', repeatDays: 7, alarmMinutesBefore: 0 }];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('mobile calendar handoff', () => {
  it('hands a calendar file to the OS share sheet without claiming registration', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    await expect(shareCalendar(events)).resolves.toBe('shared');
    const file = share.mock.calls[0][0].files[0];
    expect(file.name).toMatch(/\.ics$/);
    expect(file.type).toBe('text/calendar');
    const content = buildICS(events);
    expect(content).toContain('RRULE:FREQ=DAILY;COUNT=7');
    expect(content).toContain('TRIGGER:-PT0M');
    expect(content).toContain('TZID:Asia/Seoul');
  });
  it('does not download or record completion when sharing is cancelled', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(shareCalendar(events)).resolves.toBe('cancelled');
    expect(click).not.toHaveBeenCalled();
  });
  it('falls back to a single download when calendar files cannot be shared', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { canShare: () => false, share: vi.fn() });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(shareCalendar(events)).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(1);
    expect(navigator.share).not.toHaveBeenCalled();
    vi.runAllTimers();
  });
  it('preserves UTF-8 text while folding ICS lines to 75 bytes', () => {
    const content = buildICS([{ ...events[0], title: '긴 일정 이름 '.repeat(30) }]);
    expect(content.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(content.replace(/\r\n /g, '')).toContain(`SUMMARY:${'긴 일정 이름 '.repeat(30)}`);
  });
});
