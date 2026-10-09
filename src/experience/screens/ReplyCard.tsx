import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageSquareText, X } from 'lucide-react';
import { ReplyBubble } from '../ui';
import { agent } from '../agent';
import { fieldWord, pendingReply, replyProblem } from '../agent/plan';
import { formatWhen } from '../lib/time';
import { planYear, sendToHospital, useVisit } from '../store/visit';

/** 읽는 흐름을 끊으면 안 되는 화면. 여기서는 띄우지 않고, 나오면 보여준다. */
const QUIET = ['/consult', '/present', '/after/issue/', '/after/hospital'];

/**
 * 병원 답 가운데 App의 DeskReplySheet가 다루지 않는 두 경우를 보던 화면 위에 띄운다.
 *  - 답은 왔는데 값을 읽지 못한 경우 (조용히 묻히지 않게 알린다)
 *  - 예약 문의에 병원이 시간을 알려 준 경우 (그 자리에서 예약을 요청한다)
 * 스스로 사라지지 않고, 사용자가 누를 때만 다음으로 넘어간다.
 */
export default function ReplyCard() {
  const visit = useVisit();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<string[]>([]);

  if (!visit?.plan || QUIET.some((p) => pathname.startsWith(p))) return null;
  const close = (key: string) => setDismissed((d) => [...d, key]);

  for (const issue of visit.plan.issues.filter((i) => i.state !== 'resolved')) {
    const reply = pendingReply(issue, visit.sources);
    if (!reply || reply.type !== 'hospital_reply' || dismissed.includes(reply.id)) continue;
    // 값을 읽은 답은 DeskReplySheet가 바뀔 내용과 함께 보여준다
    if (agent.patch(issue, reply, planYear(visit))) continue;
    const word = fieldWord(issue.field);
    const problem = replyProblem(issue, reply, planYear(visit));
    return (
      <aside className="reply-card" role="alert">
        <div className="row">
          <span className="item-icon warn" aria-hidden>
            <MessageSquareText size={22} />
          </span>
          <p className="reply-title grow">병원에서 답이 왔어요</p>
          <button className="icon-btn" onClick={() => close(reply.id)} aria-label="나중에 보기">
            <X size={22} aria-hidden />
          </button>
        </div>
        <ReplyBubble from="병원 직원" text={reply.text} />
        <p className="sub">
          {problem === 'weekday_mismatch'
            ? '답에 적힌 요일과 날짜가 서로 맞지 않아요. 그대로 넣지 않았어요.'
            : `이 답에서 ${word.obj} 찾지 못했어요. 추측하지 않고 그대로 두었어요.`}
        </p>
        <button
          className="btn btn-secondary btn-block"
          onClick={() => {
            close(reply.id);
            navigate(`/after/issue/${issue.id}`);
          }}
        >
          다시 물어보기
        </button>
      </aside>
    );
  }

  const { booking } = visit;
  if (booking.state === 'offered' && booking.offer) {
    const key = `offer-${booking.offer.date}-${booking.offer.time}`;
    const when = formatWhen(booking.offer);
    if (!dismissed.includes(key)) {
      return (
        <aside className="reply-card" role="alert">
          <div className="row">
            <span className="item-icon" aria-hidden>
              <MessageSquareText size={22} />
            </span>
            <p className="reply-title grow">병원이 {booking.subject} 시간을 알려 줬어요</p>
            <button className="icon-btn" onClick={() => close(key)} aria-label="나중에 보기">
              <X size={22} aria-hidden />
            </button>
          </div>
          <p className="reply-change">
            <strong>{when}</strong>
          </p>
          <button
            className="btn btn-primary btn-block"
            onClick={() => sendToHospital('book_confirm', `${when}에 ${booking.subject} 예약해 주세요.`)}
          >
            이 시간으로 예약 요청
          </button>
          <p className="hint">예약을 부탁하는 것이에요. 병원이 답해야 예약이 접수돼요.</p>
        </aside>
      );
    }
  }
  return null;
}
