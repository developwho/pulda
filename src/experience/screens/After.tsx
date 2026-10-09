import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, CalendarDays, Check, ChevronRight, HelpCircle, Loader2, Pill, Plus, Settings, Stethoscope } from 'lucide-react';
import { formatWhen, todayISO } from '../lib/time';
import type { Issue, PlanAction, Source, Visit } from '../lib/types';
import { mutate, removeSource, RETENTION_DAYS, runAnalysis, setStorage, useVisit } from '../store/visit';
import { Notice, Screen, Sheet, SourceTag } from '../ui';
import { isMockMode } from '../runtime';

import Prepared from './Prepared';
import CalendarPlanner from './CalendarPlanner';

const KIND_ICON = { revisit: CalendarDays, medication: Pill, avoid: Ban, test: Stethoscope };
const INFO_TAG = {
  contact: '이럴 때 병원에 연락해요',
  suspected: '확실하게 정해진 것이 아니에요',
  considering: '아직 예약한 것이 아니에요',
};

/** 일정 날짜가 오늘이거나 지났는지. 아직 오지 않은 일정에는 "다녀왔어요"를 묻지 않는다. */
const reached = (date?: string) => !!date && date <= todayISO();

function ActionRow({ visit, action }: { visit: Visit; action: PlanAction }) {
  const navigate = useNavigate();
  const Icon = KIND_ICON[action.kind];
  const blocked = action.status === 'needs_provider';
  const scheduled = action.kind === 'revisit' || action.kind === 'test';
  const done = visit.done[action.id];

  return (
    <li>
      {/* 줄 전체를 누르면 원문이 열린다. 줄마다 "원문 보기"를 되풀이하지 않는다 */}
      <button className="item row-button" onClick={() => navigate(`/after/item/${action.id}`)}>
        <span className={`item-icon${blocked ? ' warn' : ''}`} aria-hidden>
          <Icon size={22} />
        </span>
        <span className="grow">
          <span className="item-title" style={{ display: 'block' }}>{action.title}</span>
          {action.when && formatWhen(action.when) && <span className="item-when" style={{ display: 'block' }}>{formatWhen(action.when)}</span>}
          {action.conditions.length > 0 && <span className="item-cond" style={{ display: 'block' }}>{action.conditions.join(' · ')}</span>}
          {action.missing && <span className="tag warn" style={{ marginTop: 8 }}>{action.missing}</span>}
        </span>
        <ChevronRight size={22} aria-label="원문 보기" style={{ alignSelf: 'center', flex: 'none', color: 'var(--ink-sub)' }} />
      </button>
      {!blocked && scheduled && reached(action.when?.date) && (
        <button
          className="choice"
          style={{ minHeight: 48, padding: '8px 0 8px 58px', border: 0, background: 'none' }}
          aria-pressed={!!done}
          onClick={() => mutate((v) => { v.done[action.id] = !v.done[action.id]; })}
        >
          <span className="check" aria-hidden>
            {done && <Check size={20} strokeWidth={3} />}
          </span>
          다녀왔어요
        </button>
      )}
    </li>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const navigate = useNavigate();
  const state =
    issue.state === 'resolved' ? '답변을 반영했어요' : issue.state === 'deferred' ? '나중에 확인하기로 했어요' : '아직 확인하지 않았어요';
  return (
    <li>
      <button className="item row-button" onClick={() => navigate(`/after/issue/${issue.id}`)}>
        <span className={`item-icon${issue.state === 'resolved' ? '' : ' warn'}`} aria-hidden>
          {issue.state === 'resolved' ? <Check size={22} /> : <HelpCircle size={22} />}
        </span>
        <span className="grow">
          <span className="item-title" style={{ display: 'block' }}>{issue.title}</span>
          <span className={`tag ${issue.state === 'resolved' ? 'ok' : 'warn'}`}>{state}</span>
        </span>
        <ChevronRight size={22} aria-hidden style={{ alignSelf: 'center' }} />
      </button>
    </li>
  );
}

export default function After() {
  const visit = useVisit()!;
  const navigate = useNavigate();

  const [viewing, setViewing] = useState<Source | null>(null);
  const { plan, analysis, sources } = visit;

  // 자료는 있는데 정리가 없으면 다시 정리한다 (다시 열었을 때 등)
  useEffect(() => {
    if (!plan && sources.length && analysis === 'idle') void runAnalysis();
  }, [plan, sources.length, analysis]);

  const settings = (
    <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="보관과 삭제">
      <Settings size={22} aria-hidden />
    </button>
  );

  if (!plan && !sources.length) {
    return (
      <Screen
        label="진료 후"
        title="진료가 끝나면 여기에 정리해요."
        tabs
        right={settings}
        footer={
          <button className="btn btn-primary btn-block" onClick={() => navigate('/after/add')}>
            <Plus size={22} aria-hidden />
            받은 안내문 추가
          </button>
        }
      >
        <p className="lead">진료 중 자막이나 받은 안내문에서 할 일을 찾아 드려요.</p>
      </Screen>
    );
  }

  const empty = plan && !plan.actions.length && !plan.infos.length && !plan.issues.length;
  const offline = !isMockMode && visit.traces[0]?.task === 'plan' && visit.traces[0].mode === 'rules' && analysis === 'idle';

  return (
    <Screen label="진료 후" title="오늘 진료 정리" tabs right={settings}>
      {plan && (
        <p className="lead">
          {plan.basedOn.length ? `${plan.basedOn.join(', ')}에서 찾았어요.` : '정리할 자료가 아직 없어요.'}
        </p>
      )}
      <p className="sub mt8">
        자동으로 정리했어요. 의료진이 확인한 내용은 아니에요.
        {visit.demo && ' 만든 예시예요.'}
      </p>

      <div className="stack mt16">
        {analysis === 'running' && (
          <div className="notice" role="status">
            <Loader2 size={22} className="spin" aria-hidden />
            <div className="grow">{plan ? '새 자료를 비교하고 있어요.' : '내용을 읽고 있어요.'}</div>
          </div>
        )}
        {analysis === 'failed' && (
          <Notice tone="error" title="정리를 마치지 못했어요.">
            추가한 자료는 남아 있어요.
            <button className="btn-text" onClick={() => void runAnalysis()}>
              다시 정리하기
            </button>
          </Notice>
        )}
        {plan?.flaggedSourceIds?.map((id) => (
          <Notice key={id} tone="warn" title={`${sources.find((s) => s.id === id)?.label ?? '자료'}에서는 할 일을 만들지 않았어요.`}>
            앱에 내리는 지시처럼 보이는 글이 있어요. 병원에서 받은 자료가 맞는지 확인해 주세요.
          </Notice>
        ))}
        {offline && (
          <Notice tone="warn" title="AI에 연결하지 못했어요.">
            기본 규칙으로만 정리했어요. 놓친 내용이 있을 수 있어요.
            <button className="btn-text" onClick={() => void runAnalysis()}>
              다시 정리하기
            </button>
          </Notice>
        )}
        {empty && <Notice>이 자료에서는 할 일을 찾지 못했어요. 안내문을 더 추가할 수 있어요.</Notice>}
      </div>

      {plan && <Prepared visit={visit} />}
      {plan && <CalendarPlanner visit={visit} />}

      {plan && plan.actions.length > 0 && (
        <section className="section" aria-labelledby="sec-todo">
          <div className="section-head">
            <h2 id="sec-todo" className="section-title">해야 할 일</h2>
            <span className="count">{plan.actions.length}개</span>
          </div>
          <ul className="list plain">
            {plan.actions.map((action) => (
              <ActionRow key={action.id} visit={visit} action={action} />
            ))}
          </ul>
        </section>
      )}

      {plan && plan.issues.some((issue) => issue.state !== 'resolved') && (
        <section className="section" aria-labelledby="sec-issue">
          <div className="section-head">
            <h2 id="sec-issue" className="section-title">확인할 내용</h2>
            <span className="count">{plan.issues.filter((issue) => issue.state !== 'resolved').length}개</span>
          </div>
          <ul className="list plain">
            {plan.issues.filter((issue) => issue.state !== 'resolved').map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
        </section>
      )}
      {plan && plan.issues.some((issue) => issue.state === 'resolved') && (
        <details className="folded">
          <summary>
            <Check size={20} aria-hidden />
            확인을 마친 내용 {plan.issues.filter((issue) => issue.state === 'resolved').length}개
            <ChevronRight size={20} aria-hidden className="folded-arrow" />
          </summary>
          <ul className="list plain">
            {plan.issues.filter((issue) => issue.state === 'resolved').map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
        </details>
      )}

      {plan && plan.infos.length > 0 && (
        <section className="section" aria-labelledby="sec-info">
          <h2 id="sec-info" className="section-title">안내받은 내용</h2>
          <ul className="list plain mt8">
            {plan.infos.map((info) => (
              <li key={info.id} className="item" style={{ flexDirection: 'column', gap: 8 }}>
                <p className="item-title">{info.text}</p>
                <p>
                  {info.bookable && visit.booking.state === 'confirmed' ? (
                    <span className="tag">진료 때 들은 말이에요</span>
                  ) : (
                    <span className={`tag ${info.certainty === 'contact' ? 'ok' : 'warn'}`}>{INFO_TAG[info.certainty]}</span>
                  )}
                </p>
                <button className="link" onClick={() => navigate(`/after/item/${info.id}`)}>
                  원문 보기
                  <ChevronRight size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section" aria-labelledby="sec-src">
        <div className="section-head">
          <h2 id="sec-src" className="section-title">모은 자료</h2>
          <span className="count">{sources.length}개</span>
        </div>
        <ul className="list plain">
          {sources.map((source) => (
            <li key={source.id}>
              <button className="item row-button" style={{ alignItems: 'center' }} onClick={() => setViewing(source)}>
                <span className="grow"><SourceTag source={source} /></span>
                <ChevronRight size={22} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <button className="btn btn-secondary btn-block mt16" onClick={() => navigate('/after/add')}>
          <Plus size={20} aria-hidden />
          자료 추가
        </button>
        <div className="btn-row mt8">
          <button className="link" onClick={() => navigate('/after/hospital')}>
            병원과 주고받은 내용
            <ChevronRight size={16} aria-hidden />
          </button>
          {visit.traces.length > 0 && (
            <button className="link" onClick={() => navigate('/trace')}>
              어떻게 정리했는지 보기
              <ChevronRight size={16} aria-hidden />
            </button>
          )}
        </div>
      </section>

      {plan && visit.storage === 'unset' && (
        <section className="section panel" aria-labelledby="sec-keep">
          <h2 id="sec-keep" className="item-title">이 기기에 {RETENTION_DAYS}일간 보관할까요?</h2>
          <p className="sub mt8">보관하면 내일 다시 열어 볼 수 있어요. 여럿이 쓰는 기기에서는 보관하지 않는 것이 좋아요.</p>
          <button className="btn btn-secondary btn-block mt16" onClick={() => setStorage('local')}>
            {RETENTION_DAYS}일간 보관
          </button>
          <button className="btn-text" onClick={() => setStorage('session')}>
            보관하지 않기
          </button>
        </section>
      )}
      {visit.storageFailed && (
        <div className="mt16">
          <Notice tone="error" title="이 기기에 저장하지 못했어요.">
            창을 닫으면 기록이 사라질 수 있어요.
            <button className="btn-text" onClick={() => setStorage('local')}>
              다시 저장
            </button>
          </Notice>
        </div>
      )}


      <Sheet open={!!viewing} title={viewing?.label ?? ''} onClose={() => setViewing(null)}>
        {viewing && (
          <div className="stack">
            <p className="quote">{viewing.text}</p>
            {!!viewing.gaps && <Notice tone="warn">자막이 멈춘 구간이 {viewing.gaps}곳 있어요.</Notice>}
            <button
              className="btn btn-danger btn-block"
              onClick={() => {
                removeSource(viewing.id);
                setViewing(null);
              }}
            >
              이 자료 지우기
            </button>
            <p className="hint">지우면 이 자료에서 찾은 할 일도 함께 빠져요.</p>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
