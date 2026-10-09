import { useSyncExternalStore } from 'react';
import { getAccessCode } from '../agent';
import { DEMO_CONSULT } from '../lib/demo';
import { isMockMode } from '../runtime';
import { getVisit, mutate, uid } from './visit';

export type CaptionStatus = 'off' | 'connecting' | 'live' | 'paused' | 'failed';
export type CaptionError = 'MIC_DENIED' | 'STREAM_LOST' | 'UNSUPPORTED';

interface Snapshot {
  status: CaptionStatus;
  mode: 'mic' | 'demo' | null;
  /** 아직 확정되지 않은 인식 중 문장 */
  interim: string;
  error: CaptionError | null;
  /** 자막을 멈춘 이유. 화면에 그대로 설명한다 */
  pauseReason: 'user' | 'present' | 'explain' | 'leave' | null;
}

let snap: Snapshot = { status: 'off', mode: null, interim: '', error: null, pauseReason: null };
const listeners = new Set<() => void>();

function update(next: Partial<Snapshot>) {
  snap = { ...snap, ...next };
  listeners.forEach((l) => l());
}

function pushFinal(text: string) {
  const clean = text.trim();
  if (!clean) return;
  mutate((v) => {
    v.segments.push({ id: uid('seg'), text: clean, status: 'final', origin: 'caption', at: Date.now() });
  });
}

/** 수집이 멈춘 구간을 빈칸 없이 이어 붙이지 않도록 표시를 남긴다 (FR-004). */
function pushGap(text: string) {
  mutate((v) => {
    if (v.segments.at(-1)?.status === 'gap') return;
    if (!v.segments.some((s) => s.origin === 'caption')) return;
    v.segments.push({ id: uid('seg'), text, status: 'gap', origin: 'caption', at: Date.now() });
  });
}

/* ── 예시 대화 재생 (소리를 모으지 않는다) ─────────────────── */

let demoTimer: ReturnType<typeof setTimeout> | undefined;
let demoIndex = 0;

function playDemo() {
  if (snap.status !== 'live' || demoIndex >= DEMO_CONSULT.length) return;
  const line = DEMO_CONSULT[demoIndex];
  update({ interim: line.slice(0, Math.ceil(line.length / 2)) });
  demoTimer = setTimeout(() => {
    if (snap.status !== 'live') return;
    update({ interim: '' });
    pushFinal(line);
    demoIndex++;
    demoTimer = setTimeout(playDemo, 1500);
  }, 900);
}

/* ── 실시간 전사 (WebRTC → gpt-live-transcribe) ───────────────
   이 모델은 서버 쪽 발화 구분이 없다. 브라우저가 말소리의 끝을 감지해
   구간을 확정(commit)해야 최종 문장이 온다. */

const SPEECH_LEVEL = 0.018;
const SILENCE_MS = 650;
const MAX_TURN_MS = 9000;

let peer: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
let micStream: MediaStream | null = null;
let ownsStream = false;
let audioContext: AudioContext | null = null;
let vadTimer: ReturnType<typeof setInterval> | undefined;
/** 발화가 시작된 순서. 완료 이벤트는 순서가 뒤바뀌어 올 수 있어 이 순서로만 확정한다. */
let order: string[] = [];
const partial = new Map<string, string>();
const done = new Map<string, string>();

function showInterim() {
  update({ interim: order.filter((id) => !done.has(id)).map((id) => partial.get(id) ?? '').join(' ').trim() });
}

function onServerEvent(raw: string) {
  const event = JSON.parse(raw);
  const id: string | undefined = event.item_id;
  if (event.type === 'conversation.item.input_audio_transcription.delta' && id) {
    if (!order.includes(id)) order.push(id);
    partial.set(id, (partial.get(id) ?? '') + (event.delta ?? ''));
    showInterim();
  } else if (event.type === 'conversation.item.input_audio_transcription.completed' && id) {
    if (!order.includes(id)) order.push(id);
    done.set(id, event.transcript ?? '');
    while (order.length && done.has(order[0])) {
      const head = order.shift()!;
      pushFinal(done.get(head)!);
      done.delete(head);
      partial.delete(head);
    }
    showInterim();
  }
}

function watchSpeech(stream: MediaStream) {
  audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let speaking = false;
  let turnStart = 0;
  let lastVoice = 0;

  const commit = () => {
    speaking = false;
    if (channel?.readyState === 'open') channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  };
  vadTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const level = Math.sqrt(sum / samples.length);
    const now = performance.now();
    if (level > SPEECH_LEVEL) {
      if (!speaking) {
        speaking = true;
        turnStart = now;
      }
      lastVoice = now;
    }
    if (speaking && (now - lastVoice > SILENCE_MS || now - turnStart > MAX_TURN_MS)) commit();
  }, 50);
}

