'use client';
import HelpTip from '@/components/help-tip';

import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { downloadText } from '@/lib/image-export';
import { requestLocalTextDraft, toEditableTextSystems, localTextDownload, localTextImageSupported, type LocalTextDraft, type EditableTextSystem } from '@/lib/local-text-ocr-client';

export default function LocalTextOcr({ file, width, height, busy, onBusyChange }: { file: File; width: number; height: number; busy: boolean; onBusyChange: (busy: boolean) => void }) {
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState<LocalTextDraft | null>(null);
  const [systems, setSystems] = useState<EditableTextSystem[]>([]);
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const imageSupported = localTextImageSupported(width, height);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; controllerRef.current?.abort(); onBusyChange(false); };
  }, [onBusyChange]);

  async function read() {
    if (busy || controllerRef.current || !imageSupported) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setReading(true); onBusyChange(true); setError('');
    try {
      const result = await requestLocalTextDraft(file, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (mountedRef.current) { setDraft(result); setSystems(toEditableTextSystems(result)); }
    } catch (reason) {
      if (mountedRef.current && (reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : '가사·코드를 읽지 못했습니다.');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (mountedRef.current) { setReading(false); onBusyChange(false); }
      }
    }
  }
  function update(index: number, field: 'lyrics' | 'chords', value: string) {
    setSystems(current => current.map((system, position) => position === index ? { ...system, [field]: value } : system));
  }
  function download() {
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || '악보';
    try { downloadText('\uFEFF' + localTextDownload(systems, draft?.warnings), `${name}_가사코드_초안.txt`); }
    catch { setError('TXT를 저장하지 못했습니다. 다시 시도해 주세요.'); }
  }

  return <section className="local-text-ocr" aria-label="무료로 가사·코드 글자 읽기">
    <button className="button outline full-width" disabled={busy || reading || !imageSupported} onClick={() => void read()}>
      {reading ? <Loader2 size={16} className="spin"/> : <FileText size={16}/>}
      {reading ? '가사·코드 글자를 읽고 있어요…' : '가사·코드 글자만 읽기 (무료)'}
    </button>
    {!imageSupported && <p className="local-text-error">기기 내 텍스트 읽기는 한 변 2,500픽셀·400만 화소 이하 이미지에서 사용할 수 있어요.</p>}
    <HelpTip helpKey="localTextRead" label="가사·코드 글자 읽기"/>
    <details className="local-text-notes"><summary>글자 읽기 안내</summary><p>가사·코드 글자만 읽는 초안입니다. 음표에 가사를 붙이거나 박자에 맞춰 코드를 배치하지는 않습니다.</p></details>
    {reading && <button className="text-button" onClick={() => controllerRef.current?.abort()}>읽기 취소</button>}
    {error && <p className="local-text-error" role="alert">{error}</p>}
    {draft && <div className="local-text-results">
      <div className="local-text-heading"><strong>읽은 가사·코드 글자</strong><span>{(draft.elapsedMs / 1000).toFixed(1)}초 · 무료</span></div>
      
      {draft.warnings.length > 0 && <details className="local-text-notes"><summary>원본과 확인할 내용 {draft.warnings.length}개</summary><ul className="local-text-warnings">{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {systems.length === 0 && <p className="local-text-hint">읽은 텍스트가 없습니다. 다른 이미지를 선택해 주세요.</p>}
      {systems.map((system, index) => <fieldset className="local-text-system" key={system.index}>
        <legend>{system.index}번째 줄</legend>
        <label>코드<textarea aria-label={`${system.index}번째 줄 코드 초안`} value={system.chords} disabled={reading} onChange={event => update(index, 'chords', event.target.value)} rows={Math.max(2, system.chords.split('\n').length)} spellCheck={false}/></label>
        <label>가사<textarea aria-label={`${system.index}번째 줄 가사 초안`} value={system.lyrics} disabled={reading} onChange={event => update(index, 'lyrics', event.target.value)} rows={Math.max(2, system.lyrics.split('\n').length)} spellCheck={false}/></label>
      </fieldset>)}
      <button className="button outline full-width" disabled={reading || systems.length === 0} onClick={download}><Download size={15}/>가사·코드 글자 저장 (TXT)</button>
    </div>}
  </section>;
}
