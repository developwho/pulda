import { Link } from 'react-router-dom';
import { ArrowRight, HeartHandshake } from 'lucide-react';
import { Screen } from '../ui';
import '../styles/onboarding.css';

export default function DemoAccount({ mode, onContinue }: { mode: 'login' | 'signup'; onContinue: () => void }) {
  const signingUp = mode === 'signup';
  return (
    <div className="account-screen">
      <Screen label={signingUp ? '회원가입' : '로그인'} back="/welcome" title={signingUp ? '풀다와 함께 시작해요.' : '다시 만나 반가워요.'}>
        <p className="lead">{signingUp ? '내 말을 준비하고, 진료를 함께 이해해요.' : '오늘의 진료도 함께 준비해요.'}</p>
        <div className="account-mark" aria-hidden><HeartHandshake size={40} strokeWidth={1.5} /></div>
        <div className="account-fields" aria-describedby="demo-account-note">
          <div className="field"><label htmlFor="demo-email">이메일</label><input className="input" id="demo-email" type="email" value="demo@pulda.example" readOnly tabIndex={-1} autoComplete="off" /></div>
          <div className="field"><label htmlFor="demo-password">비밀번호</label><input className="input" id="demo-password" type="password" value="pulda-demo" readOnly tabIndex={-1} autoComplete="off" /></div>
        </div>
        <p className="account-note" id="demo-account-note">데모용 정보가 채워져 있어요.<br />입력 없이 아래 버튼을 누르면 시작해요.</p>
        <button className="btn btn-primary btn-block" onClick={onContinue}>{signingUp ? '가입하고 시작하기' : '로그인'}<ArrowRight size={20} aria-hidden /></button>
        <p className="account-switch">{signingUp ? '이미 계정이 있나요?' : '풀다가 처음인가요?'} <Link to={signingUp ? '/login' : '/signup'}>{signingUp ? '로그인' : '회원가입'}</Link></p>
        <p className="entry-demo-note">실제 가입이나 인증은 진행하지 않아요.</p>
      </Screen>
    </div>
  );
}
