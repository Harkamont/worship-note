'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Loader2, Music2, Sparkles, X } from 'lucide-react';
import { recognizeMusicXML, recognizeHybridMusicXML, recognizeOMRMusicXML, MusicXMLHybridError } from '@/lib/musicxml-client';
import { createCompatibleMusicXML } from '@/lib/musicxml-compatible.ts';
import MusicXMLPreview from '@/components/musicxml-preview.tsx';
import MelodyExtractor from '@/components/melody-extractor.tsx';
import MeasureAIRepair from '@/components/measure-ai-repair.tsx';
import LocalTextOcr from '@/components/local-text-ocr.tsx';
import { reviewExtractedMelody } from '@/lib/musicxml-melody-client.ts';
import { createReviewBusyState, type ReviewActivity } from '@/lib/review-busy.ts';
import { downloadText } from '@/lib/image-export';
import type { MusicXMLRecognitionResult } from '@/lib/recognition';
import { HelpTip } from '@/components/help-tip';
import { emptyReviewMelody, restoreMeasureRepair, type ReviewMelody, type ReviewWorkspace } from '@/lib/review-workspace.ts';

type Props = {
  file?: File | null;
  sourceName?: string;
  melody?: ReviewMelody;
  onMelodyChange?: (melody: ReviewMelody) => void;
  onDownloadProject?: () => void;
  originalUrl: string;
  configured: boolean;
  aiConfigured?: boolean;
  reviewWorkspace?: ReviewWorkspace;
  localTextInput?: { width: number; height: number };
  onMeasureRepairApply?: (result: MusicXMLRecognitionResult) => void;
  model: string;
  mode?: 'direct' | 'hybrid' | 'local';
  label?: string;
  result: MusicXMLRecognitionResult | null;
  onResult: (result: MusicXMLRecognitionResult) => void;
  onImport: (result: MusicXMLRecognitionResult) => void;
  onBusyChange: (busy: boolean) => void;
};


