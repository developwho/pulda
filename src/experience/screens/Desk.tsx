import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, HeartHandshake, Send } from 'lucide-react';
import { formatDate, formatTime } from '../lib/time';
import type { DeskMessage } from '../lib/types';
import { Notice } from '../ui';

const KIND_LABEL = {
  confirm_time: '예약 확인 질문',
  book_offer: '예약 문의',
  book_confirm: '예약 요청',
  reply: '',
};

/**
 * 접수 창구 화면. 환자 화면과 같은 코드로 연결된다.
 * 설치도 로그인도 없이 링크만 열면 되고, 환자가 고른 질문만 보인다.
 */
export default function Desk() {
  const { code = '' } = useParams();
  const [messages, setMessages] = useState<DeskMessage[]>([]);
  const [requests, setRequests] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, { date?: string; time?: string }>>({});

  useEffect(() => {
    const stream = new EventSource(`/api/desk/${code}/events`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.requests) setRequests(data.requests);
      if (data.messages) setMessages(data.messages);
      if (data.message) setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
    };
    return () => stream.close();
  }, [code]);

  const reply = async (request: DeskMessage, text: string, accepted = false) => {
    setFailed(null);
    try {
      const response = await fetch(`/api/desk/${code}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: `desk-${request.id}`, from: 'desk', kind: 'reply', text, replyTo: request.id, accepted }),
      });
      if (!response.ok) throw new Error();
      setDrafts((d) => ({ ...d, [request.id]: '' }));
    } catch {
      setFailed(request.id);
    }
  };

  const fromPatient = messages.filter((m) => m.from === 'patient');
  const answerOf = (id: string) => messages.find((m) => m.from === 'desk' && m.replyTo === id);

  return (
    <div className="screen">
      <header className="bar">
        <span className="bar-label brand">
          <HeartHandshake size={24} aria-hidden />
          풀다 · 접수 창구
        </span>
        <span className={`tag ${connected ? 'ok' : 'warn'}`}>{connected ? '연결됨' : '연결 중'}</span>
      </header>
      <main className="body">
        <h1 className="title">환자가 보낸 질문</h1>
        <p className="lead">청각장애가 있는 환자가 글로 질문을 보냈어요.
          <br />
          답을 적어 보내면 환자 화면에 바로 보여요.</p>

        {requests.length > 0 && (
          <div className="mt16">
            <Notice title="환자가 부탁한 소통 방식">
              {requests.map((r) => (
                <div key={r}>{r}</div>
              ))}
            </Notice>
          </div>
        )}

        <div className="stack mt24">
          {fromPatient.length === 0 && <p className="sub">아직 받은 질문이 없어요. 이 화면을 열어 두면 질문이 오는 대로 보여요.</p>}
          {fromPatient.map((request) => {
            const answer = answerOf(request.id);
            const draft = drafts[request.id] ?? '';
            return (
              <article key={request.id} className="panel stack" style={answer ? undefined : { borderColor: 'var(--primary)', borderWidth: 2 }}>
                <div>
                  <span className="tag">{KIND_LABEL[request.kind]}</span>
                </div>
                <p className="big-value">{request.text}</p>

                {answer ? (
                  <Notice tone="ok" title={answer.accepted ? '예약을 접수했다고 답했어요.' : '답을 보냈어요.'}>
                    {answer.text}
                  </Notice>
                ) : (
                  <>
                    {request.kind === 'book_confirm' && (
                      <button className="btn btn-primary btn-block" onClick={() => reply(request, '예약을 접수했습니다.', true)}>
                        <Check size={20} aria-hidden />
                        예약 접수
                      </button>
                    )}
                    {/* 타이핑 없이 답할 수 있는 길을 먼저 둔다. 잘못 읽힐 일이 없는 정해진 문장으로 나간다 */}
                    {request.options && request.options.length > 0 && (
                      <div>
                        <p className="label">맞는 것을 눌러 답하기</p>
                        <div className="stack-sm mt8">
                          {request.options.map((option) => (
                            <button key={option} className="btn btn-primary btn-block" onClick={() => reply(request, `${option} 맞습니다.`)}>
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {request.answer && (
                      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        {(request.answer === 'when' ? (['date', 'time'] as const) : [request.answer]).map((part) => (
                          <div key={part} className="field grow">
                            <label htmlFor={`${part}-${request.id}`}>{part === 'date' ? '날짜' : '시간'}</label>
                            <input
                              id={`${part}-${request.id}`}
                              className="input"
                              type={part}
                              value={picks[request.id]?.[part] ?? ''}
                              onChange={(e) => setPicks((p) => ({ ...p, [request.id]: { ...p[request.id], [part]: e.target.value } }))}
                            />
                          </div>
                        ))}
                        <button
                          className="btn btn-secondary btn-block"
                          disabled={!picks[request.id]?.date && !picks[request.id]?.time}
                          onClick={() => {
                            const { date, time } = picks[request.id] ?? {};
                            const when = [date && formatDate(date), time && formatTime(time)].filter(Boolean).join(' ');
                            void reply(request, `${when}에 오시면 됩니다.`);
                          }}
                        >
                          고른 일정으로 답하기
                        </button>
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor={`reply-${request.id}`}>
                        {request.kind === 'book_offer' ? '답 적기 · 날짜와 시간을 함께 적어 주세요' : request.answer ? '직접 적어 답하기' : '답 적기'}
                      </label>
                      <textarea
                        id={`reply-${request.id}`}
                        className="textarea"
                        placeholder={request.kind === 'book_offer' ? '예: 10월 16일 오후 3시 30분에 가능합니다' : '예: 오후 3시가 맞습니다'}
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [request.id]: e.target.value }))}
                      />
                    </div>
                    <button
                      className={`btn btn-block ${request.kind === 'book_confirm' || request.answer ? 'btn-secondary' : 'btn-primary'}`}
                      disabled={!draft.trim()}
                      onClick={() => reply(request, draft.trim())}
                    >
                      <Send size={20} aria-hidden />
                      답 보내기
                    </button>
                    {failed === request.id && <Notice tone="error">답을 보내지 못했어요. 다시 눌러 주세요.</Notice>}
                  </>
                )}
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
