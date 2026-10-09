import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellPlus, CalendarPlus, Check, ChevronRight, Clock, Loader2, Lock, MessageCircleQuestion, Stethoscope } from 'lucide-react';

import { deriveProposals, type Proposal } from '../agent/proposals';
import type { Visit } from '../lib/types';
import { mutate, sendToHospital } from '../store/visit';
import { Notice, Sheet } from '../ui';


const ICON = { ask: MessageCircleQuestion, calendar: CalendarPlus, reminder: BellPlus, booking: Stethoscope };
const STATE_ICON = { waiting: Clock, blocked: Lock, done: Check };

/**
 * 진료가 끝나면 에이전트가 다음 일을 미리 준비해 한곳에 내민다.
 * 사용자는 실제로 나갈 내용을 보고 한 번 승인한다. 승인 전에는 아무것도 나가지 않는다.
 */
export default function Prepared({ visit }: { visit: Visit }) {
  const navigate = useNavigate();
  const proposals = deriveProposals(visit).filter(p => p.kind === 'ask' || p.kind === 'booking');
  const ready = proposals.filter((p) => p.state === 'ready');
  const [reviewing, setReviewing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [sent, setSent] = useState(0);


  if (!proposals.length) return null;

  const open = () => {
    setPicked(ready.map((p) => p.id));
    setFinished(false);
    setSent(0);
    setReviewing(true);
  };

  const run = () => {
    const chosen = ready.filter((p) => picked.includes(p.id));
    setBusy(true);
    let count = 0;
    for (const p of chosen) {
      if (p.kind === 'ask') {
        sendToHospital('confirm_time', p.detail, p.issueId);
        count++;
      } else if (p.kind === 'booking') {
        const subject = visit.plan?.infos.find((i) => i.id === p.infoId)?.bookable;
        mutate((v) => {
          v.booking.subject = subject;
        });
        sendToHospital('book_offer', p.detail);
        count++;
      }
    }
    setSent(count);

    setFinished(true);
    setBusy(false);
  };

  const follow = (p: Proposal) => {

    if (p.kind === 'ask') return navigate(`/after/issue/${p.issueId}`);
    navigate('/after/hospital');
  };




  return (
    <section className="prepared" aria-labelledby="sec-prepared">
      <h2 id="sec-prepared" className="section-title">
        풀다가 준비한 일
      </h2>
      <p className="sub">내용을 먼저 보여 드려요. 확인한 뒤에 진행해요.</p>

      <ul className="prepared-list">
        {proposals.map((p) => {
          const Icon = ICON[p.kind];
          const StateIcon = STATE_ICON[p.state as keyof typeof STATE_ICON];
          const actionable = p.state === 'review' || p.state === 'choose';
          return (
            <li key={p.id} className={`prepared-row ${p.state}${actionable ? ' tappable' : ''}`} onClick={actionable ? () => follow(p) : undefined}>
              <span className="item-icon" aria-hidden>
                {StateIcon ? <StateIcon size={22} /> : <Icon size={22} />}
              </span>
              <div className="grow">
                <p className="prepared-title">{p.title}</p>
                <p className="prepared-detail">{p.short ?? p.detail}</p>
                {p.note && <p className="prepared-note">{p.note}</p>}
                {actionable && (
                  <button className="link" onClick={() => follow(p)}>
                    {p.kind === 'reminder' ? '시간 고르기' : '확인하기'}
                    <ChevronRight size={16} aria-hidden />
                  </button>
                )}
                {p.state === 'waiting' && (
                  <button className="link" onClick={() => navigate('/after/hospital')}>
                    접수 창구에 보여줄 QR 열기
                    <ChevronRight size={16} aria-hidden />
                  </button>
                )}
                {p.link && (
                  <a className="link" href={p.link} target="_blank" rel="noreferrer">
                    캘린더에서 보기
                    <ChevronRight size={16} aria-hidden />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {ready.length > 0 && (
        <button className="btn btn-primary btn-block" onClick={open}>
          {ready.length > 1 ? `${ready.length}가지 확인하기` : '확인하기'}
        </button>
      )}

      <Sheet open={reviewing} title={finished ? '다 했어요' : '이대로 할까요?'} onClose={() => setReviewing(false)}>
        <div className="stack">
          {!finished && (
            <>
              <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {ready.map((p) => {
                  const on = picked.includes(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        className="choice"
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() => setPicked(on ? picked.filter((id) => id !== p.id) : [...picked, p.id])}
                      >
                        <span className="check" aria-hidden>
                          {on && <Check size={20} strokeWidth={3} />}
                        </span>
                        <span className="grow">
                          <span className="sub" style={{ display: 'block' }}>
                            {`${visit.appointment.hospital || '병원'} 직원에게 물어볼 말`}
                          </span>
                          {p.detail}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button className="btn btn-primary btn-block" disabled={!picked.length || busy} onClick={run}>
                {busy && <Loader2 size={20} className="spin" aria-hidden />}
                {picked.length > 1 ? `${picked.length}가지 이대로 하기` : '이대로 하기'}
              </button>
              <p className="hint">누르기 전에는 아무 일도 일어나지 않아요.</p>
            </>
          )}
          {finished && (
            <>
              {sent > 0 && (
                <Notice tone="ok" title={`물어볼 말 ${sent}개를 준비했어요.`}>
                  직원에게 QR을 보여 주면 직원 화면에 질문이 보여요.
                  <br />
                  답이 오면 바로 알려 드려요.
                </Notice>
              )}

              <button className="btn btn-primary btn-block" onClick={() => setReviewing(false)}>
                확인했어요
              </button>
              {sent > 0 && (
                <button
                  className="btn btn-secondary btn-block"
                  onClick={() => {
                    setReviewing(false);
                    navigate('/after/hospital');
                  }}
                >
                  접수 창구에 보여줄 QR 열기
                </button>
              )}
            </>
          )}
        </div>
      </Sheet>
    </section>
  );
}
