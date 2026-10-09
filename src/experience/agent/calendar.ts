import { eventBounds } from './actions';
import { isMockMode } from '../runtime';
import type { CalendarEvent } from './actions';

/**
 * Google 캘린더에 직접 넣고, 넣은 일정을 다시 읽어 확인한다.
 * 클라이언트 ID가 없으면 쓸 수 없고, 화면은 파일 내려받기로 대신한다.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export const googleCalendarAvailable = !isMockMode && Boolean(CLIENT_ID);

export interface Registered {
  id: string;
  /** 캘린더에서 이 일정을 여는 주소 */
  link: string;
  /** 캘린더가 실제로 저장한 시작 시각. 보낸 값과 같은지 화면에서 보여준다 */
  start: string;
}

export type CalendarFailure = 'DENIED' | 'MISMATCH' | 'FAILED';

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
            error_callback?: (error: unknown) => void;
          }): TokenClient;
        };
      };
    };
  }
}

let scriptLoading: Promise<void> | null = null;
let token: { value: string; expiresAt: number } | null = null;

export function prepareGoogleCalendar(): Promise<void> {
  if (!googleCalendarAvailable) return Promise.reject(new Error('NOT_CONFIGURED'));
  if (window.google?.accounts.oauth2) return Promise.resolve();
  scriptLoading ??= new Promise((done, failed) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => done();
    script.onerror = () => {
      scriptLoading = null;
      failed(new Error('gsi'));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/** 사용자가 누른 직후에만 부른다. 브라우저가 동의 창을 막지 않게 하기 위해서다. */
export async function connectGoogleCalendar(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  if (!window.google?.accounts.oauth2) await prepareGoogleCalendar();
  return new Promise((done, failed) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      callback: (response) => {
        if (!response.access_token) return failed(new Error('DENIED'));
        token = { value: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 };
        done(response.access_token);
      },
      error_callback: () => failed(new Error('DENIED')),
    });
    client.requestAccessToken();
  });
}

export function calendarConnected() { return !!token && token.expiresAt > Date.now() + 30000; }
export function disconnectGoogleCalendar() { token = null; }

export async function googleEventId(event: CalendarEvent) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(event.key ?? JSON.stringify(event)));
  return `pulda${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function googleEventBody(event: CalendarEvent) {
  const bounds = eventBounds(event);
  return {
    summary: event.title, location: event.location ?? '',
    start: { dateTime: `${bounds.start}+09:00`, timeZone: 'Asia/Seoul' },
    end: { dateTime: `${bounds.end}+09:00`, timeZone: 'Asia/Seoul' },
    recurrence: event.repeatDays && event.repeatDays > 1 ? [`RRULE:FREQ=DAILY;COUNT=${event.repeatDays}`] : [],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: event.alarmMinutesBefore ?? 0 }] },
    visibility: 'private', extendedProperties: { private: { pulda: '1' } },
  };
}

type SavedEvent = {
  id: string; htmlLink: string; summary: string; status?: string; location?: string;
  start: { dateTime: string }; end: { dateTime: string }; recurrence?: string[];
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: { private?: { pulda?: string } };
};

export function matchesGoogleEvent(saved: SavedEvent, event: CalendarEvent) {
  const body = googleEventBody(event);
  return saved.status !== 'cancelled' && saved.summary === body.summary && (saved.location ?? '') === body.location &&
    Date.parse(saved.start?.dateTime) === Date.parse(body.start.dateTime) &&
    Date.parse(saved.end?.dateTime) === Date.parse(body.end.dateTime) &&
    JSON.stringify([...(saved.recurrence ?? [])].sort()) === JSON.stringify(body.recurrence) &&
    saved.reminders?.useDefault === false && saved.reminders.overrides?.length === 1 &&
    saved.reminders.overrides[0].method === 'popup' && saved.reminders.overrides[0].minutes === (event.alarmMinutesBefore ?? 0);
}

async function authorizedFetch(url: string, init: RequestInit = {}) {
  const bearer = await connectGoogleCalendar();
  const result = await fetch(url, { ...init, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (result.status === 401 || result.status === 403) { token = null; throw new Error('DENIED'); }
  return result;
}

/** A stable ID survives failed responses and reloads; edits update the same event. */
export async function registerToGoogle(event: CalendarEvent): Promise<Registered> {
  const body = googleEventBody(event);
  const id = await googleEventId(event);
  const url = `${API}/${id}`;
  const existing = await authorizedFetch(url);
  if (existing.ok) {
    const saved = await existing.json() as SavedEvent;
    if (matchesGoogleEvent(saved, event)) return { id, link: saved.htmlLink, start: saved.start.dateTime };
    if (saved.extendedProperties?.private?.pulda !== '1') throw new Error('MISMATCH');
    const updated = await authorizedFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
    if (!updated.ok) throw new Error('FAILED');
  } else if (existing.status === 404) {
    const created = await authorizedFetch(API, { method: 'POST', body: JSON.stringify({ id, ...body }) });
    if (!created.ok && created.status !== 409) throw new Error('FAILED');
  } else throw new Error('FAILED');
  const check = await authorizedFetch(url);
  if (!check.ok) throw new Error('FAILED');
  const saved = await check.json() as SavedEvent;
  if (!matchesGoogleEvent(saved, event)) throw new Error('MISMATCH');
  return { id, link: saved.htmlLink, start: saved.start.dateTime };
}

/** Remove only surplus events previously created by this visit's approved action. */
export async function removeGoogleEvent(id: string) {
  if (!/^pulda[a-f0-9]{64}$/.test(id)) throw new Error('FAILED');
  const url = `${API}/${id}`;
  const existing = await authorizedFetch(url);
  if (existing.status === 404 || existing.status === 410) return;
  if (!existing.ok) throw new Error('FAILED');
  const saved = await existing.json() as SavedEvent;
  if (saved.status === 'cancelled') return;
  if (saved.extendedProperties?.private?.pulda !== '1') throw new Error('MISMATCH');
  const removed = await authorizedFetch(url, { method: 'DELETE' });
  if (!removed.ok && removed.status !== 404 && removed.status !== 410) throw new Error('FAILED');
}
