import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2 } from 'lucide-react';
import { formatWhen } from '../lib/time';
import { sendToHospital, useVisit } from '../store/visit';
import { Notice, Screen } from '../ui';

/** 요청 보냄 / 답변 대기 / 병원 제안 / 접수를 서로 다른 상태로 보여준다. */
export default function HospitalThread() {
  const visit = useVisit()!;
  const { booking, thread, pending, deskCode } = visit;
  const offer = booking.offer ? formatWhen(booking.offer) : '';
  const deskUrl = `${location.origin}${location.pathname}#/desk/${deskCode}`;
  const [qr, setQr] = useState('');

  useEffect(() => {
    QRCode.toDataURL(deskUrl, { margin: 1, width: 360, color: { dark: '#192d2a', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [deskUrl]);

  return (
    <Screen label="진료 후" title="병원과 주고받은 내용" back="/after">
      <div className="thread mt24" aria-live="polite">
        {thread.length === 0 && <p className="sub">아직 주고받은 내용이 없어요.</p>}
        {thread.map((msg) => (
          <div key={msg.id} className={`msg ${msg.from}`}>
            <span className="cap-meta">{msg.from === 'me' ? (msg.failed ? '올리지 못한 말' : '내가 물어본 말') : '접수 창구 답변'}</span>
            {msg.text}
          </div>
        ))}
        {pending.length > 0 && (
          <div className="row sub" role="status">
            <Loader2 size={20} className="spin" aria-hidden />
            질문을 올렸어요. 답을 기다리는 중이에요.
          </div>
        )}
        {thread.some((m) => m.failed) && <Notice tone="error">올리지 못한 말이 있어요. 인터넷 연결을 확인하고 다시 해 주세요.</Notice>}
      </div>

      {booking.state === 'offered' && (
        <section className="section panel stack" aria-labelledby="sec-offer">
          <h2 id="sec-offer" className="item-title">
            병원이 알려 준 시간
          </h2>
          <p className="item-when" style={{ fontSize: 24 }}>
            {offer}
          </p>
          <p className="sub">{booking.subject}</p>
          <button
            className="btn btn-primary btn-block"
            onClick={() => sendToHospital('book_confirm', `${offer}에 ${booking.subject} 예약해 주세요.`)}
          >
            이 시간으로 예약 요청
          </button>
          <p className="hint">예약을 부탁하는 것이에요. 병원이 답해야 예약이 접수돼요.</p>
        </section>
      )}
      {booking.state === 'confirmed' && (
        <div className="mt24">
          <Notice tone="ok" title="병원이 예약을 접수했어요.">
            해야 할 일에 {booking.subject} 일정을 넣었어요.
          </Notice>
        </div>
      )}

      <section className="section panel" aria-labelledby="sec-desk">
        <h2 id="sec-desk" className="item-title">
          접수 창구에 보여주기
        </h2>
        <p className="sub mt8">직원이 이 QR을 찍으면 내 질문을 보고 바로 답할 수 있어요. 앱 설치는 필요 없어요.</p>
        {qr && <img src={qr} alt="접수 창구 화면으로 연결되는 QR 코드" style={{ display: 'block', width: 200, margin: '16px auto 8px' }} />}
        <p className="hint" style={{ wordBreak: 'break-all', textAlign: 'center' }}>
          {deskUrl}
        </p>
      </section>
    </Screen>
  );
}
