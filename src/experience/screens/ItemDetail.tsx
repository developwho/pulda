import { useNavigate, useParams } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { agent } from '../agent';
import { formatWhen } from '../lib/time';
import { useVisit } from '../store/visit';
import { Notice, Screen, SourceQuote, SourceTag } from '../ui';

/** S07 — 쉬운 설명 아래에 실제 원문을 둔다. 원문이 없으면 근거처럼 보여주지 않는다. */
export default function ItemDetail() {
  const { id } = useParams();
  const visit = useVisit()!;
  const navigate = useNavigate();
  const action = visit.plan?.actions.find((a) => a.id === id);
  const info = visit.plan?.infos.find((i) => i.id === id);
  const item = action ?? info;

  if (!item) {
    return (
      <Screen label="진료 후" title="이 항목을 찾지 못했어요." back="/after">
        <p className="lead">자료가 바뀌어 이 항목이 없어졌어요.</p>
      </Screen>
    );
  }

  const title = action ? action.title : info!.text;
  const terms = agent.explain(item.evidence.map((e) => e.quote).join(' '));
  const issue = action && visit.plan!.issues.find((i) => action.issueIds.includes(i.id) && i.state !== 'resolved');

  return (
    <Screen label="원문 보기" title={title} back>
      {action?.when && formatWhen(action.when) && <p className="item-when mt8">{formatWhen(action.when)}</p>}
      {action && action.conditions.length > 0 && <p className="big-value mt8">{action.conditions.join(' · ')}</p>}
      {action?.missing && (
        <div className="mt16">
          <Notice tone="warn">{action.missing}</Notice>
        </div>
      )}
      {info && info.certainty !== 'contact' && (
        <div className="mt16">
          <Notice tone="warn">
            {info.certainty === 'suspected' ? '확실하게 정해진 것이 아니에요.' : '검토 중이라는 설명이에요. 아직 예약한 것이 아니에요.'}
          </Notice>
        </div>
      )}
      {issue && (
        <button className="btn btn-secondary btn-block mt16" onClick={() => navigate(`/after/issue/${issue.id}`)}>
          <HelpCircle size={20} aria-hidden />
          병원에 물어볼 내용 보기
        </button>
      )}

      <section className="section" aria-labelledby="sec-ev">
        <h2 id="sec-ev" className="section-title">
          이 내용이 나온 곳
        </h2>
        <div className="stack mt16">
          {item.evidence.map((ev, i) => {
            const source = visit.sources.find((s) => s.id === ev.sourceId);
            return (
              <div key={i} className="stack-sm">
                <div>
                  <SourceTag source={source} />
                </div>
                {source ? <SourceQuote source={source} quote={ev.quote} /> : <p className="sub">이 자료는 지워졌어요.</p>}
              </div>
            );
          })}
        </div>
        <p className="hint mt16">자동 자막은 잘못 들었을 수 있어요. 원문이 있다고 해서 의료진이 확인한 것은 아니에요.</p>
      </section>

      {terms.length > 0 && (
        <section className="section" aria-labelledby="sec-terms">
          <h2 id="sec-terms" className="section-title">
            낱말 풀이
          </h2>
          <dl className="stack-sm mt16">
            {terms.map((t) => (
              <div key={t.word}>
                <dt style={{ fontWeight: 700 }}>{t.word}</dt>
                <dd style={{ margin: 0 }}>{t.meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="hint mt8">낱말의 일반적인 뜻이에요. 내 진료 내용은 의료진에게 확인해요.</p>
        </section>
      )}
    </Screen>
  );
}
