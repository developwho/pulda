import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, FileText, Loader2, NotebookPen } from 'lucide-react';
import { readImage } from '../agent';
import { DEMO_HANDOUT } from '../lib/demo';
import { isMockMode } from '../runtime';
import { addSource, addTrace, useVisit } from '../store/visit';
import { Notice, Screen } from '../ui';

const MAX_CHARS = 12000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 1800;
const KINDS = [
  { type: 'handout' as const, label: '병원에서 받은 안내문', icon: FileText },
  { type: 'patient_note' as const, label: '내가 적은 메모', icon: NotebookPen },
];

const PHOTO_ERROR = {
  UNSUPPORTED: '이 형식은 아직 읽을 수 없어요. JPG, PNG 사진을 골라 주세요.',
  TOO_LARGE: '사진이 너무 커요. 5MB보다 작은 사진을 골라 주세요.',
  UNREADABLE: '이 사진에서 글자를 읽기 어려워요. 밝은 곳에서 다시 찍거나 글로 적어 주세요.',
  NOT_VISIT_DOCUMENT: '병원 안내문이 아닌 것 같아요. 이번 진료 자료가 맞는지 확인해 주세요.',
  FAILED: '사진을 읽지 못했어요. 잠시 뒤 다시 하거나 글로 적어 주세요.',
};

/** 큰 사진을 줄여 보낸다. 글자를 읽기에 충분한 크기만 남긴다. */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

export default function AddSource() {
  const visit = useVisit()!;
  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<'handout' | 'patient_note'>('handout');
  const [text, setText] = useState(isMockMode ? DEMO_HANDOUT : '');
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<keyof typeof PHOTO_ERROR | null>(null);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const tooLong = text.length > MAX_CHARS;

  const onPick = async (file?: File) => {
    if (!file) return; // 고르기를 취소한 것은 오류가 아니다
    setError(null);
    setUnreadable([]);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError('UNSUPPORTED');
    if (file.size > MAX_FILE_BYTES) return setError('TOO_LARGE');
    setReading(true);
    try {
      const dataUrl = await toDataUrl(file);
      setPhoto(dataUrl);
      const { result, trace } = await readImage(dataUrl);
      addTrace(trace);
      if (result.ok) {
        setText(result.text);
        setUnreadable(result.unreadable);
      } else {
        setError(result.code);
      }
    } catch {
      setError('FAILED');
    } finally {
      setReading(false);
    }
  };

  const submit = () => {
    addSource(type, text);
    navigate('/after', { replace: true });
  };

  return (
    <Screen
      label="진료 후"
      title="어떤 자료인가요?"
      back
      footer={
        <button className="btn btn-primary btn-block" disabled={!text.trim() || tooLong || reading} onClick={submit}>
          이 자료 추가
        </button>
      }
    >
      <div className="stack-sm mt24" role="radiogroup" aria-label="자료 종류">
        {KINDS.map(({ type: kind, label, icon: Icon }) => (
          <button key={kind} className="choice" role="radio" aria-checked={type === kind} onClick={() => setType(kind)}>
            <Icon size={24} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {type === 'handout' && (
        <div className="stack mt24">
          <input
            ref={picker}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            onChange={(e) => {
              void onPick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button className="btn btn-secondary btn-block" disabled={reading} onClick={() => picker.current?.click()}>
            <Camera size={22} aria-hidden />
            {photo ? '다른 사진으로 바꾸기' : '안내문 사진 찍기'}
          </button>
          <p className="hint">이름처럼 필요 없는 부분은 빼고 찍어 주세요. 사진은 읽는 데만 쓰고 보관하지 않아요.</p>

          {photo && <img src={photo} alt="고른 안내문 사진" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line)' }} />}
          {reading && (
            <div className="notice" role="status">
              <Loader2 size={22} className="spin" aria-hidden />
              <div className="grow">사진의 글자를 읽는 중이에요.</div>
            </div>
          )}
          {error && <Notice tone="error">{PHOTO_ERROR[error]}</Notice>}
          {unreadable.length > 0 && (
            <Notice tone="warn" title="읽지 못한 부분이 있어요.">
              {unreadable.join(' · ')}
              <br />이 부분의 내용은 없는 것으로 보지 않아요. 필요하면 아래에 직접 적어 주세요.
            </Notice>
          )}
        </div>
      )}

      <div className="field mt24">
        <label htmlFor="src-text">
          {type === 'patient_note' ? '메모' : photo && text ? '사진에서 읽은 글 · 틀린 곳이 있으면 고쳐 주세요' : '안내문에 적힌 글'}
        </label>
        <textarea
          id="src-text"
          className="textarea"
          style={{ minHeight: 200 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="src-hint"
        />
        <p id="src-hint" className="hint">
          {type === 'handout'
            ? '날짜와 숫자가 사진과 같은지 확인해 주세요.'
            : '메모는 기록으로 남아요. 할 일로 바꾸지 않아요.'}
        </p>
      </div>
      {tooLong && (
        <div className="mt8">
          <Notice tone="error">글이 너무 길어요. {MAX_CHARS.toLocaleString()}자까지 넣을 수 있어요. 나눠서 추가해 주세요.</Notice>
        </div>
      )}

      {visit.demo && type === 'handout' && !photo && (
        <button className="btn btn-soft btn-block mt16" onClick={() => setText(DEMO_HANDOUT)}>
          예시 안내문 불러오기
        </button>
      )}
    </Screen>
  );
}
