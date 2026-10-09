import { describe, expect, it } from 'vitest'
import {
  addSource,
  approve,
  arrangeNote,
  demoHandout,
  demoTranscript,
  hasDemoConflict,
  newVisit,
} from './model'

describe('의미와 근거 보존', () => {
  it('부정·시점·기간·숫자·부위·불확실성을 한 글자도 바꾸지 않는다', () => {
    const note =
      '3일 전부터 왼쪽 배가 가끔 아파요.\n열은 없어요. 약 때문인지는 모르겠어요. 2번 그랬어요.'
    expect(arrangeNote(note)).toBe(note)
  })
  it('줄 사이 공백만 정리하고 진단이나 복용법을 추가하지 않는다', () => {
    expect(arrangeNote('  모르겠어요  \n\n  아프지 않아요  ')).toBe('모르겠어요\n아프지 않아요')
    expect(arrangeNote('')).toBe('')
  })
  it('새 근거가 들어오면 일정·알림 승인과 완료 상태를 무효화한다', () => {
    const visit = addSource(newVisit(), demoTranscript[0])
    const approved = approve(visit, { sourceId: 'demo-1', kind: 'schedule', text: '오후 2시' })
    const changed = addSource({ ...approved, completed: ['schedule'] }, demoHandout)
    expect(changed.approvals).toEqual([])
    expect(changed.completed).toEqual([])
    expect(changed.sources).toHaveLength(2)
  })
  it('중복 출처는 승인 상태를 바꾸거나 두 번 추가하지 않는다', () => {
    const visit = addSource(newVisit(), demoHandout)
    const approved = approve(visit, { sourceId: demoHandout.id, kind: 'question', text: '질문' })
    expect(addSource(approved, demoHandout)).toBe(approved)
  })
  it('존재하지 않는 출처로 승인할 수 없다', () => {
    const visit = newVisit()
    expect(approve(visit, { sourceId: 'missing', kind: 'schedule', text: '오후 2시' })).toBe(visit)
  })
  it('사용자가 쓴 임의의 의료 기록에 예시 분석 결과를 붙이지 않는다', () => {
    expect(
      hasDemoConflict([
        { id: 'custom', kind: 'handout', text: '오후 2시 또는 3시', example: false },
      ]),
    ).toBe(false)
    expect(hasDemoConflict([...demoTranscript, demoHandout])).toBe(true)
  })
})
