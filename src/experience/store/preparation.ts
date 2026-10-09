import type { Note, Preparation, Visit } from '../lib/types'

export function initialPreparation(visit: Visit, fresh = false): Preparation {
  // 이전 버전에서 작성한 진료는 요약으로 열어 기존 내용을 유지한다.
  const complete =
    !fresh &&
    (visit.stage !== 'preparing' ||
      visit.notes.length > 0 ||
      visit.requests.length > 0 ||
      Object.values(visit.appointment).some(Boolean))
  return {
    step: complete ? 'summary' : 'reason',
    complete,
    editing: false,
    reason: visit.notes[0]?.raw ?? '',
    noteId: visit.notes[0]?.id,
    appointmentDraft: { ...visit.appointment },
    requestsDraft: [...visit.requests],
  }
}

export function preparationOf(visit: Visit) {
  return visit.preparation ?? initialPreparation(visit)
}

export function savePreparationNote(
  visit: Visit,
  text: string,
  chosen: Note['chosen'],
  id: string,
) {
  const prep = (visit.preparation ??= initialPreparation(visit))
  const existing = visit.notes.find((note) => note.id === prep.noteId)
  const note = { id: existing?.id ?? id, raw: prep.reason.trim(), text: text.trim(), chosen }
  if (!note.text) return
  if (existing) Object.assign(existing, note)
  else visit.notes.push(note)
  prep.noteId = note.id
}

export function finishPreparationSection(prep: Preparation, next: Preparation['step']) {
  prep.step = prep.editing ? 'summary' : next
  prep.editing = false
}
