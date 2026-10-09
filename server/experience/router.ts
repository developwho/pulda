

import express, { type NextFunction, type Request, type Response } from 'express';
import type { DeskMessage } from './types.js';
import { MODEL, planWithModel, readImage, refineWithModel } from './ai.js';
import { config, production } from '../config.js';
import { consume } from '../limits.js';
import { hash } from '../session.js';
import { explainWithModel } from './explain-ai.js';

export const experienceRouter = express.Router();
const app = experienceRouter;

const TRANSCRIBE_MODEL = process.env.PULDA_TRANSCRIBE_MODEL ?? 'gpt-live-transcribe';

app.use(express.json({ limit: '8mb' }));
app.use(express.text({ type: 'application/sdp', limit: '64kb' }));
app.use((req, res, next) => {
  if (production && req.method === 'POST' && req.get('origin') !== config.origin) {
    res.status(403).json({ code: 'ORIGIN_REJECTED' });
    return;
  }
  next();
});
// 의료 내용이 담긴 응답을 중간 캐시에 남기지 않는다
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const fail = (res: Response, status: number, code: string, retryable = false) =>
  res.status(status).json({ code, retryable });

/* ── 공개 주소에서 키 비용을 지키는 두 가지 ─────────────────
   접근 코드: 설정돼 있으면 AI를 부르는 요청에 코드가 있어야 한다.
   호출 제한: 주소(IP)마다 정해진 시간 안의 횟수를 넘으면 거절한다. */

// 배포 환경에서만 잠근다. 로컬 개발에서는 .env에 코드가 있어도 적용하지 않는다.
const ACCESS_CODE = process.env.NODE_ENV === 'production' ? process.env.PULDA_ACCESS_CODE ?? '' : '';
const LIMIT_WINDOW_MS = 10 * 60_000;
const LIMIT_MAX = Number(process.env.PULDA_RATE_LIMIT ?? 80);
const hits = new Map<string, number[]>();


