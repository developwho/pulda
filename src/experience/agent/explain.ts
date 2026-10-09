import { getAccessCode } from './index'
import {
  EXPLANATION_UNAVAILABLE,
  localExplanation,
  type ExplanationInput,
  type ExplanationResult,
} from '../../../server/experience/explain'
export { localExplanation, termSpans } from '../../../server/experience/explain'
export type { ExplanationInput, ExplanationResult } from '../../../server/experience/explain'

/** Visit-screen memory only: never share contextual explanations between patients. */
export function createExplanationSession() {
  const cache = new Map<string, ExplanationResult>()
  const keyOf = ({ text, selected, context }: ExplanationInput) =>
    JSON.stringify({ text, selected, context })
  return {
    peek(input: ExplanationInput) {
      return localExplanation(input) ?? cache.get(keyOf(input))
    },
    async load(input: ExplanationInput, signal: AbortSignal): Promise<ExplanationResult> {
      const key = keyOf(input)
      const hit = localExplanation(input) ?? cache.get(key)
      if (hit) return hit
      try {
        const response = await fetch('/api/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-pulda-code': getAccessCode() },
          body: key,
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        })
        if (!response.ok) return EXPLANATION_UNAVAILABLE
        const result: ExplanationResult = await response.json()
        if (signal.aborted) return EXPLANATION_UNAVAILABLE
        if (
          result.kind !== 'ready' ||
          !Array.isArray(result.lines) ||
          !result.lines.length ||
          !Array.isArray(result.chunks) ||
          [...result.lines, ...result.chunks].some(
            (line) => typeof line !== 'string' || line.length > 180,
          )
        )
          return EXPLANATION_UNAVAILABLE
        if (cache.size >= 40) cache.delete(cache.keys().next().value!)
        const safeResult = { ...result, reference: undefined }
        cache.set(key, safeResult)
        return safeResult
      } catch {
        return EXPLANATION_UNAVAILABLE
      }
    },
  }
}
