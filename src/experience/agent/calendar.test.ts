// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectGoogleCalendar, googleEventBody, googleEventId, matchesGoogleEvent, registerToGoogle } from './calendar';
const event = { key: 'visit/action/0', title: '약 먹을 시간', date: '2026-10-10', time: '08:00', repeatDays: 7, alarmMinutesBefore: 0 };
const saved = (value = event) => ({ id: 'test', htmlLink: 'https://calendar.google.com/test', ...googleEventBody(value) });
beforeEach(() => {
  disconnectGoogleCalendar();
  window.google = { accounts: { oauth2: { initTokenClient: config => ({ requestAccessToken: () => config.callback({ access_token: 'test-only', expires_in: 3600 }) }) } } };
});
afterEach(() => { vi.unstubAllGlobals(); delete window.google; disconnectGoogleCalendar(); });
describe('Google calendar execution', () => {
  it('checks repetition and reminder settings as well as the scheduled time', () => {
    expect(matchesGoogleEvent(saved(), event)).toBe(true);
    expect(matchesGoogleEvent({ ...saved(), recurrence: [] }, event)).toBe(false);
    expect(matchesGoogleEvent({ ...saved(), reminders: { useDefault: true } }, event)).toBe(false);
  });
  it('reuses the same event after a lost create response', async () => {
    let exists = false; let creates = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') { exists = true; creates++; throw new Error('network lost'); }
      return new Response(JSON.stringify(exists ? saved() : {}), { status: exists ? 200 : 404 });
    }));
    await expect(registerToGoogle(event)).rejects.toThrow();
    await expect(registerToGoogle(event)).resolves.toMatchObject({ link: 'https://calendar.google.com/test' });
    expect(creates).toBe(1);
  });
  it('updates a changed action rather than creating another event', async () => {
    let stored = saved(); const methods: (string | undefined)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      methods.push(init.method);
      if (init.method === 'PATCH') stored = { ...stored, ...JSON.parse(init.body as string) };
      return new Response(JSON.stringify(stored));
    }));
    await registerToGoogle({ ...event, time: '09:00' });
    expect(methods).toContain('PATCH'); expect(methods).not.toContain('POST');
    expect(await googleEventId(event)).toBe(await googleEventId({ ...event, time: '09:00' }));
  });
  it('does not report success when the provider saves the wrong reminders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...saved(), reminders: { useDefault: true } }))));
    await expect(registerToGoogle(event)).rejects.toThrow('MISMATCH');
  });
});
