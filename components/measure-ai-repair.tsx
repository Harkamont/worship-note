'use client';

import { useEffect, useRef, useState } from 'react';
import { cropSourceImage, type NormalizedSourceRegion, type SourceImageCrop } from '@/lib/measure-crop';
import { repairMusicXMLMeasures } from '@/lib/musicxml-client';
import type { MusicXMLRepairSelection } from '@/lib/musicxml-measure-repair';
import { normalizeImageDataURL } from '@/lib/review-workspace';
import { downloadText } from '@/lib/image-export';
import type { MusicXMLRecognitionResult } from '@/lib/recognition';
import { SourceRegionPicker } from '@/components/source-region-picker.tsx';
import MusicXMLPreview from '@/components/musicxml-preview.tsx';
import { HelpTip } from '@/components/help-tip';

export type MeasureAIRepairProps = {
  source: MusicXMLRecognitionResult;
  applied?: MusicXMLRecognitionResult | null;
  originalUrl: string;
  originalFile?: File | null;
  configured: boolean;
  onApply: (result: MusicXMLRecognitionResult) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
};
type Prepared = { crop: SourceImageCrop; preview: string; xml: string; originalUrl: string; key: string };
type Candidate = { result: Awaited<ReturnType<typeof repairMusicXMLMeasures>>; xml: string; originalUrl: string };

function previewDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('선택 영역 미리 보기를 만들지 못했습니다.'));
    reader.onerror = () => reject(new Error('선택 영역 미리 보기를 만들지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

export default function MeasureAIRepair({ source, applied, originalUrl, originalFile, configured, onApply, disabled = false, onBusyChange }: MeasureAIRepairProps) {
  const base = applied ?? source;
  const xml = base.document.xml;
  const [selectionState, setSelectionState] = useState<{ xml: string; value: MusicXMLRepairSelection } | null>(null);
  const fallbackPart = base.document.parts[0];
  const selection = selectionState?.xml === xml ? selectionState.value : { partId: fallbackPart?.id ?? '', startMeasure: 1, endMeasure: 1 };
  const part = base.document.parts.find(item => item.id === selection.partId);
  const [regionState, setRegionState] = useState<{ originalUrl: string; value: NormalizedSourceRegion | null } | null>(null);
  const region = regionState?.originalUrl === originalUrl ? regionState.value : null;
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState<'crop' | 'ai' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [enlargeSmall, setEnlargeSmall] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); busyCallback.current?.(false); }; }, []);
  useEffect(() => { controller.current?.abort(); }, [xml, originalUrl]);
  const key = JSON.stringify([selection, region, enlargeSmall]);
  const preview = prepared?.xml === xml && prepared.originalUrl === originalUrl && prepared.key === key ? prepared : null;
  const freshCandidate = candidate?.xml === xml && candidate.originalUrl === originalUrl ? candidate : null;
  const locked = disabled || busy !== null;
  const validSelection = Boolean(part && selection.startMeasure >= 1 && selection.endMeasure >= selection.startMeasure && selection.endMeasure <= part.measures.length && selection.endMeasure - selection.startMeasure < 4);

  function resetDrafts() { setPrepared(null); setCandidate(null); setError(''); setNotice(''); }
  function changeSelection(value: MusicXMLRepairSelection) { setSelectionState({ xml, value }); resetDrafts(); }
  function finish(request: AbortController) {
    if (controller.current === request) controller.current = null;
    if (alive.current) { setBusy(null); busyCallback.current?.(false); }
  }
  async function prepare() {
    if (locked || controller.current || !region || !validSelection) return;
    const request = new AbortController(); controller.current = request;
    setBusy('crop'); busyCallback.current?.(true); resetDrafts();
    try {
      let file = originalFile;
      if (!file) {
        const dataURL = normalizeImageDataURL(originalUrl);
        if (!dataURL) throw new Error('원본 이미지 파일을 다시 올려 주세요.');
        const blob = await (await fetch(dataURL, { signal: request.signal })).blob();
        file = new File([blob], blob.type === 'image/jpeg' ? 'original.jpg' : 'original.png', { type: blob.type });
      }
      request.signal.throwIfAborted();
      const crop = await cropSourceImage(file, region, { enlargeSmall });
      request.signal.throwIfAborted();
      const data = await previewDataURL(crop.file);
      request.signal.throwIfAborted();
      if (alive.current) setPrepared({ crop, preview: data, xml, originalUrl, key });
    } catch (cause) {
      if (alive.current && !request.signal.aborted) setError(cause instanceof Error ? cause.message : '원본 일부를 자르지 못했습니다.');
    } finally { finish(request); }
  }
  async function repair() {
    if (locked || controller.current || !configured || !preview || !validSelection) return;
    const request = new AbortController(); controller.current = request;
    setBusy('ai'); busyCallback.current?.(true); setCandidate(null); setError(''); setNotice('');
    try {
      const result = await repairMusicXMLMeasures(preview.crop.file, xml, selection, { signal: request.signal });
      request.signal.throwIfAborted();
      if (alive.current) setCandidate({ result, xml, originalUrl });
    } catch (cause) {
      if (alive.current) {
        if (request.signal.aborted) setNotice('요청을 취소했습니다. 취소 전에 사용한 AI 요금은 서비스에서 확인해 주세요.');
        else setError((cause instanceof Error ? cause.message : '선택 마디를 다시 읽지 못했습니다.') + ' 실패한 AI 요청도 사용료가 발생할 수 있습니다. 자동으로 다시 요청하지 않습니다.');
      }
    } finally { finish(request); }
  }

  if (!originalUrl) return <section aria-label="잘못 읽은 마디만 AI로 수정"><h4>잘못 읽은 마디만 AI로 수정</h4><p className="text-sm text-muted-foreground">원본 이미지가 있어야 마디를 보완할 수 있습니다. PNG 또는 JPG 악보를 올려 주세요.</p></section>;
  const result = freshCandidate?.result;
  const remainingErrors = result?.document.issues.filter(issue => issue.severity === 'error').length ?? 0;
  return <section className="measure-ai-repair" aria-label="잘못 읽은 마디만 AI로 수정">
    <div className="help-heading"><h4 className="font-semibold">잘못 읽은 마디만 AI로 수정</h4><HelpTip helpKey="measureRepair"/></div>
    {applied && <details className="rounded border p-3"><summary>현재 적용한 마디 수정안 · {applied.cost === undefined ? '사용료 정보 없음' : `인식·적용 요청 합계 $${applied.cost.toFixed(6)}`}</summary><div className="help-heading"><span>적용한 수정안 기준</span><HelpTip helpKey="repairHistoryCost"/></div><MusicXMLPreview xml={applied.document.xml}/><button type="button" className="button outline" onClick={() => downloadText(applied.document.xml, '현재_마디수정안.musicxml', 'application/vnd.recordare.musicxml+xml')}>현재 수정안 파일 (XML)</button></details>}
    <fieldset disabled={locked} className="flex flex-wrap gap-3">
      <legend className="sr-only">수정할 파트와 마디</legend>
      <label className="text-sm">파트<select aria-label="수정할 파트" className="ml-2 rounded border bg-background p-1.5" value={selection.partId} onChange={event => changeSelection({ partId: event.currentTarget.value, startMeasure: 1, endMeasure: 1 })}>{base.document.parts.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}</select></label>
      <label className="text-sm">시작 마디<select aria-label="처음 수정할 마디" className="ml-2 rounded border bg-background p-1.5" value={selection.startMeasure} onChange={event => { const start = Number(event.currentTarget.value); changeSelection({ ...selection, startMeasure: start, endMeasure: start }); }}>{part?.measures.map((measure, index) => <option key={index} value={index + 1}>{index + 1}번째 · 표기 {measure.number}마디</option>)}</select></label>
      <label className="text-sm">끝 마디<select aria-label="마지막 수정할 마디" className="ml-2 rounded border bg-background p-1.5" value={selection.endMeasure} onChange={event => changeSelection({ ...selection, endMeasure: Number(event.currentTarget.value) })}>{part?.measures.slice(selection.startMeasure - 1, selection.startMeasure + 3).map((measure, index) => <option key={index} value={selection.startMeasure + index}>{selection.startMeasure + index}번째 · 표기 {measure.number}마디</option>)}</select></label>
    </fieldset>
    <SourceRegionPicker sourceUrl={originalUrl} value={region} onChange={value => { setRegionState({ originalUrl, value }); resetDrafts(); }} disabled={locked}/>
    <div className="help-heading"><label className="measure-ai-enlarge"><input type="checkbox" checked={enlargeSmall} disabled={locked} onChange={event => { setEnlargeSmall(event.currentTarget.checked); resetDrafts(); }}/>작은 마디는 4배 확대해서 보내기</label><HelpTip helpKey="measureRepairImage"/></div>
    <button type="button" className="button outline" disabled={locked || !region || !validSelection} onClick={() => void prepare()}>선택 영역 미리 보기 (무료)</button>
    {preview && <div className="measure-ai-crop-preview"><div className="help-heading"><h5>AI에 보낼 이미지</h5><HelpTip helpKey="measureRepairImage"/></div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview.preview} alt="AI에 보낼 원본 일부" className="h-auto max-w-full border bg-white"/><details><summary>이미지 정보{preview.crop.scale === 4 ? ' · 4배 확대' : ''}</summary><p className="text-sm">{preview.crop.width} × {preview.crop.height}px · {(preview.crop.file.size / 1024).toFixed(0)}KB · 원본 면적의 {((region?.width ?? 0) * (region?.height ?? 0) * 100).toFixed(1)}%</p></details></div>}
    <div className="measure-ai-actions"><button type="button" className="button primary" disabled={locked || !configured || !preview || !validSelection} onClick={() => void repair()}>선택한 마디만 AI로 다시 읽기 (유료)</button>{busy && <><span role="status" className="text-sm">{busy === 'crop' ? '이 기기에서 선택 영역을 자르고 있어요…' : 'AI가 선택한 마디를 다시 읽고 있어요 (유료)…'}</span><button type="button" className="button outline" onClick={() => controller.current?.abort()}>취소</button></>}</div>
    {!configured && <p className="text-sm text-muted-foreground">유료 마디 수정을 사용하려면 AI 연결 설정이 필요합니다.</p>}
    {error && <p role="alert" className="local-text-error">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {candidate && !freshCandidate && <p role="status" className="text-sm">기준 악보나 원본 이미지가 바뀌었습니다. 이전 수정안은 적용할 수 없습니다.</p>}
    {result && <div className="measure-ai-candidate"><h5 className="font-semibold">수정안 · 적용 전 확인</h5><p className="text-sm">수정한 마디: {result.repair.changedMeasureNumbers.join(', ')} · 이번 요청 {result.cost === undefined ? '사용료 정보 없음' : `AI 사용료 $${result.cost.toFixed(6)}`} · {(result.elapsedMs / 1000).toFixed(1)}초</p>
      {remainingErrors > 0 && <p className="local-text-error">확인할 오류가 {remainingErrors}개 남아 있습니다.</p>}
      <p className="text-sm">적용하면 현재 편집 중인 악보를 이 수정안으로 교체합니다.</p>
      <MusicXMLPreview xml={result.document.xml}/>
      <div className="flex flex-wrap gap-2"><button type="button" className="button outline" onClick={() => downloadText(result.document.xml, `${(result.document.title || '악보').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)}_마디수정안.musicxml`, 'application/vnd.recordare.musicxml+xml')}>수정안 파일 (XML)</button><button type="button" className="button primary" disabled={locked || !result.score || candidate?.xml !== xml || candidate.originalUrl !== originalUrl} onClick={() => { if (freshCandidate && freshCandidate.xml === xml && freshCandidate.originalUrl === originalUrl && result.score) onApply(result); }}>수정안 적용하고 편집하기</button><button type="button" className="button outline" disabled={locked} onClick={() => setCandidate(null)}>수정안 닫기</button></div>
      {result.editorIssue && <p className="text-sm text-muted-foreground">이 앱이 지원하지 않는 항목: {result.editorIssue} 수정안 파일은 내려받을 수 있습니다.</p>}
    </div>}
  </section>;
}
