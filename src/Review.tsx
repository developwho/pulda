import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { Button, Notice, Sheet } from './components'
import { sourceId, sourceLabels } from './model'
import type { Approval, Source, SourceKind, Visit } from './model'
import { api, errorMessage } from './api'
import { downloadCalendar } from './calendar'

export type AnalysisItem = {
  kind: 'fact' | 'action' | 'question' | 'conflict'
  evidence: { sourceId: string; quote: string }[]
}
type Result = { items: AnalysisItem[] }
type Props = {
  active?: boolean
  visit: Visit
  add: (source: Source) => void
  approve: (approval: Approval) => void
  update: (patch: Partial<Visit>) => void
  present: (lines: string[]) => void
}
const labels = {
  fact: '들은 내용',
  action: '할 일',
  question: '확인할 내용',
  conflict: '서로 다른 내용',
}
export function Review({ visit, add, approve, update, present, active = false }: Props) {
  const [modal, setModal] = useState<
    'records' | 'import' | 'analyze' | 'item' | 'question' | 'schedule' | null
  >(null)
  const [result, setResult] = useState<Result | null>(null)
  const [selected, setSelected] = useState<AnalysisItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<SourceKind>('handout')
  const [file, setFile] = useState<File | null>(null)
  const [question, setQuestion] = useState('이 내용을 다시 설명해 주세요.')
  const [reply, setReply] = useState('')
  const [checked, setChecked] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [reminder, setReminder] = useState(false)
  const request = useRef<AbortController | null>(null)
  const revision = JSON.stringify(visit.sources)
  const current = useRef(revision)
  current.current = revision
  useEffect(() => {
    request.current?.abort()
    setBusy(false)
    setResult(null)
    setSelected(null)
    setDate('')
    setTime('')
    setChecked(false)
    setReminder(false)
    setModal((value) => (value === 'import' ? value : null))
  }, [revision])
  useEffect(() => () => request.current?.abort(), [])
  const source = selected
    ? visit.sources.find((s) => s.id === selected.evidence[0].sourceId)
    : visit.sources[0]
  const open = (next: typeof modal) => {
    setError('')
    setChecked(false)
    setModal(next)
  }
  const analyze = useCallback(async () => {
    const controller = new AbortController()
    request.current = controller
    const snapshot = revision
    setBusy(true)
    setError('')
    try {
      const next = visit.sources.every((source) => source.example)
        ? {
            items: visit.sources.map((source) => ({
              kind: 'fact' as const,
              evidence: [{ sourceId: source.id, quote: source.text }],
            })),
          }
        : await api<Result>('analyze', { sources: visit.sources }, controller.signal)
      if (controller.signal.aborted || current.current !== snapshot) return
      setResult(next)
      setModal(null)
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }, [revision, visit.sources])
  const attempted = useRef<string | null>(null)
  useEffect(() => {
    if (!active || !visit.sources.length || attempted.current === revision) return
    const timer = window.setTimeout(() => {
      attempted.current = revision
      void analyze()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [active, revision, analyze])
  async function readPhoto() {
    if (!file) return
    if (
      file.size > 5 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ) {
      setError('5MB 이하의 JPG, PNG, WebP 사진을 골라 주세요.')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const result = await api<{ text: string }>(
        'ocr',
        { mime: file.type, data },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setDraft(result.text)
        setFile(null)
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const close = () => {
    request.current?.abort()
    setBusy(false)
    setModal(null)
  }
  return (
    <>
      {visit.captureInterrupted && (
        <Notice warning>
          자막 연결이 끊겨 빠진 말이 있을 수 있어요. 마지막 설명을 병원에 다시 확인해 주세요.
        </Notice>
      )}
      <header className="page-heading">
        <h1>
          {visit.consultationCompleted ? '진료를 마쳤어요' : '진료 후에,'}
          <br />
          다음 일을 확인해요
        </h1>
      </header>
      <section className="review-summary">
        <h2>{result ? '기록에서 찾은 내용' : '내 진료 기록'}</h2>
        {!visit.sources.length ? (
          <p>대화하거나 안내문을 추가하면 함께 확인할 수 있어요.</p>
        ) : (
          <>
            <p className="small-note">
              기록 {visit.sources.length}개 · 날짜와 숫자는 원문과 다시 확인해요.
            </p>
            {busy && <p role="status">기록에서 할 일을 찾고 있어요.</p>}
            {error && modal !== 'analyze' && (
              <Notice warning>
                <span role="alert">{error}</span>
              </Notice>
            )}
            {!result && !busy && (
              <Button onClick={() => (active ? void analyze() : open('analyze'))}>
                {error ? '다시 분석하기' : '기록에서 할 일 찾기'}
              </Button>
            )}
            {result && !result.items.length && (
              <Notice>
                뚜렷한 할 일을 찾지 못했어요. 원문을 읽거나 병원에 다시 물어봐 주세요.
              </Notice>
            )}
            {result && (
              <div className="summary-list">
                {result.items.map((item, index) => (
                  <button
                    className="summary-row"
                    key={index}
                    onClick={() => {
                      setSelected(item)
                      open('item')
                    }}
                  >
                    <span>
                      <strong>
                        {labels[item.kind]}
                        {visit.completed.includes(`item-${index}`) ? ' · 확인했어요' : ''}
                      </strong>
                      <small className="review-excerpt">{item.evidence[0].quote}</small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <div className="summary-list">
        {visit.approvals
          .filter((a) => a.kind === 'schedule')
          .map((a) => (
            <button
              key={a.sourceId}
              className="summary-row"
              onClick={() => {
                const source = visit.sources.find((s) => s.id === a.sourceId)
                if (source) {
                  setSelected({
                    kind: 'fact',
                    evidence: [{ sourceId: source.id, quote: source.text }],
                  })
                  open('item')
                }
              }}
            >
              <span>
                <strong>내가 승인한 방문 일정</strong>
                <small>
                  {a.text}
                  {visit.approvals.some((x) => x.kind === 'reminder')
                    ? ' · 1시간 전 알림 선택'
                    : ''}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
        {!!visit.sources.length && (
          <button className="summary-row" onClick={() => open('records')}>
            <FileText aria-hidden="true" />
            <span>
              <strong>기록 원문 읽기</strong>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        )}
        <button className="summary-row" onClick={() => open('import')}>
          <Plus aria-hidden="true" />
          <span>
            <strong>안내문·기록 추가</strong>
          </span>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      {modal === 'analyze' && (
        <Sheet title="기록에서 할 일을 찾을까요?" onClose={close}>
          <p>진료 기록을 OpenAI에 보내 중요한 말과 확인할 내용을 찾아요.</p>
          <p className="small-note">
            풀다 서버는 처리한 기록을 보관하지 않아요. AI 처리 업체는 오용 방지를 위해 최대 30일
            보관할 수 있어요. 결과가 틀릴 수 있어 원문도 함께 보여줘요.
          </p>
          {error && (
            <div role="alert">
              <Notice warning>{error}</Notice>
            </div>
          )}
          <Button disabled={busy} onClick={() => void analyze()}>
            {busy ? '기록을 읽고 있어요' : '동의하고 할 일 찾기'}
          </Button>
          <Button variant="quiet" onClick={close}>
            돌아가기
          </Button>
        </Sheet>
      )}
      {modal === 'records' && (
        <Sheet title="기록 원문을 읽어요" onClose={close}>
          {visit.sources.map((s) => (
            <details className="record-disclosure" key={s.id}>
              <summary>
                {sourceLabels[s.kind]}
                {s.incomplete ? ' · 미완성' : ''}
              </summary>
              <blockquote className="source-quote">{s.text}</blockquote>
              {s.incomplete && (
                <p className="small-note">끝까지 변환하지 못했어요. 할 일 분석에서는 제외해요.</p>
              )}
              {s.kind === 'reported_reply' && (
                <p className="small-note">내가 입력한 답변이에요. 작성자를 확인하지 않았어요.</p>
              )}
            </details>
          ))}
        </Sheet>
      )}
      {modal === 'import' && (
        <Sheet title="진료 기록을 추가해요" onClose={close}>
          <label className="form-field">
            기록 종류
            <select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>
              <option value="handout">안내문</option>
              <option value="patient_note">내가 쓴 메모</option>
              <option value="reported_reply">내가 입력한 병원 답변</option>
            </select>
          </label>
          <details className="record-disclosure">
            <summary>사진에서 글자 가져오기</summary>
            <p className="small-note">
              사진을 OpenAI에 보내 글자를 읽어요. 5MB 이하 JPG, PNG, WebP 사진 한 장을 골라 주세요.
              처리 업체는 최대 30일 보관할 수 있어요.
            </p>
            <label className="form-field">
              안내문 사진
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <Button variant="secondary" disabled={!file || busy} onClick={() => void readPhoto()}>
              {busy ? '사진을 읽고 있어요' : '동의하고 사진 읽기'}
            </Button>
          </details>
          <label className="form-field">
            기록 내용
            <textarea
              value={draft}
              maxLength={12000}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="받은 설명을 그대로 적어 주세요"
            />
          </label>
          <p className="small-note">
            사진에서 읽은 글자는 틀릴 수 있어요. 숫자와 빠진 말을 확인하고 추가해 주세요.
          </p>
          {error && (
            <div role="alert">
              <Notice warning>{error}</Notice>
            </div>
          )}
          <Button
            disabled={!draft.trim() || busy}
            onClick={() => {
              if (
                visit.sources.length >= 300 ||
                visit.sources.reduce((n, s) => n + s.text.length, 0) + draft.length > 60000
              ) {
                setError('이번 진료에 담을 수 있는 글자 수를 넘었어요. 기록을 따로 보관해 주세요.')
                return
              }
              add({ id: sourceId(), kind, text: draft.trim(), example: false })
              setDraft('')
              setModal(null)
            }}
          >
            원문 확인하고 추가하기
          </Button>
        </Sheet>
      )}
      {modal === 'item' && selected && (
        <Sheet title={labels[selected.kind]} onClose={close}>
          {selected.kind === 'conflict' && (
            <Notice warning>
              같은 내용인지, 어느 내용이 맞는지 병원에 물어봐 주세요. 앱이 정답을 고르지 않아요.
            </Notice>
          )}
          {selected.evidence.map((e, i) => {
            const s = visit.sources.find((s) => s.id === e.sourceId)!
            return (
              <div key={i}>
                <h3>{sourceLabels[s.kind]}</h3>
                <blockquote>{e.quote}</blockquote>
                <details className="record-disclosure">
                  <summary>전체 원문 보기</summary>
                  <p className="source-quote">{s.text}</p>
                </details>
                {s.kind === 'reported_reply' && (
                  <p className="small-note">
                    내가 입력한 답변이에요. 병원이 인증한 답변은 아니에요.
                  </p>
                )}
              </div>
            )
          })}
          <p className="small-note">
            AI가 원문에서 골랐어요. 앞뒤 조건도 읽고, 이해하기 어려우면 물어봐 주세요.
          </p>
          <Button
            onClick={() => {
              setQuestion('이 내용을 다시 설명해 주세요.')
              open('question')
            }}
          >
            질문하고 답변 적기
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const key = `item-${result?.items.indexOf(selected)}`
              update({
                completed: visit.completed.includes(key)
                  ? visit.completed.filter((x) => x !== key)
                  : [...visit.completed, key],
              })
              close()
            }}
          >
            {visit.completed.includes(`item-${result?.items.indexOf(selected)}`)
              ? '확인 표시 지우기'
              : '내가 확인한 내용으로 표시하기'}
          </Button>
          <details className="record-disclosure">
            <summary>방문 일정이 있나요?</summary>
            <p>병원에 확인한 방문 날짜와 시간을 직접 정해요.</p>
            <Button variant="quiet" onClick={() => open('schedule')}>
              방문 일정·알림 검토하기
            </Button>
          </details>
        </Sheet>
      )}
      {modal === 'question' && source && (
        <Sheet title="질문하고 답변을 적어요" onClose={close}>
          <label className="form-field">
            보여줄 질문
            <textarea
              value={question}
              maxLength={2000}
              onChange={(e) => {
                setQuestion(e.target.value)
                setChecked(false)
              }}
            />
          </label>
          <label className="request-option">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>이 질문을 보여줄게요</span>
          </label>
          <Button
            disabled={!checked || !question.trim()}
            onClick={() => {
              approve({ sourceId: source.id, kind: 'question', text: question })
              close()
              present([question, ...selected!.evidence.map((e) => e.quote)])
            }}
          >
            질문 크게 보여주기
          </Button>
          <details className="record-disclosure">
            <summary>받은 답변 적기</summary>
            <label className="form-field">
              병원에서 받은 답변
              <textarea value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} />
            </label>
            <p className="small-note">
              내가 입력한 답변으로 남겨요. 추가하면 이전 승인 내용은 다시 검토해요.
            </p>
            <Button
              disabled={!reply.trim()}
              onClick={() => {
                add({ id: sourceId(), kind: 'reported_reply', text: reply.trim(), example: false })
                setReply('')
                close()
              }}
            >
              답변 기록하기
            </Button>
          </details>
        </Sheet>
      )}
      {modal === 'schedule' && source && (
        <Sheet title="방문 일정과 알림을 확인해요" onClose={close}>
          <h3>근거 원문</h3>
          <blockquote>{source.text}</blockquote>
          <p>
            확인한 연도·날짜·시간을 직접 입력해 주세요. 복용·금식·치료 알림에는 사용하지 않아요.
          </p>
          <label className="form-field">
            방문 날짜
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setChecked(false)
              }}
            />
          </label>
          <label className="form-field">
            방문 시간 (한국 시간)
            <input
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.target.value)
                setChecked(false)
              }}
            />
          </label>
          <label className="request-option">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>병원에 확인한 방문 일정이에요</span>
          </label>
          <label className="request-option">
            <input
              type="checkbox"
              checked={reminder}
              onChange={(e) => setReminder(e.target.checked)}
            />
            <span>캘린더에 1시간 전 알림도 넣을게요</span>
          </label>
          <p className="small-note">
            캘린더 파일을 열어 저장해야 알림을 받을 수 있어요. 실제 병원 예약은 바꾸지 않아요.
          </p>
          <Button
            disabled={!checked || !date || !time}
            onClick={() => {
              downloadCalendar(date, time, reminder)
              approve({
                sourceId: source.id,
                kind: 'schedule',
                text: `${date} ${time} (한국 시간)`,
              })
              if (reminder)
                approve({
                  sourceId: source.id,
                  kind: 'reminder',
                  text: '방문 1시간 전 캘린더 알림',
                })
              close()
            }}
          >
            승인하고 캘린더 파일 받기
          </Button>
        </Sheet>
      )}
    </>
  )
}
