// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExplanationCard from './ExplanationCard';
import type { ExplanationResult } from '../agent/explain';

afterEach(cleanup);
const ready = (text: string): ExplanationResult => ({ kind: 'ready', source: 'ai', lines: [text], chunks: [text] });
const callbacks = { close: () => {}, latest: () => {}, explainSentence: () => {}, ask: () => {}, unseen: 0 };
describe('explanation lifecycle', () => {
  it('makes one request in StrictMode and ignores the previous selection after cancellation', async () => {
    const releases: Array<(value: ExplanationResult) => void> = [];
    const session = {
      peek: () => undefined,
      load: vi.fn((_input: unknown, _signal: AbortSignal) => new Promise<ExplanationResult>(resolve => releases.push(resolve))),
    };
    const { rerender } = render(<StrictMode><ExplanationCard key="first" input={{ text: '처음 문장' }} session={session} {...callbacks} /></StrictMode>);
    await waitFor(() => expect(session.load).toHaveBeenCalledTimes(1));
    rerender(<StrictMode><ExplanationCard key="second" input={{ text: '다음 문장' }} session={session} {...callbacks} /></StrictMode>);
    await waitFor(() => expect(session.load).toHaveBeenCalledTimes(2));
    expect(session.load.mock.calls[0][1].aborted).toBe(true);
    await act(async () => releases[1](ready('새 설명')));
    expect(screen.getByText('새 설명')).toBeTruthy();
    await act(async () => releases[0](ready('늦은 옛 설명')));
    expect(screen.queryByText('늦은 옛 설명')).toBeNull();
    expect(screen.getByText('새 설명')).toBeTruthy();
  });
});
