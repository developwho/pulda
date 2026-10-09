import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Loader2, Maximize2, Send } from 'lucide-react';
import { agent } from '../agent';
import { fieldWord, pendingReply, replyProblem } from '../agent/plan';
import type { When } from '../lib/types';
import { addSource, applyPatch, deferIssue, fixIssueValue, planYear, sendToHospital, setPresenting, useVisit } from '../store/visit';
import { ChangeLine, Notice, ReplyBubble, Screen, SourceQuote, SourceTag } from '../ui';

/** S08 + O02 — 질문 → 답변 기록 → 변경안 검토 → 반영이 한 화면에서 이어진다. */
export default function IssueDetail() {
  const { id } = useParams();
  const visit = useVisit()!;
  const navigate = useNavigate();
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const [applying, setApplying] = useState(false);
  const [fixed, setFixed] = useState<When>({});
  const issue = visit.plan?.issues.find((i) => i.id === id);

  if (!issue) {
    return (
      <Screen label="확인할 내용" title="지금은 확인할 내용이 없어요." back="/after">
        <p className="lead">자료가 바뀌어 이 항목이 없어졌어요.</p>
      </Screen>
    );
  }

  const word = fieldWord(issue.field);
  const sourceOf = (sourceId: string) => visit.sources.find((s) => s.id === sourceId);
  const waiting = visit.pending.some((p) => p.kind === 'confirm_time' && p.issueId === issue.id);
  const latestReply = pendingReply(issue, visit.sources);
  const problem = latestReply ? replyProblem(issue, latestReply, planYear(visit)) : null;
  const patch = latestReply && issue.state !== 'resolved' ? agent.patch(issue, latestReply, planYear(visit)) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issue.question);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };
  const show = () => {
    setPresenting([issue.question]);
    navigate('/present');
  };
  const saveReply = () => {
    addSource('reported_reply', reply, issue.id);
    setReply('');
  };
  // 자막이 날짜·시간을 못 알아들은 경우, 사용자가 원문을 보고 바로 정할 수 있게 한다
  const needs = issue.needs ?? [];
  const canFix = issue.kind === 'missing' && !issue.clinical && needs.length > 0;
  const evidence = visit.plan?.actions.find((a) => a.id === issue.affects[0])?.evidence ?? [];
  const fix = async () => {
    if (!fixed.date && !fixed.time) return;
    setApplying(true);
    await fixIssueValue(issue.id, fixed);
    setFixed({});
    setApplying(false);
  };
  const apply = async () => {
    if (!patch) return;
    setApplying(true);
    await applyPatch(patch);
    setApplying(false);
  };

  if (issue.state === 'resolved' && issue.resolution) {
    return (
      <Screen
        label="확인할 내용"
        title={issue.field === 'frequency' ? '약 먹는 횟수를 확인했어요.' : `다음 진료 ${word.obj} 고쳤어요.`}
        back="/after"
        footer={
          <button className="btn btn-primary btn-block" onClick={() => navigate('/after')}>
            진료 정리로 돌아가기
          </button>
        }
      >
        <p className="item-when mt16" style={{ fontSize: 28 }}>
          {issue.resolution.label}
        </p>
        <div className="stack mt24">
          <div className="stack-sm">
            <div>
              <SourceTag source={sourceOf(issue.resolution.sourceId)} />
            </div>
            <p className="quote">{sourceOf(issue.resolution.sourceId)?.text}</p>
          </div>
          <p className="hint">
            {sourceOf(issue.resolution.sourceId)?.type === 'patient_fix'
              ? '내가 직접 고친 값이에요. 병원에 확인한 것은 아니에요.'
              : sourceOf(issue.resolution.sourceId)?.type === 'reported_reply'
                ? '내가 옮겨 적은 답변이에요. 의료진이 이 앱에서 확인한 것은 아니에요.'
                : '접수 창구 화면에서 보낸 답변이에요.'}
          </p>
          {issue.clinical && <Notice tone="warn">약 먹는 방법은 의료진이 알려 준 대로 따라 주세요.</Notice>}
        </div>
      </Screen>
    );
  }

  return (
    <Screen label="확인할 내용" title={issue.title} back="/after">
      <p className="lead">{issue.summary}</p>

      {issue.sides.length > 0 && (
        <div className="compare mt24">
          {issue.sides.map((side, i) => (
            <div key={i} className="compare-side stack-sm">
              <div>
                <SourceTag source={sourceOf(side.sourceId)} />
              </div>
              <p>{side.quote}</p>
              <p className="big-value">{side.value}</p>
            </div>
          ))}
          <p className="hint">
            <strong>{word.subj}</strong> 서로 달라요. 자동 자막이 잘못 들었을 수 있어요.
            <br />
            어느 쪽이 맞는지는 병원이 알려 줄 수 있어요.
          </p>
        </div>
      )}

      {canFix && (
        <section className="section" aria-labelledby="sec-fix">
          <h2 id="sec-fix" className="section-title">
            내가 바로 고치기
          </h2>
          {evidence.map((e, i) => {
            const source = sourceOf(e.sourceId);
            return (
              <div key={i} className="stack-sm mt16">
                <div>
                  <SourceTag source={source} />
                </div>
                {source ? <SourceQuote source={source} quote={e.quote} /> : <p className="quote">{e.quote}</p>}
              </div>
            );
          })}
          <p className="hint mt8">자막이 말을 잘못 알아들었을 수 있어요.
            <br />위 문장을 보고 알고 있는 {word.obj} 직접 골라 주세요.</p>
          <div className="row mt16">
            <div className="stack-sm grow">
              {needs.map((part) => (
                <div key={part} className="field">
                  <label htmlFor={`fix-${part}`}>{part === 'date' ? '날짜' : '시간'}</label>
                  <input
                    id={`fix-${part}`}
                    className="input"
                    type={part}
                    value={fixed[part] ?? ''}
                    onChange={(e) => setFixed({ ...fixed, [part]: e.target.value || undefined })}
                  />
                </div>
              ))}
            </div>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }} disabled={(!fixed.date && !fixed.time) || applying} onClick={fix}>
              {applying && <Loader2 size={20} className="spin" aria-hidden />}
              고치기
            </button>
          </div>
          <p className="hint mt8">병원에 확인한 값이 아니라 내가 고친 값으로 표시돼요. 확실하지 않으면 아래에서 병원에 물어볼 수 있어요.</p>
        </section>
      )}

      {issue.sides.length === 0 && !canFix && (
        <div className="compare mt24">
          {(visit.plan?.actions.find((a) => a.id === issue.affects[0])?.evidence ?? []).map((ev, i) => (
            <div key={i} className="compare-side stack-sm">
              <div>
                <SourceTag source={sourceOf(ev.sourceId)} />
              </div>
              <p>{ev.quote}</p>
            </div>
          ))}
          <p className="hint">
            이 문장에서 <strong>{word.obj}</strong> 읽지 못했어요.
            <br />
            자동 자막이 잘못 들었을 수 있어요. 지어내지 않고 병원에 물어봐요.
          </p>
        </div>
      )}

      <section className="section" aria-labelledby="sec-q">
        <h2 id="sec-q" className="section-title">
          병원에 물어볼 말
        </h2>
        <p className="panel big-value mt16">{issue.question}</p>
        <div className="stack-sm mt16">
          <button className="btn btn-primary btn-block" onClick={show}>
            <Maximize2 size={20} aria-hidden />
            큰 글씨로 보여주기
          </button>
          {!issue.clinical && (
            <button
              className="btn btn-secondary btn-block"
              disabled={waiting}
              onClick={() => sendToHospital('confirm_time', issue.question, issue.id)}
            >
              <Send size={20} aria-hidden />
              직원 화면에 질문 올리기
            </button>
          )}
        </div>
        <div className="btn-row mt8">
          <button className="btn-text" onClick={copy}>
            <Copy size={18} aria-hidden /> 복사하기
          </button>
          {issue.state === 'open' && (
            <button
              className="btn-text"
              onClick={() => {
                deferIssue(issue.id);
                navigate('/after');
              }}
            >
              나중에 확인
            </button>
          )}
        </div>
        {copied === 'ok' && <Notice tone="ok">질문을 복사했어요. 병원에 보낸 것은 아니에요.</Notice>}
        {copied === 'failed' && <Notice tone="error">자동 복사가 안 됐어요. 위의 문장을 길게 눌러 복사해 주세요.</Notice>}
      </section>

      <section className="section" aria-labelledby="sec-a">
        <h2 id="sec-a" className="section-title">
          병원의 답변
        </h2>
        <div className="stack mt16">
          {waiting && (
            <div className="notice" role="status">
              <Loader2 size={22} className="spin" aria-hidden />
              <div className="grow">
                <strong>직원 화면에 질문을 올렸어요.</strong>
                답변을 기다리는 중이에요.
                <button className="btn-text" onClick={() => navigate('/after/hospital')}>
                  접수 창구에 보여줄 QR 열기
                </button>
              </div>
            </div>
          )}

          {latestReply && (
            <ReplyBubble from={latestReply.label} text={latestReply.text} />
          )}

          {latestReply && patch && (
            <div className="panel stack" style={{ borderColor: 'var(--primary)', borderWidth: 2 }}>
              <h3 className="item-title">이렇게 고칠까요?</h3>
              <ChangeLine before={patch.before.length ? patch.before.join(' 또는 ') : `${word.noun} 미정`} after={patch.afterLabel} />
              <button className="btn btn-primary btn-block" disabled={applying} onClick={apply}>
                {applying && <Loader2 size={20} className="spin" aria-hidden />}
                바꾼 내용 반영
              </button>
              <p className="hint">누르기 전에는 아무것도 바뀌지 않아요.</p>
            </div>
          )}
          {latestReply && !patch && (
            <Notice tone="warn">
              {problem === 'weekday_mismatch'
                ? '답에 적힌 요일과 날짜가 서로 맞지 않아요. 그대로 넣지 않았어요. 날짜를 다시 확인해 주세요.'
                : `답변에서 ${word.obj} 찾지 못했어요. ${word.obj} 넣어 다시 적어 주세요.`}
            </Notice>
          )}

          <div className="field">
            <label htmlFor="reply-text">병원이 알려 준 답을 내가 적기</label>
            <textarea
              id="reply-text"
              className="textarea"
              placeholder={issue.field === 'time' ? '예: 오후 3시가 맞습니다' : undefined}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary btn-block" disabled={!reply.trim()} onClick={saveReply}>
            답변 저장
          </button>
        </div>
      </section>
    </Screen>
  );
}
