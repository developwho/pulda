import { describe, expect, it } from 'vitest'
import type { Visit } from '../lib/types'
import {
  finishPreparationSection,
  initialPreparation,
  preparationOf,
  savePreparationNote,
} from './preparation'

function visit(): Visit {
  return {
    id: 'test',
    createdAt: 1,
    demo: false,
    stage: 'preparing',
    appointment: { hospital: '', dept: '', date: '', time: '' },
    requests: [],
    notes: [],
    segments: [],
    sources: [],
    issueStates: {},
    plan: null,
    analysis: 'idle',
    done: {},
    storage: 'session',
    executions: [],
    reminderTimes: [],
    thread: [],
    pending: [],
    booking: { state: 'none' },
    deskCode: 'test',
    deskSeen: [],
    traces: [],
  }
}

describe('preparation continuity', () => {
  it('opens legacy content in summary without changing accepted notes or requests', () => {
    const v = visit()
    v.notes = [{ id: 'old', raw: '배 아픔', text: '배가 아파요.', chosen: 'refined' }]
    v.requests = ['글로 적어 주세요.']
    const original = structuredClone(v)
    expect(preparationOf(v).step).toBe('summary')
    expect(v).toEqual(original)
  })

  it('starts a fresh visit at the first question even when an appointment was imported', () => {
    const v = visit()
    v.appointment.hospital = '예시 병원'
    const prep = initialPreparation(v, true)
    expect(prep.step).toBe('reason')
    prep.appointmentDraft.hospital = '수정 중'
    expect(v.appointment.hospital).toBe('예시 병원')
  })

  it('updates the same note when returning to a previous step and preserves other notes', () => {
    const v = visit()
    v.preparation = initialPreparation(v, true)
    v.preparation.reason = '처음 쓴 말'
    savePreparationNote(v, '처음 쓴 말', 'raw', 'first')
    v.notes.push({ id: 'other', raw: '다른 말', text: '다른 말', chosen: 'raw' })
    v.preparation.reason = '바꾼 원문'
    savePreparationNote(v, '다듬은 문장', 'refined', 'unused')
    expect(v.notes).toEqual([
      { id: 'first', raw: '바꾼 원문', text: '다듬은 문장', chosen: 'refined' },
      { id: 'other', raw: '다른 말', text: '다른 말', chosen: 'raw' },
    ])
  })

  it('returns section edits to summary while fresh preparation proceeds to the next question', () => {
    const prep = initialPreparation(visit(), true)
    finishPreparationSection(prep, 'appointment')
    expect(prep.step).toBe('appointment')
    prep.editing = true
    finishPreparationSection(prep, 'requests')
    expect(prep.step).toBe('summary')
    expect(prep.editing).toBe(false)
  })

  it('resumes serialized drafts at the same step without committing them', () => {
    const v = visit()
    v.preparation = initialPreparation(v, true)
    v.preparation.step = 'schedule'
    v.preparation.appointmentDraft.hospital = '작성 중인 병원'
    v.preparation.reason = '작성 중인 말'
    const restored: Visit = JSON.parse(JSON.stringify(v))
    expect(preparationOf(restored)).toEqual(v.preparation)
    expect(restored.appointment.hospital).toBe('')
    expect(restored.notes).toEqual([])
  })
})
