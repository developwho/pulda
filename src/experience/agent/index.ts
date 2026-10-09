import type { Issue, Patch, Plan, Source, Trace } from '../lib/types';
import { storageKey } from '../runtime';
import { buildPlan, proposePatch, type PlanInput } from './plan';
import { explainTerms, refineNote, type RefineResult, type Term } from './refine';

/**
 * 화면이 의존하는 에이전트 계약.
 * 기본 구현은 서버의 모델 파이프라인(gpt-6-luna + 검증기)을 부른다.
 * 서버에 닿지 못하면 기기 안의 규칙으로 정리하고, 그 사실을 실행 기록에 남긴다.
 */
export interface VisitAgent {
  refine(raw: string): Promise<{ result: RefineResult; trace: Trace }>;
  plan(input: PlanInput): Promise<{ plan: Omit<Plan, 'version'>; trace: Trace }>;
  patch(issue: Issue, reply: Source, year: number): Patch | null;
  explain(text: string): Term[];
}

export type ReadImageResult =
  | { ok: true; text: string; unreadable: string[] }
  | { ok: false; code: 'UNREADABLE' | 'NOT_VISIT_DOCUMENT' };

function offlineTrace(task: Trace['task']): Trace {
  return {
    id: `tr-${Date.now().toString(36)}`, at: Date.now(), task, model: '기기 안 규칙', mode: 'rules',
    steps: [], blocked: [], gates: [], tokens: 0, note: '서버에 연결하지 못해 규칙으로 정리',
  };
}

const CODE_KEY = storageKey('pulda.code');
export const getAccessCode = () => {
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
};
/** 접근 코드를 확인하고 맞으면 이 기기에 기억한다. */
export async function checkAccessCode(code: string): Promise<boolean> {
  const response = await fetch('/api/access', { method: 'POST', headers: { 'x-pulda-code': code } });
  if (response.ok) localStorage.setItem(CODE_KEY, code);
  return response.ok;
}
export async function serverStatus(): Promise<{ ok: boolean; locked: boolean } | null> {
  try {
    return await (await fetch('/api/health', { signal: AbortSignal.timeout(6000) })).json();
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-pulda-code': getAccessCode() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

class RemoteAgent implements VisitAgent {
  async refine(raw: string) {
    try {
      return await post<{ result: RefineResult; trace: Trace }>('/api/refine', { raw }, 30_000);
    } catch {
      return { result: refineNote(raw), trace: offlineTrace('refine') };
    }
  }
  async plan(input: PlanInput) {
    try {
      return await post<{ plan: Omit<Plan, 'version'>; trace: Trace }>('/api/plan', input, 90_000);
    } catch {
      return { plan: buildPlan(input), trace: offlineTrace('plan') };
    }
  }
  patch(issue: Issue, reply: Source, year: number) {
    return proposePatch(issue, reply, year);
  }
  explain(text: string) {
    return explainTerms(text);
  }
}

export const agent: VisitAgent = new RemoteAgent();

/** 안내문 사진을 글자로 옮긴다. 실패하면 던진다 — 대신할 규칙이 없다. */
export function readImage(dataUrl: string) {
  return post<{ result: ReadImageResult; trace: Trace }>('/api/read-image', { dataUrl }, 90_000);
}

export type { RefineResult, Term };
