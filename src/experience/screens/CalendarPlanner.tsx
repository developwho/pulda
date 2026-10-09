import { useEffect, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { calendarActions, makeCalendarTask, planFingerprint, schedulingBlock, type CalendarChoice, type CalendarTask } from '../agent/calendarPlan';
import { buildICS, downloadFile, shareCalendar } from '../agent/actions';
import { calendarConnected, connectGoogleCalendar, disconnectGoogleCalendar, googleCalendarAvailable, googleEventId, prepareGoogleCalendar, registerToGoogle, removeGoogleEvent } from '../agent/calendar';
import { todayISO, formatDate } from '../lib/time';
import type { Visit } from '../lib/types';
import { getVisit, mutate, recordExecution } from '../store/visit';
import { Notice, Sheet } from '../ui';
import { CALENDAR_ERROR } from './AgentSheets';

type Result = { actionId: string; title: string; ok: boolean; via: 'google' | 'file' | 'share'; message: string; link?: string };

export default function CalendarPlanner({ visit }: { visit: Visit }) {
  const [open, setOpen] = useState(false);
  return calendarActions(visit).length ? (
    <section className="prepared calendar-planner" aria-labelledby="calendar-plan-title">
      <h2 id="calendar-plan-title" className="section-title">내 캘린더까지 챙겨요</h2>
      <p className="sub">진료 기록에서 찾은 방문 일정과 복약 알림을 준비했어요. 내용을 확인하고 내 캘린더로 보내세요.</p>
      <button className="btn btn-primary btn-block mt16" disabled={visit.analysis === 'running'} onClick={() => setOpen(true)}><CalendarPlus size={20} aria-hidden />일정·알림 검토하기</button>
      {visit.executions.length > 0 && <p className="hint mt8">등록 기록은 검토 화면에서 볼 수 있어요. 새 자료가 생기면 다시 확인해요.</p>}
      {open && <PlannerSheet key={visit.id} visit={visit} onClose={() => setOpen(false)} />}
    </section>
  ) : null;
}

function PlannerSheet({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const actions = calendarActions(visit);
  const [choices, setChoices] = useState<Record<string, CalendarChoice>>(() => Object.fromEntries(actions.map(action => [action.id, visit.calendarChoices?.[action.id] ?? {
    selected: !schedulingBlock(action), date: todayISO(), times: [], alarm: 60,
  }])));
  const [connected, setConnected] = useState(calendarConnected);
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [step, setStep] = useState('');
  const fingerprint = planFingerprint(visit);
  useEffect(() => {
    if (googleCalendarAvailable) void prepareGoogleCalendar().then(() => setScriptReady(true)).catch(() => setError('Google 연결 화면을 불러오지 못했어요. 다시 열거나 파일로 받을 수 있어요.'));
  }, []);
  useEffect(() => { setConfirmed(false); }, [fingerprint]);
  const change = (id: string, patch: Partial<CalendarChoice>) => {
    setChoices(value => ({ ...value, [id]: { ...value[id], ...patch } }));
    setConfirmed(false); setError(''); setResults([]);
  };
  const tasks: CalendarTask[] = [];
  const problems: string[] = [];
  for (const action of actions) {
    const choice = choices[action.id];
    if (!choice?.selected || schedulingBlock(action)) continue;
    try { tasks.push(makeCalendarTask(visit, action, choice)); }
    catch (reason) { problems.push(`${action.title}: ${(reason as Error).message}`); }
  }
  const connect = async () => {
    setBusy(true); setError('');
    try { await connectGoogleCalendar(); setConnected(true); }
    catch { setError('Google 연결이 완료되지 않았어요. 다시 연결하거나 파일로 받을 수 있어요.'); }
    finally { setBusy(false); }
  };
  const run = async (via: 'google' | 'file' | 'share') => {
    const live = getVisit();
    if (!confirmed || !tasks.length || problems.length || !live || live.id !== visit.id || planFingerprint(live) !== fingerprint || live.analysis === 'running') {
      setError('자료나 선택 내용을 다시 확인해 주세요.'); return;
    }
    setBusy(true); setError(''); setResults([]);
    mutate(v => { v.calendarChoices = choices; });
    const outcomes: Result[] = [];
    try {
      if (via === 'google') await connectGoogleCalendar();
      else if (via === 'share') {
        const outcome = await shareCalendar(tasks.flatMap(task => task.events));
        if (outcome === 'cancelled') { setError('공유를 취소했어요. 필요할 때 다시 보내 주세요.'); return; }
        if (outcome === 'downloaded') via = 'file';
      }
      else if (!downloadFile('pulda-일정과-알림.ics', buildICS(tasks.flatMap(task => task.events)))) throw new Error('FILE_FAILED');
      for (const task of tasks) {
        const current = getVisit();
        if (!current || current.id !== visit.id || planFingerprint(current) !== fingerprint || current.analysis === 'running') {
          setError('진료 내용이 바뀌어 남은 등록을 멈췄어요. 이미 등록한 일정은 아래에서 확인해 주세요.'); break;
        }
        const title = actions.find(a => a.id === task.actionId)!.title;
        setStep(`${title} ${via === 'google' ? '등록·확인 중' : '파일 만드는 중'}`);
        const ids: string[] = [];
        let link: string | undefined;
        try {
          if (via === 'google') {
            const previous = [...new Set([...(current.calendarEventIds?.[task.actionId] ?? []), ...(current.executions.find(e => e.actionId === task.actionId && e.via === 'google')?.eventIds ?? [])])];
            for (const event of task.events) {
              const latest = getVisit();
              if (!latest || latest.id !== visit.id || latest.analysis === 'running' || planFingerprint(latest) !== fingerprint) throw new Error('STALE_PLAN');
              const intendedId = await googleEventId(event);
              mutate(v => { v.calendarEventIds ??= {}; v.calendarEventIds[task.actionId] = [...new Set([...(v.calendarEventIds[task.actionId] ?? []), intendedId])]; });
              const saved = await registerToGoogle(event);
              ids.push(saved.id); link ??= saved.link;
              if (getVisit()?.id === visit.id) mutate(v => { v.calendarEventIds ??= {}; v.calendarEventIds[task.actionId] = [...new Set([...(v.calendarEventIds[task.actionId] ?? []), saved.id])]; });
            }
            const latest = getVisit();
            if (!latest || latest.id !== visit.id || latest.analysis === 'running' || planFingerprint(latest) !== fingerprint) throw new Error('STALE_PLAN');
            for (const obsolete of previous.filter(id => !ids.includes(id))) await removeGoogleEvent(obsolete);
            if (getVisit()?.id === visit.id) mutate(v => { v.calendarEventIds ??= {}; v.calendarEventIds[task.actionId] = ids; });
          }
          if (getVisit()?.id === visit.id) recordExecution(task.kind, task.actionId, task.fingerprint, via, link, via === 'google' ? ids : undefined);
          outcomes.push({ actionId: task.actionId, title, ok: true, via, link, message: via === 'google' ? '날짜·반복·알림을 캘린더에서 다시 확인했어요.' : via === 'share' ? '일정 파일을 전달했어요. 선택한 앱에서 일정과 알림을 추가했는지 확인해 주세요.' : '일정 파일 다운로드를 요청했어요. 파일을 지원하는 캘린더에서 가져오기를 완료해 주세요.' });
        } catch (reason) {
          outcomes.push({ actionId: task.actionId, title, ok: false, via, link, message: `${CALENDAR_ERROR[(reason as Error).message] ?? '등록 결과를 확인하지 못했어요.'} 일부 일정이 저장되었을 수 있어요. 다시 시도해도 같은 일정을 확인·갱신해요.` });
        }
        setResults([...outcomes]);
      }
    } catch { setError(via !== 'google' ? '일정 파일을 전달하지 못했어요. 파일로 받기를 다시 시도해 주세요.' : 'Google 연결이 만료되었거나 취소됐어요. 다시 연결해 주세요.'); }
    finally { setBusy(false); setStep(''); setConnected(calendarConnected()); }
  };
  return (
    <Sheet open title="캘린더에 등록할 내용" dismissible={!busy} onClose={() => { if (!busy) onClose(); }}>
      <div className="stack">
        <p className="sub">휴대폰 공유 메뉴로 일정 파일을 보내세요. 공유를 지원하지 않으면 파일로 내려받아요. 전달 후 캘린더 앱에서 추가를 완료해 주세요.</p>
        <p className="hint">캘린더에는 아래 제목·날짜·시간·병원 위치만 보내요. 진단과 원문은 보내지 않아요. 모든 시간은 한국 시간이에요.</p>
        {googleCalendarAvailable ? <div className="row">
          <span className="grow">{connected ? 'Google 캘린더 연결됨' : 'Google 캘린더 연결 필요'}</span>
          <button className="btn btn-secondary" disabled={busy || !scriptReady} onClick={connected ? () => { disconnectGoogleCalendar(); setConnected(false); } : connect}>{connected ? '연결 해제' : 'Google 연결'}</button>
        </div> : <Notice>휴대폰으로 보내기는 Google 계정 연결 없이 사용할 수 있어요.</Notice>}
        {googleCalendarAvailable && <p className="hint">Google 연결 시 기본 캘린더에 직접 등록할 수 있어요. 같은 일정은 갱신하고 줄어든 복약 알림은 정리해요.</p>}
        {actions.map(action => {
          const blocked = schedulingBlock(action);
          const choice = choices[action.id];
          if (!choice) return null;
          const medication = action.kind === 'medication';
          const prior = visit.executions.find(e => e.actionId === action.id);
          const currentTask = tasks.find(t => t.actionId === action.id);
          return <section className="panel stack" key={action.id}>
            <label className="calendar-choice"><input type="checkbox" checked={choice.selected && !blocked} disabled={busy || !!blocked} onChange={e => change(action.id, { selected: e.target.checked })} /><strong>{medication ? '약 먹을 시간 알림' : action.title}</strong></label>
            <p className="sub">{action.conditions.join(' · ')}</p>
            {blocked ? <Notice tone="warn">{blocked}</Notice> : medication ? <>
              <div className="field"><label htmlFor={`start-${action.id}`}>알림 시작일</label><input className="input" type="date" id={`start-${action.id}`} min={todayISO()} value={choice.date} disabled={busy} onChange={e => change(action.id, { date: e.target.value })} /></div>
              <p>하루 {action.med!.perDay}번 · {action.med!.days}일 동안 반복</p>
              <p className="hint">원문에 적힌 식전·식후 조건에 맞춰 시간을 정해 주세요. 시작일은 복용 지시를 바꾸지 않아요.</p>
              {Array.from({ length: action.med!.perDay! }, (_, index) => <div className="field" key={index}><label htmlFor={`time-${action.id}-${index}`}>{index + 1}번째 알림</label><input className="input" id={`time-${action.id}-${index}`} type="time" disabled={busy} value={choice.times[index] ?? ''} onChange={e => { const times = Array.from({ length: action.med!.perDay! }, (_, i) => choice.times[i] ?? ''); times[index] = e.target.value; change(action.id, { times }); }} /></div>)}
              <p className="hint">제목: 약 먹을 시간 · 정한 시각에 알림</p>
            </> : <>
              <p className="big-value">{formatDate(action.when!.date!)} {action.when!.time}</p>
              <p className="hint">제목: {action.kind === 'revisit' ? '병원 진료' : action.title}{visit.appointment.hospital ? ` · 위치: ${visit.appointment.hospital}` : ''}</p>
              <div className="field"><label htmlFor={`alarm-${action.id}`}>미리 알림</label><select className="input" id={`alarm-${action.id}`} disabled={busy} value={choice.alarm} onChange={e => change(action.id, { alarm: Number(e.target.value) })}>{[[0,'시작할 때'],[30,'30분 전'],[60,'1시간 전'],[1440,'하루 전']].map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            </>}
            <details><summary>근거 원문 확인</summary>{action.evidence.map((e,i) => <blockquote key={i} className="quote mt8">{e.quote}</blockquote>)}</details>
            {prior && <p className="hint">{prior.via === 'google' ? 'Google 등록 기록 있음' : prior.via === 'share' ? '파일 전달 기록 있음 · 앱에서 추가 여부를 확인해 주세요.' : '파일 생성 기록 있음'}{currentTask && prior.payloadKey !== currentTask.fingerprint ? ' · 내용이 달라 다시 검토해야 해요.' : ''}</p>}
            {prior?.link && <a className="link" target="_blank" rel="noreferrer" href={prior.link}>등록한 일정 보기</a>}
          </section>;
        })}
        {problems.map(problem => <p className="hint" key={problem}>{problem}</p>)}
        <label className="calendar-choice"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />시작일·시간·반복 기간과 캘린더에 보낼 내용을 확인했어요.</label>
        {error && <Notice tone="error">{error}</Notice>}
        {busy && <p role="status"><Loader2 size={20} className="spin" aria-hidden />{step || '연결 확인 중'}</p>}
        {results.map(result => <Notice key={result.actionId} tone={result.ok ? 'ok' : 'error'} title={`${result.title} · ${result.ok ? result.via === 'google' ? '등록 확인' : result.via === 'share' ? '파일 전달' : '파일 생성' : '확인 필요'}`}>{result.message}{result.link && <a className="link" href={result.link} target="_blank" rel="noreferrer">캘린더에서 보기</a>}</Notice>)}
        <button className="btn btn-primary btn-block" disabled={busy || !confirmed || !tasks.length || !!problems.length || visit.analysis === 'running'} onClick={() => void run('share')}>휴대폰 캘린더로 보내기</button>
        {googleCalendarAvailable && <button className="btn btn-secondary btn-block" disabled={busy || !connected || !confirmed || !tasks.length || !!problems.length || visit.analysis === 'running'} onClick={() => void run('google')}>승인하고 캘린더에 등록하기</button>}
        <button className="btn btn-secondary btn-block" disabled={busy || !confirmed || !tasks.length || !!problems.length || visit.analysis === 'running'} onClick={() => void run('file')}>선택한 일정 파일로 받기</button>
        <p className="hint">캘린더 앱마다 일정 파일·반복·알림 지원이 달라요. 휴대폰의 캘린더 알림 권한도 확인해 주세요. 파일을 여러 번 추가하면 일정이 중복될 수 있어요.</p>
      </div>
    </Sheet>
  );
}
