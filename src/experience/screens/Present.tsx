import { Navigate, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useStore } from '../store/visit';

/** 상대에게 보여주는 화면. 고른 문장 말고는 아무것도 싣지 않는다 (FR-003). */
export default function Present() {
  const lines = useStore((s) => s.presenting);
  const navigate = useNavigate();

  if (!lines?.length) return <Navigate to="/prepare" replace />;

  return (
    <div className="present">
      <header className="bar" style={{ background: '#fff' }}>
        <button className="icon-btn" onClick={() => navigate(-1)}>
          <ChevronLeft size={24} aria-hidden />내 화면으로 돌아가기
        </button>
      </header>
      <main className="present-body">
        {lines.map((line) => (
          <p key={line} className="present-line">
            {line}
          </p>
        ))}
      </main>
    </div>
  );
}