/** 접수 창구는 코드 없이 링크만으로 열리므로 횟수만 제한한다. */
function limitOnly(req: Request, res: Response, next: NextFunction) {
  const key = `desk:${req.ip ?? 'unknown'}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < LIMIT_WINDOW_MS);
  if (recent.length >= LIMIT_MAX * 3) return fail(res, 429, 'RATE_LIMITED', true);
  recent.push(now);
  hits.set(key, recent);
  next();
}

async function guard(req: Request, res: Response, next: NextFunction) {
  if (ACCESS_CODE && req.get('x-pulda-code') !== ACCESS_CODE) return fail(res, 401, 'ACCESS_CODE_REQUIRED');
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < LIMIT_WINDOW_MS);
  if (recent.length >= LIMIT_MAX) return fail(res, 429, 'RATE_LIMITED', true);
  recent.push(now);
  hits.set(key, recent);
  if (production && req.path !== '/api/access') {
    const voice = req.path === '/api/transcribe';
    const bucket = voice ? 'voice' : 'ai';
    const ceiling = voice ? config.dailyStreams : config.dailyCalls;
    if (!(await consume(`${bucket}:experience:${hash(key)}`, LIMIT_MAX, 600)) ||
        !(await consume(`${bucket}:global`, ceiling, 86400))) {
      return fail(res, 429, 'RATE_LIMITED', true);
    }
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of hits) if (list.every((t) => now - t >= LIMIT_WINDOW_MS)) hits.delete(key);
}, LIMIT_WINDOW_MS);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: Boolean(process.env.OPENAI_API_KEY), model: MODEL, transcribe: TRANSCRIBE_MODEL,
    locked: Boolean(ACCESS_CODE),
  });
});
// 코드가 맞는지만 확인한다. 모델을 부르지 않는다.
app.post('/api/access', guard, (_req, res) => res.json({ ok: true }));

app.post('/api/plan', guard, async (req, res) => {
  const { sources, issueStates, booking, year } = req.body ?? {};
  if (!Array.isArray(sources)) return fail(res, 400, 'INVALID_INPUT');
  res.json(await planWithModel({ sources, issueStates: issueStates ?? {}, booking: booking ?? { state: 'none' }, year }));
});

app.post('/api/refine', guard, async (req, res) => {
  const raw = req.body?.raw;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) return fail(res, 400, 'INVALID_INPUT');
  res.json(await refineWithModel(raw));
});

app.post('/api/explain', guard, async (req, res) => {
  const { text, selected, context } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim() || text.length > 1200 ||
      (selected !== undefined && (typeof selected !== 'string' || selected.length > 100 || !text.includes(selected))) ||
      (context !== undefined && (typeof context !== 'string' || context.length > 1200))) return fail(res, 400, 'INVALID_INPUT');
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const result = await explainWithModel({ text, selected, context }, controller.signal);
  if (!res.destroyed) res.json(result);
});

app.post('/api/read-image', guard, async (req, res) => {
  const dataUrl = req.body?.dataUrl;
  if (typeof dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) {
    return fail(res, 400, 'UNSUPPORTED_FORMAT');
  }
  try {
    res.json(await readImage(dataUrl));
  } catch {
    fail(res, 502, 'MODEL_TIMEOUT', true);
  }
});

/**
 * 실시간 자막. 브라우저의 SDP 제안을 받아 전사 전용 세션을 만들고 응답을 돌려준다.
 * 키는 서버에만 있다. 이 모델은 서버 VAD가 없으므로 발화 구분은 브라우저가 한다.
 */
app.post('/api/transcribe', guard, async (req, res) => {
  if (typeof req.body !== 'string' || !req.body.includes('v=0')) return fail(res, 400, 'INVALID_INPUT');
  // 자주 잘못 듣는 진료 용어를 힌트로 준다. 힌트일 뿐 출력을 강제하지 않는다.
  const CLINIC_TERMS = ['위염', '위내시경', '식후', '식전', '처방', '재진', '금식', '복용', '혈압', '혈당'];
  const keywords = [...String(req.query.keywords ?? '').split(','), ...CLINIC_TERMS]
    .map((k) => k.replace(/[<>\r\n]/g, '').trim())
    .filter(Boolean)
    .slice(0, 30);
  const form = new FormData();
  form.set('sdp', req.body);
  form.set(
    'session',
    JSON.stringify({
      type: 'transcription',
      audio: {
        input: {
          transcription: {
            model: TRANSCRIBE_MODEL,
            languages: ['ko'],
            delay: 'low',
            prompt: '한국의 병원 외래 진료실에서 의사가 환자에게 설명하는 대화.',
            ...(keywords.length ? { keywords } : {}),
          },
          turn_detection: null,
        },
      },
    }),
  );
  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!upstream.ok) {
      console.error('transcription session failed', upstream.status);
      return fail(res, 502, 'STREAM_LOST', true);
    }
    res.type('application/sdp').send(await upstream.text());
  } catch {
    fail(res, 502, 'STREAM_LOST', true);
  }
});

/* ── 접수 창구 연결 ──────────────────────────────────────────
   환자 화면과 접수 창구 화면이 같은 코드로 메시지를 주고받는다.
   기억 장치에만 두고 2시간 뒤 지운다. 병원 시스템과 연동한 것은 아니다. */

interface Room {
  messages: DeskMessage[];
  requests: string[];
  listeners: Set<Response>;
  touched: number;
}
const rooms = new Map<string, Room>();

function room(code: string): Room {
  let r = rooms.get(code);
  if (!r) {
    r = { messages: [], requests: [], listeners: new Set(), touched: Date.now() };
    rooms.set(code, r);
  }
  r.touched = Date.now();
  return r;
}
setInterval(() => {
  for (const [code, r] of rooms) if (Date.now() - r.touched > 2 * 3600_000 && !r.listeners.size) rooms.delete(code);
}, 600_000);

const CODE_RE = /^[a-z0-9]{6,16}$/;

app.get('/api/desk/:code/events', (req, res) => {
  if (!CODE_RE.test(req.params.code)) return fail(res, 400, 'INVALID_INPUT');
  const r = room(req.params.code);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`data: ${JSON.stringify({ type: 'snapshot', messages: r.messages, requests: r.requests })}\n\n`);
  r.listeners.add(res);
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(beat);
    r.listeners.delete(res);
  });
});

app.post('/api/desk/:code/messages', limitOnly, (req, res) => {
  const code = String(req.params.code);
  if (!CODE_RE.test(code)) return fail(res, 400, 'INVALID_INPUT');
  const { id, from, kind, text, issueId, replyTo, accepted, requests, options, answer } = req.body ?? {};
  if (typeof id !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 1000) {
    return fail(res, 400, 'INVALID_INPUT');
  }
  if (from !== 'patient' && from !== 'desk') return fail(res, 400, 'INVALID_INPUT');
  const r = room(code);
  if (Array.isArray(requests)) r.requests = requests.filter((x) => typeof x === 'string').slice(0, 6);
  // 같은 id로 다시 보내도 한 번만 반영한다
  if (!r.messages.some((m) => m.id === id)) {
    const message: DeskMessage = {
      id, from, kind, text: text.trim(), at: Date.now(), issueId, replyTo, accepted,
      options: Array.isArray(options) ? options.filter((o) => typeof o === 'string').slice(0, 4) : undefined,
      answer: answer === 'time' || answer === 'date' || answer === 'when' ? answer : undefined,
    };
    r.messages.push(message);
    const payload = `data: ${JSON.stringify({ type: 'message', message, requests: r.requests })}\n\n`;
    r.listeners.forEach((l) => l.write(payload));
  }
  res.json({ ok: true });
});
