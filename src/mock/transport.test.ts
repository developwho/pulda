// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalFetch = window.fetch;
const OriginalEvents = window.EventSource;
beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, '', '/mock.html');
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => { window.fetch = originalFetch; window.EventSource = OriginalEvents; vi.useRealTimers(); });

describe('isolated presentation data', () => {
  it('uses separate storage and never forwards unknown API calls', async () => {
    localStorage.setItem('pulda.visit', 'existing real visit');
    sessionStorage.setItem('pulda.session', 'existing real session');
    const { installMockTransport } = await import('./transport');
    installMockTransport();
    const { storageKey } = await import('../experience/runtime');
    expect(storageKey('pulda.visit')).toBe('pulda.mock.pulda.visit');
    expect((await window.fetch('/api/unknown')).status).toBe(503);
    expect((await window.fetch('https://example.invalid/private')).status).toBe(503);
    const { startVisit, setStorage, deleteVisit } = await import('../experience/store/visit');
    startVisit(); setStorage('local'); deleteVisit();
    expect(localStorage.getItem('pulda.visit')).toBe('existing real visit');
    expect(sessionStorage.getItem('pulda.session')).toBe('existing real session');
  });

  it('the normal microphone button plays fixture captions without requesting a microphone', async () => {
    vi.useFakeTimers();
    const microphone = vi.fn().mockRejectedValue(new Error('must not be called'));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: microphone } });
    const { installMockTransport } = await import('./transport'); installMockTransport();
    const { startVisit, getVisit } = await import('../experience/store/visit');
    const { captions } = await import('../experience/store/captions');
    startVisit(); captions.start('mic');
    await vi.advanceTimersByTimeAsync(1500);
    expect(microphone).not.toHaveBeenCalled();
    expect(getVisit()?.segments[0].text).toBe('어디가 불편해서 오셨어요?');
    captions.stop();
    captions.start('mic');
    await vi.advanceTimersByTimeAsync(1500);
    expect(getVisit()?.segments.filter(s => s.status === 'final').map(s => s.text)).toEqual(['어디가 불편해서 오셨어요?', '위염이 의심됩니다.']);
    captions.stop();
  });

  it('preserves user-approved appointment values through concierge replies', async () => {
    const { installMockTransport } = await import('./transport'); installMockTransport();
    const call = async (path: string, body: object = {}) => (await window.fetch(`/api/concierge${path}`, { method: 'POST', body: JSON.stringify(body) })).json();
    await call('/search', { query: '문자 가능한 내과' });
    await call('/draft', { input: { name: '예시 사용자', channel: 'text', preferredTime: '오전 11시', department: '내과', note: '글로 안내' } });
    await call('/approve'); await call('/contacted');
    const appointment = { date: '2030-10-14', time: '11:00', department: '내과' };
    const state = await call('/reply', { text: '오전 11시에 방문해 주세요.', appointment });
    expect(state.inquiry.appointment).toEqual(appointment);
    expect(state.inquiry.status).toBe('reply_recorded');
    expect(state.inquiry.text).toContain('예시 사용자');
    expect(state.inquiry.reply).toContain('11시');
  });

  it('replays a hospital confirmation after reload without duplicating or losing it', async () => {
    const { installMockTransport } = await import('./transport'); installMockTransport();
    await window.fetch('/api/desk/mock-room/messages', { method: 'POST', body: JSON.stringify({ id: 'request-1', from: 'patient', kind: 'book_confirm', text: '예약해 주세요.' }) });
    // Simulate reconnect before the delayed answer appears on the original connection.
    const stream = new window.EventSource('/api/desk/mock-room/events');
    const replay = await new Promise<{ messages: { accepted?: boolean; replyTo?: string }[] }>(resolve => { stream.onmessage = e => resolve(JSON.parse(e.data)); });
    expect(replay.messages.filter(m => m.replyTo === 'request-1')).toHaveLength(1);
    expect(replay.messages.find(m => m.replyTo === 'request-1')?.accepted).toBe(true);
    stream.close();
  });

  it('keeps ordinary service storage keys and dates unchanged', async () => {
    history.replaceState(null, '', '/');
    const { storageKey, isMockMode } = await import('../experience/runtime');
    const { DEMO_APPOINTMENT } = await import('../experience/lib/demo');
    expect(isMockMode).toBe(false);
    expect(storageKey('pulda.visit')).toBe('pulda.visit');
    expect(DEMO_APPOINTMENT.date).toBe('2026-10-09');
    expect(sessionStorage.getItem('pulda.mock.case-date')).toBeNull();
  });
});
