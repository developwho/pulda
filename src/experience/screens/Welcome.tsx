import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MessageSquareText } from 'lucide-react';
import BrandMark from '../BrandMark';
import '../styles/onboarding.css';

export default function Welcome() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  return (
    <div className="screen entry-screen">
      <header className="entry-header">
        <span className="entry-brand"><BrandMark /></span>
      </header>
      <main className="entry-main">
        <div className="entry-intro">
          <h1 ref={heading} tabIndex={-1}>내 말이 닿고,<br />진료가 이해되도록.</h1>
          <p>준비하는 순간부터 진료가 끝난 뒤까지.<br />풀다가 함께할게요.</p>
        </div>
        <div className="entry-preview" aria-label="풀다로 소통하는 모습 · 예시">
          <div className="entry-preview-heading"><MessageSquareText size={20} aria-hidden /><span>이렇게 이야기해요</span><span className="entry-example">예시</span></div>
          <div className="entry-message entry-message-mine"><span>내가 전할 말</span><p>설명을 글로 보여주시면<br />더 잘 이해할 수 있어요.</p></div>
          <div className="entry-message entry-message-reply"><span>함께 확인할 말</span><p>천천히, 하나씩<br />확인할게요.</p></div>
          <div className="entry-journey"><span>진료 준비</span><ArrowRight size={15} aria-hidden /><span>진료 중</span><ArrowRight size={15} aria-hidden /><span>진료 후</span></div>
        </div>
      </main>
      <footer className="entry-footer">
        <Link className="btn btn-primary btn-block" to="/signup">가입하고 시작하기<ArrowRight size={20} aria-hidden /></Link>
        <Link className="btn btn-secondary btn-block" to="/login">로그인</Link>
        <p className="entry-demo-note">오늘은 데모로 만나요.<br />실제 계정 없이 버튼만 눌러 둘러볼 수 있어요.</p>
      </footer>
    </div>
  );
}
