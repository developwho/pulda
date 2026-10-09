import type { ConciergeState } from './api'

export const steps = [
  'request',
  'searching',
  'clarify',
  'results',
  'hospital',
  'facts',
  'channel',
  'sms',
  'schedule',
  'details',
  'review',
  'contact',
  'waiting',
  'reply',
  'confirmation',
  'appointment',
  'recorded',
  'saved-reply',
  'preferences',
  'delete',
  'close',
  'failure',
] as const
export type ConciergeStep = (typeof steps)[number]

export function resumeStep(state: ConciergeState): ConciergeStep {
  switch (state.inquiry?.status) {
    case 'draft':
      return 'review'
    case 'ready':
      return 'contact'
    case 'awaiting_reply':
      return 'waiting'
    case 'reply_recorded':
      return 'recorded'
  }
  if (state.search?.status === 'queued' || state.search?.status === 'running') return 'searching'
  if (state.search?.status === 'failed') return 'failure'
  if (state.search?.clarification) return 'clarify'
  return state.search ? 'results' : 'request'
}

export function resolveStep(
  requested: string | null,
  state: ConciergeState,
  hasHospital: boolean,
  hasReply: boolean,
  submitting: boolean,
): ConciergeStep {
  const current = resumeStep(state)
  const step = steps.includes(requested as ConciergeStep) ? (requested as ConciergeStep) : current
  if (step === 'searching') return submitting || current === 'searching' ? 'searching' : current
  if (['hospital', 'facts', 'channel', 'sms', 'schedule', 'details'].includes(step) && !hasHospital)
    return current
  if (
    [
      'review',
      'contact',
      'waiting',
      'reply',
      'confirmation',
      'appointment',
      'recorded',
      'saved-reply',
    ].includes(step)
  ) {
    const inquiry = state.inquiry?.status === 'cancelled' ? undefined : state.inquiry
    if (!inquiry) return current
    if (step !== 'review' && inquiry.status === 'draft') return 'review'
    if (
      ['waiting', 'reply', 'confirmation', 'appointment'].includes(step) &&
      inquiry.status === 'ready'
    )
      return 'contact'
    if (['recorded', 'saved-reply'].includes(step) && !inquiry.reply) return current
    if (['confirmation', 'appointment'].includes(step) && !hasReply) return 'reply'
  }
  if (
    ['channel', 'sms', 'schedule', 'details'].includes(step) &&
    state.inquiry &&
    !['draft', 'cancelled'].includes(state.inquiry.status)
  )
    return current
  return step
}

export function phaseFor(step: ConciergeStep): number {
  if (['request', 'searching', 'clarify', 'results', 'hospital', 'facts', 'failure'].includes(step))
    return 1
  if (['channel', 'sms', 'schedule', 'details', 'review', 'contact'].includes(step)) return 2
  return 3
}