function lost() {
  if (snap.status !== 'live' && snap.status !== 'connecting') return;
  closeRealtime();
  pushGap('연결이 끊겨 이 구간의 자막이 없어요.');
  update({ status: 'failed', error: 'STREAM_LOST', interim: '' });
}

async function startRealtime(injected?: MediaStream) {
  if (typeof RTCPeerConnection === 'undefined') return update({ status: 'failed', error: 'UNSUPPORTED' });
  try {
    ownsStream = !injected;
    micStream =
      injected ??
      (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
  } catch {
    return update({ status: 'failed', error: 'MIC_DENIED', interim: '' });
  }
  // 권한을 기다리는 사이에 사용자가 멈췄다면 연결하지 않는다
  if (snap.status !== 'connecting') return closeRealtime();

  try {
    const connection = new RTCPeerConnection();
    peer = connection;
    micStream.getAudioTracks().forEach((track) => connection.addTrack(track, micStream!));
    channel = connection.createDataChannel('oai-events');
    channel.onmessage = (e) => onServerEvent(e.data);
    channel.onopen = () => {
      if (peer !== connection) return;
      update({ status: 'live', error: null });
      watchSpeech(micStream!);
    };
    connection.onconnectionstatechange = () => {
      if (peer === connection && ['failed', 'disconnected', 'closed'].includes(connection.connectionState)) lost();
    };

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    const appointment = getVisit()?.appointment;
    const keywords = [appointment?.hospital, appointment?.dept].filter(Boolean).join(',');
    const response = await fetch(`/api/transcribe?keywords=${encodeURIComponent(keywords)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', 'x-pulda-code': getAccessCode() },
      body: offer.sdp,
    });
    if (!response.ok) throw new Error('session failed');
    if (peer !== connection) return;
    await connection.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  } catch {
    lost();
  }
}

function closeRealtime() {
  clearInterval(vadTimer);
  void audioContext?.close().catch(() => undefined);
  audioContext = null;
  channel?.close();
  channel = null;
  peer?.close();
  peer = null;
  // 마이크를 실제로 끈다. 브라우저의 녹음 표시도 함께 꺼진다.
  if (ownsStream) micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  order = [];
  partial.clear();
  done.clear();
}

function stopEngines() {
  clearTimeout(demoTimer);
  closeRealtime();
}

function begin(mode: 'mic' | 'demo', stream?: MediaStream) {
  if (mode === 'mic') void startRealtime(stream);
  else {
    demoTimer = setTimeout(() => {
      update({ status: 'live' });
      playDemo();
    }, 500);
  }
}

export const captions = {
  /**
   * 사용자가 시작을 고른 뒤에만 호출한다. 그 전에는 마이크 권한을 묻지 않는다.
   * stream을 넘기면 마이크 대신 그 소리를 쓴다 (자동 시험용).
   */
  start(mode: 'mic' | 'demo', stream?: MediaStream) {
    if (isMockMode) {
      mode = 'demo';
      // A refresh resumes the seeded conversation instead of duplicating earlier lines.
      const recorded = new Set(getVisit()?.segments.filter(s => s.origin === 'caption' && s.status === 'final').map(s => s.text));
      const next = DEMO_CONSULT.findIndex(line => !recorded.has(line));
      demoIndex = next < 0 ? DEMO_CONSULT.length : next;
    }
    stopEngines();
    update({ mode, status: 'connecting', error: null, interim: '', pauseReason: null });
    begin(mode, stream);
  },
  pause(reason: NonNullable<Snapshot['pauseReason']>) {
    if (snap.status !== 'live' && snap.status !== 'connecting') return;
    stopEngines();
    pushGap('자막을 멈춘 구간이에요. 이 구간은 기록되지 않았어요.');
    update({ status: 'paused', interim: '', pauseReason: reason });
  },
  /** 자동으로 다시 시작하지 않는다. 사용자가 누를 때만 호출한다. */
  resume() {
    if (snap.status !== 'paused' && snap.status !== 'failed') return;
    const mode = snap.mode ?? 'mic';
    update({ status: 'connecting', error: null, pauseReason: null });
    begin(mode);
  },
  /** 새 소리 수집을 바로 멈춘다. 인식 중이던 미완성 문장은 기록하지 않는다. */
  stop() {
    stopEngines();
    demoIndex = 0;
    update({ status: 'off', mode: null, interim: '', error: null, pauseReason: null });
  },
};

// 개발 중 자동 시험에서 마이크 대신 준비한 소리를 넣기 위한 진입점
if (import.meta.env.DEV) (window as unknown as { __captions: typeof captions }).__captions = captions;

export function useCaptions(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snap,
  );
}