export default function DirectMusicXML({ file, sourceName, melody, onMelodyChange, onDownloadProject, originalUrl, configured, aiConfigured, reviewWorkspace, localTextInput, onMeasureRepairApply, model, result, onResult, onImport, onBusyChange, mode = 'direct', label }: Props) {
  const inputName = sourceName || file?.name || '불러온 악보';
  const [localMelody, setLocalMelody] = useState<{ sourceXML: string; melody: ReviewMelody } | null>(null);
  const activeMelody = melody ?? (localMelody?.sourceXML === result?.document.xml ? localMelody?.melody : null) ?? emptyReviewMelody();
  function updateMelody(next: ReviewMelody) {
    if (onMelodyChange) onMelodyChange(next);
    else setLocalMelody({ sourceXML: result?.document.xml ?? '', melody: next });
  }
  const [busy, setBusy] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busyCallback = useRef(onBusyChange);
  const activity = useMemo(() => createReviewBusyState(), []);
  const anyBusy = busy || repairBusy || textBusy;
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  const handleActivity = useCallback((source: ReviewActivity, next: boolean) => {
    if (mounted.current) busyCallback.current(activity.update(source, next));
  }, [activity]);
  const handleRepairBusy = useCallback((next: boolean) => { if (mounted.current) { setRepairBusy(next); handleActivity('repair', next); } }, [handleActivity]);
  const handleTextBusy = useCallback((next: boolean) => { if (mounted.current) { setTextBusy(next); handleActivity('text', next); } }, [handleActivity]);
  const currentWorkspace = result && reviewWorkspace?.sourceXML === result.document.xml && reviewWorkspace.mode === mode
    && (reviewWorkspace.sourceImage ?? '') === originalUrl && reviewWorkspace.melody.xml === activeMelody.xml ? reviewWorkspace : null;
  const repairReview = useMemo(() => {
    if (!result) return { source: null, applied: null, error: '' };
    try {
      const source = activeMelody.xml ? reviewExtractedMelody(result, { xml: activeMelody.xml, warnings: activeMelody.warnings }, { reviewDraft: true }) : result;
      return { source, applied: currentWorkspace ? restoreMeasureRepair(currentWorkspace) : null, error: '' };
    } catch (cause) { return { source: null, applied: null, error: cause instanceof Error ? cause.message : '마디 수정에 사용할 악보를 확인하지 못했습니다.' }; }
  }, [result, activeMelody.xml, activeMelody.warnings, currentWorkspace]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stage, setStage] = useState<'omr' | 'annotations' | 'direct'>(mode === 'hybrid' ? 'omr' : 'direct');
  const localFile = result?.provider === 'local-file';
  const draftOnly = mode === 'hybrid' && result?.provider === 'local-omr';
  const operationLabel = localFile ? '악보 파일 확인' : mode === 'local' ? '무료 · 이 기기에서 음표 읽기' : mode === 'hybrid' ? 'AI로 가사·코드 추가 (유료)' : 'AI로 악보 전체 읽기 (유료)';
  const costLabel = localFile ? '파일 읽기 무료 · AI 요청 없음' : draftOnly ? '음표 읽기 무료 · AI 사용료는 별도 확인' : result?.provider === 'local-omr' ? '무료 · 이 기기에서 처리' : result ? result.cost === undefined ? 'AI 사용료 정보 없음' : `AI 사용료 $${result.cost.toFixed(6)}` : mode === 'local' ? '무료 · AI 연결 없이 사용' : '유료 · 사용량에 따라 별도 청구';
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); activity.clear(); busyCallback.current(false); };
  }, [activity]);

  async function convert() {
    if (controller.current || activity.isBusy() || result || !configured || !file) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); handleActivity('conversion', true); setError(''); setNotice('');
    setStage(mode === 'hybrid' ? 'omr' : 'direct');
    try {
      const output = mode === 'local' ? await recognizeOMRMusicXML(file, { signal: request.signal }) : mode === 'hybrid' ? await recognizeHybridMusicXML(file, { signal: request.signal, onDraft: draft => {
        if (mounted.current) { onResult(draft); setStage('annotations'); }
      } }) : await recognizeMusicXML(file, { signal: request.signal });
      request.signal.throwIfAborted();
      if (mounted.current) onResult(output);
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof MusicXMLHybridError) {
        onResult(cause.draft);
        if (request.signal.aborted) setNotice('가사·코드 추가를 취소했습니다. 먼저 읽은 음표는 아래에서 확인하거나 저장할 수 있습니다. 취소 전에 사용한 AI 요금은 서비스에서 확인해 주세요.');
        else { setError(cause.message); setNotice('가사·코드 추가는 완료되지 않았습니다. 먼저 읽은 음표는 보관했고 자동으로 다시 요청하지 않습니다. 실패한 AI 요청도 요금이 발생할 수 있으며, 사용료 정보가 제공되지 않을 수 있습니다.'); }
      } else if (request.signal.aborted) setNotice(mode === 'local' ? '음표 읽기를 취소했습니다. 필요하면 다시 시작해 주세요.' : 'AI 악보 읽기를 취소했습니다. 취소 전에 사용한 AI 요금은 해당 서비스에서 확인해 주세요.');
      else setError(cause instanceof Error ? cause.message : '악보 읽기를 완료하지 못했습니다.');
    } finally {
      if (controller.current === request) controller.current = null;
      if (mounted.current) { setBusy(false); handleActivity('conversion', false); }
    }
  }

  const name = (result?.document.title || inputName.replace(/\.[^.]+$/, '') || '찬양악보').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
  function download(type: 'xml' | 'compatible' | 'txt') {
    if (!result) return;
    if (type === 'xml') downloadText(result.document.xml, `${name}_원본.musicxml`, 'application/vnd.recordare.musicxml+xml');
    if (type === 'compatible') {
      try { downloadText(createCompatibleMusicXML(result.document.xml), `${name}_호환.musicxml`, 'application/vnd.recordare.musicxml+xml'); }
      catch { setError('다른 악보 앱용 파일을 만들지 못했습니다. 인식 결과 원본 파일은 계속 저장할 수 있습니다.'); }
    }
    if (type === 'txt') downloadText('\uFEFF' + result.document.lyricsText, `${name}_원본가사.txt`);
  }

  return <section className="direct-musicxml" aria-label={label || '원본과 인식 결과 비교'}>
    <div className="direct-musicxml-intro"><div><div className="help-heading"><span className="eyebrow">{operationLabel}</span><HelpTip helpKey={localFile ? 'originalReview' : mode === 'local' ? 'localRead' : 'aiRead'}/></div><h3>{result?.document.title || inputName}</h3></div><div className="direct-musicxml-model"><Sparkles size={16}/><span>{costLabel}{result && <small>{(result.elapsedMs / 1000).toFixed(1)}초{draftOnly ? ' · 음표 읽기만 완료' : ''}</small>}</span></div></div>
    {result && !localFile && result.provider !== 'local-omr' && result.cost === undefined && <p className="direct-musicxml-caution">사용료를 확인하지 못했습니다. 실제 청구액은 AI 서비스에서 확인해 주세요.</p>}
    {(!result || busy) && <div className="direct-musicxml-start">{busy ? <><span role="status"><Loader2 size={17} className="spin"/>{stage === 'omr' ? '1/2 · 이 기기에서 음표를 읽고 있어요…' : stage === 'annotations' ? '2/2 · AI가 가사·코드를 추가하고 있어요 (유료)…' : mode === 'local' ? '이 기기에서 음표를 읽고 있어요…' : 'AI가 악보 전체를 읽고 있어요 (유료)…'}</span><button className="button outline" onClick={() => controller.current?.abort()}><X size={15}/>읽기 취소</button></> : <button className="button primary" disabled={anyBusy || !configured || !file} onClick={() => void convert()}><Sparkles size={16}/>{operationLabel}</button>}</div>}
    {error && <p className="local-text-error" role="alert">{error}</p>}{notice && <p className="direct-musicxml-status" role="status">{notice}</p>}
    {result && <><div className="direct-musicxml-summary"><span>{result.document.measureCount}마디</span><span>음표·쉼표 {result.document.noteCount}개</span><span>코드 {result.document.chordCount}개</span>{result.score && <button className="button primary" disabled={anyBusy} onClick={() => { if (!activity.isBusy()) onImport(result); }}><Music2 size={16}/>이 악보 편집하기</button>}</div>{result.score && <p className="direct-musicxml-status">가져오면 현재 편집 중인 악보를 교체합니다.</p>}{draftOnly && <p className="direct-musicxml-caution">음표 읽기만 완료했습니다. AI 가사·코드 추가는 완료되지 않았습니다.</p>}</>}
    {file && mode === 'local' && localTextInput && <details className="direct-musicxml-lyrics"><summary><FileText size={16}/>가사·코드 글자 읽기 (무료)</summary><p>가사·코드 글자를 읽고 고쳐서 TXT로 저장합니다. 편집 악보의 음표에 가사를 붙이거나 코드 위치를 맞추는 기능은 아닙니다.</p><LocalTextOcr file={file} width={localTextInput.width} height={localTextInput.height} busy={anyBusy} onBusyChange={handleTextBusy}/></details>}
    <div className={`direct-musicxml-comparison ${result ? 'has-result' : ''} ${originalUrl ? 'has-original' : ''}`}><section><h4>{originalUrl ? '원본 악보' : '원본 이미지 없음'}</h4><div className={`direct-musicxml-original ${originalUrl ? '' : 'is-empty'}`}>{originalUrl ? <img src={originalUrl} alt={`${inputName} 원본 악보`}/> : <p>악보 파일만 불러왔습니다.<br/>비교할 원본 이미지는 포함되어 있지 않습니다.</p>}</div></section>{result && <section><h4>{localFile ? '불러온 악보' : '인식 결과'}</h4><MusicXMLPreview xml={result.document.xml}/></section>}</div>
    {result && <MelodyExtractor source={result} melody={activeMelody} onMelodyChange={updateMelody} disabled={anyBusy} onImport={onImport}/>}
    {repairReview.error && <p className="local-text-error" role="alert">{repairReview.error}</p>}
    {currentWorkspace?.measureRepair && currentWorkspace.measureRepair.receipts.length >= 32 && <p className="direct-musicxml-caution">이 작업의 AI 보완 횟수(32회)를 모두 사용했습니다. 수정안과 작업 파일을 저장해 주세요.</p>}
    {currentWorkspace?.editorChanged && <p className="direct-musicxml-caution">직접 편집한 내용을 보호하기 위해 AI 보완을 잠시 막았습니다. 작업 파일을 저장한 뒤, 원래 인식 결과를 다시 가져오면 사용할 수 있습니다.</p>}
    {repairReview.source && <MeasureAIRepair key={mode + (activeMelody.xml ? "-melody" : "-source")} source={repairReview.source} applied={repairReview.applied} originalUrl={originalUrl} originalFile={file} configured={aiConfigured ?? configured} onApply={onMeasureRepairApply ?? onImport} disabled={busy || textBusy || Boolean(currentWorkspace?.editorChanged) || (currentWorkspace?.measureRepair?.receipts.length ?? 0) >= 32} onBusyChange={handleRepairBusy}/>}
    {result && <><details className="direct-musicxml-issues"><summary>확인할 내용 자세히 보기 · {result.document.issues.length}개</summary>{result.document.issues.length ? <ul>{result.document.issues.map((issue, index) => <li key={index} className={issue.severity === 'error' ? 'is-error' : ''}><strong>{issue.severity === 'error' ? '오류' : '확인'}</strong><span>{issue.partId ? `${issue.partId} · ` : ''}{issue.measure ? `${issue.measure}마디 · ` : ''}{issue.message}</span></li>)}</ul> : <p>자동 검사에서 별도 문제가 발견되지 않았습니다. 원본과의 일치 여부는 직접 확인해 주세요.</p>}</details><details className="direct-musicxml-lyrics"><summary><FileText size={16}/>읽은 가사 미리 보기</summary><div className="help-heading"><span>악보에 적힌 순서</span><HelpTip helpKey="sourceLyrics"/></div><textarea aria-label="악보에서 읽은 가사" readOnly value={result.document.lyricsText || '이 악보 파일에는 읽을 수 있는 가사가 없습니다.'}/></details><div className="direct-musicxml-downloads"><button className="button outline" onClick={() => download('xml')}><Download size={16}/>인식 결과 원본 파일 (XML)</button><button className="button outline" onClick={() => download('compatible')}><Download size={16}/>다른 악보 앱용 파일 (XML)</button><button className="button outline" disabled={!result.document.lyricsText} onClick={() => download('txt')}><FileText size={16}/>가사 파일 (TXT)</button>{onDownloadProject && <><button className="button outline" onClick={onDownloadProject}><Download size={16}/>현재 편집 작업 보관 (JSON)</button><HelpTip helpKey="projectBackup"/></>}</div><div className="direct-musicxml-import"><div><div className="help-heading"><strong>이 악보 편집하기</strong><HelpTip helpKey="originalReview"/></div><p>{result.editorIssue ? '아직 이 앱에서 편집할 수 없는 항목이 있습니다. XML 파일로 저장할 수 있습니다.' : '가져오면 현재 편집 중인 악보를 교체합니다.'}</p>{result.editorIssue && <details><summary>편집할 수 없는 항목 자세히 보기</summary><pre className="direct-musicxml-editor-details">{result.editorIssue}</pre></details>}</div><button className="button primary" disabled={anyBusy || !result.score} onClick={() => { if (!activity.isBusy()) onImport(result); }}><Music2 size={16}/>편집기로 가져오기</button></div></>}
    {result && <details className="direct-musicxml-lyrics"><summary>파일·인식 정보 자세히 보기</summary><p>원본 파일: {inputName}</p><p>인식 모델: {result.model || model || '정보 없음'} · 서비스: {result.provider}</p><p>다른 악보 앱용 XML은 항목 순서만 정리한 복사본입니다. 음표·코드·가사 값은 유지하며 인식 결과 원본 XML도 따로 저장할 수 있습니다.</p></details>}
  </section>;
}
