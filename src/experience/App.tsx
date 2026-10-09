import { useState } from 'react';
import { storageKey } from './runtime';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { agent } from './agent';
import { fieldWord, pendingReply } from './agent/plan';
import { applyPatch, planYear, useVisit } from './store/visit';
import { ChangeLine, ReplyBubble, Sheet } from './ui';
import Start from './screens/Start';
import Prepare from './screens/Prepare';
import Present from './screens/Present';
import Consult from './screens/Consult';
import After from './screens/After';
import AddSource from './screens/AddSource';
import ItemDetail from './screens/ItemDetail';
import IssueDetail from './screens/IssueDetail';
import HospitalThread from './screens/HospitalThread';
import Settings from './screens/Settings';
import Desk from './screens/Desk';
import TraceLog from './screens/TraceLog';
import ReplyCard from './screens/ReplyCard';
import Concierge from './screens/Concierge';
import Welcome from './screens/Welcome';
import DemoAccount from './screens/DemoAccount';
import { hasCompletedGuide } from './screens/Guide';

const HOME = { preparing: '/prepare', consulting: '/consult', aftercare: '/after' } as const;
// 화면 체험 여부만 기억한다. 인증이나 API 접근 권한으로 사용하지 않는다.
const ENTRY_KEY = storageKey('pulda-demo-entry-v1');
function hasEnteredDemo() {
  try { return sessionStorage.getItem(ENTRY_KEY) === 'entered'; } catch { return false; }
}

/**
 * 병원 답변이 오면 어느 화면에 있든 그 자리에서 바로 보여 준다.
 * 화면을 옮기지 않고 한 번 눌러 반영한다. 누르기 전에는 아무것도 바뀌지 않는다.
 */
function DeskReplySheet() {
  const visit = useVisit();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  if (!visit?.plan || ['/present', '/consult'].includes(pathname)) return null;

  // 반영이 끝났다는 것을 눈으로 확인할 수 있게 한 번 더 보여 준다
  if (applied) {
    return (
      <Sheet open title="고쳤어요" onClose={() => setApplied(null)}>
        <div className="stack">
          <p className="change-done">
            <CheckCircle2 size={28} aria-hidden />
            {applied}
          </p>
          <button className="btn btn-primary btn-block" onClick={() => setApplied(null)}>
            확인했어요
          </button>
        </div>
      </Sheet>
    );
  }

  for (const issue of visit.plan.issues) {
    if (issue.state === 'resolved' || pathname === `/after/issue/${issue.id}`) continue;
    const reply = pendingReply(issue, visit.sources);
    if (!reply || reply.type !== 'hospital_reply' || dismissed.includes(reply.id)) continue;
    const patch = agent.patch(issue, reply, planYear(visit));
    if (!patch) continue;
    const word = fieldWord(issue.field);
    const close = () => setDismissed((d) => [...d, reply.id]);

    return (
      <Sheet open title="병원에서 답이 왔어요" onClose={close}>
        <div className="stack">
          <ReplyBubble from="병원 직원" text={reply.text} />
          <ChangeLine before={patch.before.length ? patch.before.join(' 또는 ') : `${word.noun} 미정`} after={patch.afterLabel} />
          <button
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await applyPatch(patch);
              setBusy(false);
              setApplied(`다음 진료 ${patch.afterLabel}`);
            }}
          >
            {busy && <Loader2 size={20} className="spin" aria-hidden />}
            이대로 반영
          </button>
          <p className="hint">누르기 전에는 아무것도 바뀌지 않아요.</p>
        </div>
      </Sheet>
    );
  }
  return null;
}

export default function App() {
  const visit = useVisit();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [entered, setEntered] = useState(hasEnteredDemo);
  const [showGuide, setShowGuide] = useState(false);
  const home = visit ? HOME[visit.stage] : '/';
  const enterDemo = () => {
    setEntered(true);
    try { sessionStorage.setItem(ENTRY_KEY, 'entered'); } catch { /* 저장 제한 시에도 화면은 진행한다. */ }
  };

  if (pathname === '/welcome') return <div className="app"><Welcome /></div>;
  if (pathname === '/login' || pathname === '/signup') {
    return <div className="app"><DemoAccount key={pathname} mode={pathname === '/login' ? 'login' : 'signup'} onContinue={() => {
      enterDemo();
      setShowGuide(!visit && !hasCompletedGuide());
      navigate(home, { replace: true });
    }} /></div>;
  }
  // 이전 안내 링크로 들어와도 안내를 다시 열지 않는다.
  if (pathname === '/guide') return <Navigate to={home} replace />;

  if (pathname === '/concierge') return <div className="app"><Concierge /></div>;

  // 접수 창구 화면은 환자 기록과 무관하게 링크만으로 열린다
  if (pathname.startsWith('/desk/')) {
    return (
      <div className="app">
        <Routes>
          <Route path="/desk/:code" element={<Desk />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="app">
      {visit && <DeskReplySheet />}
      {visit && <ReplyCard />}
      {visit ? (
        <Routes>
          <Route path="/prepare" element={<Prepare />} />
          <Route path="/present" element={<Present />} />
          <Route path="/consult" element={<Consult />} />
          <Route path="/after" element={<After />} />
          <Route path="/after/add" element={<AddSource />} />
          <Route path="/after/item/:id" element={<ItemDetail />} />
          <Route path="/after/issue/:id" element={<IssueDetail />} />
          <Route path="/after/hospital" element={<HospitalThread />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/trace" element={<TraceLog />} />
          <Route path="*" element={<Navigate to={HOME[visit.stage]} replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={entered ? <Start showGuide={showGuide} onGuideFinish={() => setShowGuide(false)} /> : <Navigate to="/welcome" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </div>
  );
}
