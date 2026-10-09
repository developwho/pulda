import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useVisit } from '../store/visit';
import { Notice, Screen } from '../ui';

const TASK = { plan: '진료 정리', refine: '전달문 정리', read_image: '사진 읽기' };
const time = (at: number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * 개발자용 실행 기록 (FR-012). 어떤 단계가 실제로 돌았고 무엇을 막았는지 보여준다.
 * 진료 원문은 싣지 않는다. 확률은 판정 기준을 고르기 위한 값이며 정확도 보증이 아니다.
 */
export default function TraceLog() {
  const visit = useVisit()!;

  return (
    <Screen label="개발자용" title="AI 실행 기록" back>
      <p className="lead">모델이 찾은 것을 코드와 Decisions API가 어떻게 확인했는지 남긴 기록이에요.</p>
      <div className="stack mt24">
        {visit.traces.length === 0 && <p className="sub">아직 실행한 기록이 없어요.</p>}
        {visit.traces.map((trace) => {
          const total = trace.steps.reduce((sum, s) => sum + s.ms, 0);
          return (
            <article key={trace.id} className="panel stack">
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <h2 className="item-title grow">{TASK[trace.task]}</h2>
                <span className={`tag ${trace.mode === 'model' ? 'ok' : 'warn'}`}>
                  {trace.mode === 'model' ? trace.model : '규칙 대체'}
                </span>
              </div>
              <p className="sub">
                {time(trace.at)} · {(total / 1000).toFixed(1)}초 · 토큰 {trace.tokens.toLocaleString()}
              </p>
              {trace.note && <Notice tone="warn">{trace.note}</Notice>}

              {trace.steps.length > 0 && (
                <ol style={{ margin: 0, paddingLeft: 22 }} className="stack-sm">
                  {trace.steps.map((s, i) => (
                    <li key={i}>
                      <strong>{s.name}</strong>
                      <div className="sub">
                        {s.detail} · {s.ms.toLocaleString()}ms
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {trace.gates.length > 0 && (
                <div>
                  <p className="label">판정</p>
                  <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }} className="stack-sm">
                    {trace.gates.map((g, i) => (
                      <li key={i} className="row" style={{ alignItems: 'flex-start' }}>
                        {g.passed ? (
                          <CheckCircle2 size={20} aria-hidden color="var(--primary)" style={{ marginTop: 4, flex: 'none' }} />
                        ) : (
                          <ShieldAlert size={20} aria-hidden color="var(--error)" style={{ marginTop: 4, flex: 'none' }} />
                        )}
                        <span className="grow">
                          {g.name}
                          <span className="sub">
                            {' '}
                            · {g.passed ? '통과' : '차단'} {Math.round(g.probability * 100)}%
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {trace.blocked.length > 0 && (
                <Notice tone="error" title={`막은 것 ${trace.blocked.length}건`}>
                  {trace.blocked.map((b, i) => (
                    <div key={i}>
                      {b.what} — {b.reason}
                    </div>
                  ))}
                </Notice>
              )}
            </article>
          );
        })}
      </div>
    </Screen>
  );
}
