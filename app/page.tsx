'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Music2, Upload, Download, Plus, GripVertical, Settings2, ChevronRight, ChevronDown, FileText, Image as ImageIcon, X, Undo2, Redo2, Trash2, Copy, Loader2, ArrowUp, ArrowDown, SlidersHorizontal, FolderOpen, CircleHelp, Sparkles, CheckCircle2, ListMusic, BookOpen, FileJson } from 'lucide-react';
import ScoreView from '@/components/score-view';
import LocalTextOcr from '@/components/local-text-ocr';
import DirectMusicXML from '@/components/direct-musicxml';
import AIConnection from '@/components/ai-connection.tsx';
import HelpTip from '@/components/help-tip';
import GettingStartedHelp from '@/components/getting-started-help';
import SectionRangeEditor from '@/components/section-range-editor.tsx';
import SectionLyricsEditor from '@/components/section-lyrics-editor.tsx';
import { createSampleScore, createBlankScore } from '@/lib/sample';
import { transposeScore, exportLyrics, exportMusicXML, getScoreStats, validateScore, durationBeats, measureBeats, KEY_OPTIONS } from '@/lib/music';
import { downloadScorePNG, downloadText } from '@/lib/image-export';
import { normalizeImageFile, selectImageInput } from '@/lib/image-input.ts';
import { loadProject, saveProject, getProjectStorageKind } from '@/lib/project-storage';
import { parseProject, serializeProject, MAX_PROJECT_JSON_BYTES } from '@/lib/project-io';
import { createReviewWorkspace, restoreReviewWorkspace, restoreMeasureRepair, normalizeReviewWorkspace, type ReviewWorkspace, type ReviewMelody, type ReviewMode } from '@/lib/review-workspace.ts';
import { createEmptyMeasure } from '@/lib/editor';
import { withRhythmReview, scoreRhythmIssues } from '@/lib/editor-review.ts';
import { recognitionOptions } from '@/lib/recognition-options.ts';
import { recognizeScore, type RecognitionMode } from '@/lib/recognition-client';
import { lyricVerseNumbers, withNoteLyric } from '@/lib/lyrics';
import { reviewMusicXMLFile, type MusicXMLRepairResult } from '@/lib/musicxml-client';
import type { MusicXMLRecognitionResult } from '@/lib/recognition';
import type { Score, ScoreSection, ScoreMeasure, ScoreNote, SectionType, NoteDuration, RecognitionResult } from '@/lib/score-types';

const sectionNames: Record<SectionType, string> = { intro: '전주', verse: '절(벌스)', prechorus: '후렴 전(프리코러스)', chorus: '후렴', bridge: '브릿지', interlude: '간주', outro: '마무리' };
const uid = () => crypto.randomUUID();
const safeName = (s: string) => (s.trim() || '찬양악보').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
type Pending = { id: string; file: File; url: string; width: number; height: number; notice?: string; };
type ReviewInput = Omit<Pending, 'file'> & { file: File | null; name: string };
type XMLReviewState = { input: ReviewInput; result: MusicXMLRecognitionResult; mode: ReviewMode; workspace: ReviewWorkspace };
function restoredReview(value: ReviewWorkspace): XMLReviewState {
  const restored = restoreReviewWorkspace(value);
  return { input: { id: uid(), file: null, name: restored.workspace.sourceName, url: restored.workspace.sourceImage ?? '', width: 0, height: 0 }, result: restored.result, mode: restored.workspace.mode, workspace: restored.workspace };
}
type Config = { configured: boolean; provider: string; model: string; annotationModel?: string; musicxmlModel?: string; musicxmlAnnotationModel?: string; protocol?: string; };

function Badge({ section }: { section: ScoreSection }) { return <span className={`section-badge ${section.type}`}>{section.label}</span>; }
function Modal({ title, children, onClose, wide = false, precision = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; precision?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''} ${precision ? 'precision' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={19}/></button></div>{children}</dialog>;
}

export default function Studio() {
  const [score, setScore] = useState<Score>(() => createSampleScore());
  const [sectionId, setSectionId] = useState('');
  const [measureId, setMeasureId] = useState<string | null>(null);
  const [tab, setTab] = useState<'form' | 'edit' | 'lyrics'>('form');
  const [lyricsEntryOpen, setLyricsEntryOpen] = useState(false);
  const [view, setView] = useState<'score' | 'original'>('score');
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [recognition, setRecognition] = useState<Omit<RecognitionResult, 'score'> | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [omrConfigured, setOmrConfigured] = useState(false);
  const [localTextConfigured, setLocalTextConfigured] = useState(false);
  const [localTextBusy, setLocalTextBusy] = useState(false);
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode | 'musicxml' | 'musicxml-hybrid' | 'musicxml-local'>('musicxml-local');
  const [xmlBusy, setXMLBusy] = useState(false);
  const [xmlReview, setXMLReview] = useState<XMLReviewState | null>(null);
  const [xmlReviewOpen, setXMLReviewOpen] = useState(false);
  const [modal, setModal] = useState<'settings' | 'help' | 'new' | 'section' | 'review-notes' | null>(null);
  const [sectionType, setSectionType] = useState<SectionType>('verse');
  const [sectionLabel, setSectionLabel] = useState('');
  const [menu, setMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [withNames, setWithNames] = useState(true);
  const [instrumentals, setInstrumentals] = useState(false);
  const [lyricVerse, setLyricVerse] = useState('default');
  const [showForm, setShowForm] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [perLine, setPerLine] = useState(4);
  const [fontSize, setFontSize] = useState(16);
  const [zoom, setZoom] = useState(85);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [saved, setSaved] = useState('불러오는 중');
  const [storageKind, setStorageKind] = useState<'device' | 'browser' | 'unknown'>('unknown');
  const [ready, setReady] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [fitZoom, setFitZoom] = useState(85);
  const [scorePageWidth, setScorePageWidth] = useState(1000);
  const canvasRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const manualZoom = useRef(false);
  const [history, setHistory] = useState<Score[]>([]);
  const [future, setFuture] = useState<Score[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const musicXMLRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uploadEpoch = useRef(0);
  const section = score.sections.find(s => s.id === sectionId) ?? score.sections[0];
  const measure = section?.measures.find(m => m.id === measureId) ?? section?.measures[0];
  const stats = getScoreStats(score);
  const rhythmIssues = scoreRhythmIssues(score);
  const readingOption = recognitionOptions[recognitionMode];
  const xmlMode = recognitionMode === 'musicxml' || recognitionMode === 'musicxml-hybrid' || recognitionMode === 'musicxml-local';
  const xmlProcessingMode = recognitionMode === 'musicxml-local' ? 'local' : recognitionMode === 'musicxml-hybrid' ? 'hybrid' : 'direct';
  const verseNumbers = lyricVerseNumbers(score.sections);
  const selectedVerse = lyricVerse === 'all' || verseNumbers.includes(lyricVerse) ? lyricVerse : undefined;
  let lyrics = '';
  try { lyrics = exportLyrics(score, { sectionNames: withNames, includeInstrumentals: instrumentals, verse: selectedVerse }); } catch { lyrics = '부를 순서에 넣은 구간을 확인해 주세요.'; }

  useEffect(() => {
    const textConfigController = new AbortController();
    fetch('/api/text-ocr', { signal: textConfigController.signal, cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(data => { if (!textConfigController.signal.aborted) setLocalTextConfigured(Boolean(data && typeof data === 'object' && 'configured' in data && data.configured === true)); }).catch(() => { if (!textConfigController.signal.aborted) setLocalTextConfigured(false); });
    fetch('/api/config').then(r => r.ok ? r.json() : Promise.reject()).then(data => setConfig(data as Config)).catch(() => setConfig({ configured: false, provider: 'openai', model: 'gpt-6-luna' }));
    fetch('/api/omr').then(r => r.ok ? r.json() : Promise.reject()).then(data => { if (data && typeof data === 'object' && 'configured' in data && data.configured === true) { setOmrConfigured(true); } }).catch(() => setOmrConfigured(false));
    loadProject().then(p => { setStorageKind(getProjectStorageKind()); if (p) { setScore(p.score); setImage(p.originalImage); setImageName(p.originalName); setRecognition(p.recognition ?? null); setXMLReview(p.reviewWorkspace ? restoredReview(p.reviewWorkspace) : null); } setCanSave(true); setReady(true); }).catch(() => { setCanSave(false); setReady(true); setSaved('자동 저장 중지'); setError('저장된 작업을 불러오지 못했습니다. 기존 저장 내용은 보존됩니다. 새 작업을 선택하기 전까지 JSON 다운로드로 작업을 보관해 주세요.'); });
    return () => { abortRef.current?.abort(); textConfigController.abort(); };
  }, []);
  useEffect(() => {
    if (!ready || !canSave) return;
    let active = true;
    let flushed = false;
    const flush = () => {
      if (flushed) return;
      flushed = true;
      setSaved('저장 중');
      saveProject({ score, originalImage: image, originalName: imageName, recognition, updatedAt: new Date().toISOString(), ...(xmlReview ? { reviewWorkspace: xmlReview.workspace } : {}) })
        .then(() => { if (active) { const kind = getProjectStorageKind(); setStorageKind(kind); setSaved(kind === 'device' ? '이 기기에 파일로 저장됨' : '이 브라우저에 저장됨'); } })
        .catch(() => { if (active) setSaved('저장 실패 · JSON으로 보관하세요'); });
    };
    const timer = setTimeout(flush, 300);
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', flush); };
  }, [score, image, imageName, recognition, xmlReview, ready, canSave]);
  useEffect(() => { const node = canvasRef.current; if (!node) return; const observer = new ResizeObserver(() => { const fit = Math.max(45, Math.min(100, Math.floor((node.clientWidth - 54) * 100 / scorePageWidth))); setFitZoom(fit); if (!manualZoom.current) setZoom(fit); }); observer.observe(node); return () => observer.disconnect(); }, [scorePageWidth]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3300); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { if (!menu) return; const close = (event: MouseEvent) => { if (event.target instanceof Node && exportMenuRef.current?.contains(event.target)) return; setMenu(false); }; document.addEventListener('click', close); return () => document.removeEventListener('click', close); }, [menu]);
  const commit = useCallback((next: Score) => { setSaved('저장 중'); setHistory(h => [...h.slice(-29), score]); setFuture([]); setScore(next); setXMLReview(current => current ? { ...current, workspace: { ...current.workspace, editorChanged: true } } : null); setError(''); }, [score]);
  const undo = useCallback(() => { if (history.length) { setSaved('저장 중'); setFuture(f => [score, ...f]); setScore(history[history.length - 1]); setXMLReview(current => current ? { ...current, workspace: { ...current.workspace, editorChanged: true } } : null); setHistory(h => h.slice(0, -1)); } }, [history, score]);
  const redo = useCallback(() => { if (future.length) { setSaved('저장 중'); setHistory(h => [...h, score]); setScore(future[0]); setXMLReview(current => current ? { ...current, workspace: { ...current.workspace, editorChanged: true } } : null); setFuture(f => f.slice(1)); } }, [future, score]);
  useEffect(() => { const fn = (e: KeyboardEvent) => { if (readingImage || importing || recognizing || localTextBusy || xmlBusy || pending || xmlReviewOpen || modal) return; if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); } }; window.addEventListener('keydown', fn); return () => window.removeEventListener('keydown', fn); }, [undo, redo, readingImage, importing, recognizing, localTextBusy, xmlBusy, pending, xmlReviewOpen, modal]);
  function replace(next: Score, original: string | null = null, name = '', keepReview: XMLReviewState | null = null) { uploadEpoch.current++; setReadingImage(false); setSaved('저장 중'); setXMLReview(keepReview); setXMLReviewOpen(false); setPending(null); setScore(next); setCanSave(true); setImage(original); setImageName(name); setSectionId(next.sections[0]?.id ?? ''); setMeasureId(null); setHistory([]); setFuture([]); setRecognition(null); setView('score'); setError(''); }
  function updateMeasure(fn: (m: ScoreMeasure) => ScoreMeasure) { if (measure && section) commit({ ...score, sections: score.sections.map(s => s.id === section.id ? { ...s, measures: s.measures.map(m => m.id === measure.id ? withRhythmReview(fn(m), score.timeSignature) : m) } : s) }); }
  function updateNote(id: string, data: Partial<ScoreNote>) { updateMeasure(m => ({ ...m, notes: m.notes.map(n => n.id === id ? typeof data.lyric === 'string' ? withNoteLyric({ ...n, ...data }, data.lyric) : { ...n, ...data } : n) })); }
  async function upload(file?: File, notice?: string | null) {
    if (!ready || readingImage || importing || recognizing || localTextBusy || xmlBusy || xmlReviewOpen || modal || !file) return;
    const ticket = ++uploadEpoch.current;
    setReadingImage(true); setError(''); setUploadError('');
    try {
      const normalized = await normalizeImageFile(file);
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('이미지 파일을 읽지 못했습니다. 다시 선택해 주세요.'));
        reader.readAsDataURL(normalized);
      });
      const img = new window.Image(); img.src = url;
      try { await img.decode(); }
      catch { throw new Error('이미지가 손상되어 읽을 수 없습니다. 다른 PNG 또는 JPG 파일을 선택해 주세요.'); }
      if (img.width < 64 || img.height < 64 || img.width * img.height > 50_000_000) throw new Error('가로·세로 64px 이상, 5천만 화소 이하의 이미지를 올려 주세요.');
      if (ticket !== uploadEpoch.current) return;
      setPending({ id: uid(), file: normalized, url, width: img.width, height: img.height, ...(notice ? { notice } : {}) });
    } catch (e) {
      if (ticket === uploadEpoch.current) setError(e instanceof Error ? e.message : '이미지를 읽을 수 없습니다.');
    } finally {
      if (ticket === uploadEpoch.current) setReadingImage(false);
    }
  }
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || !ready || readingImage || importing || recognizing || localTextBusy || xmlBusy || xmlReviewOpen || modal || pending) return;
      if (target instanceof Element && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const files = clipboard.files.length ? Array.from(clipboard.files) : Array.from(clipboard.items).flatMap(item => item.kind === 'file' ? [item.getAsFile()].filter((file): file is File => file !== null) : []);
      const selection = selectImageInput(files);
      if (!selection.file) return;
      event.preventDefault();
      void upload(selection.file, selection.notice);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });
  function closeUpload() { uploadEpoch.current++; setReadingImage(false); abortRef.current?.abort(); setRecognizing(false); setPending(null); setUploadError(''); }
  async function recognize() {
    if (!pending || recognizing || localTextBusy || xmlBusy || importing || recognitionMode === 'musicxml' || recognitionMode === 'musicxml-hybrid' || recognitionMode === 'musicxml-local') return; setRecognizing(true); setUploadError(''); const controller = new AbortController(); abortRef.current = controller;
    try {
      const data = await recognizeScore(pending.file, recognitionMode, score, { signal: controller.signal });
      controller.signal.throwIfAborted();
      replace(data.score, pending.url, pending.file.name, recognitionMode==='annotations'?xmlReview:null);
      const { score: unused, ...metadata } = data; void unused;
      setRecognition(metadata); setPending(null);
      setToast('악보를 읽었습니다. 원본과 비교하며 음표·코드·가사를 확인해 주세요.');
    } catch (e) { if ((e as Error).name !== 'AbortError') setUploadError(e instanceof Error ? e.message : '인식 요청을 완료하지 못했습니다.'); }
    finally { if (abortRef.current === controller) { setRecognizing(false); abortRef.current = null; } }
  }
  function importXMLReview(data: MusicXMLRecognitionResult, original: Pending | ReviewInput) {
    if (!data.score || xmlBusy) return;
    replace(validateScore(data.score), original.url || null, original.url ? original.file?.name ?? ('name' in original ? original.name : '') : '', xmlReview ? { ...xmlReview, workspace: { ...xmlReview.workspace, melody: data.document.xml === xmlReview.workspace.melody.xml ? xmlReview.workspace.melody : { selection: null, xml: null, warnings: [] }, measureRepair: undefined, editorChanged: false } } : null);
    setRecognition(data.provider === 'local-file' ? null : { model: data.model, provider: data.provider, elapsedMs: data.elapsedMs, usage: data.usage, ...(data.cost === undefined ? {} : { cost: data.cost }) });
    setPending(null); setXMLReviewOpen(false); setTab('edit');
    setToast('편집기로 가져왔습니다. 원본 파일은 원본과 인식 결과 비교에서 다시 받을 수 있어요.');
  }
  function acceptXMLReview(result: MusicXMLRecognitionResult, input: Pending | ReviewInput, mode: ReviewMode) {
    setSaved('저장 중');
    const name = input.file?.name ?? ('name' in input ? input.name : '악보.musicxml');
    const workspace = createReviewWorkspace(result, { sourceImage: input.url || null, sourceName: name, mode });
    setXMLReview({ input: { ...input, name }, result, mode, workspace });
  }
  function updateReviewMelody(melody: ReviewMelody) {
    setSaved('저장 중');
    setXMLReview(current => current ? { ...current, workspace: normalizeReviewWorkspace({ ...current.workspace, melody, measureRepair: undefined }) } : null);
  }
  function applyXMLMeasureRepair(value: MusicXMLRecognitionResult) {
    if (!xmlReview || !value.score || xmlBusy) return;
    if (xmlReview.workspace.editorChanged) { setError('편집기에서 직접 고친 내용이 있어 이전 XML 수정안을 적용할 수 없습니다. 현재 작업 파일을 먼저 저장해 주세요.'); return; }
    const data = value as MusicXMLRepairResult;
    const baseline = xmlReview.workspace.measureRepair?.xml ?? xmlReview.workspace.melody.xml ?? xmlReview.workspace.sourceXML;
    if (!data.repair || data.repair.originalXML !== baseline) { setError('검토 중 악보가 바뀌었습니다. 현재 악보로 수정안을 다시 확인해 주세요.'); return; }
    try {
      const receipt = { model: data.model, provider: data.provider, elapsedMs: data.elapsedMs, usage: data.usage, ...(data.cost === undefined ? {} : { cost: data.cost }) };
      const workspace = normalizeReviewWorkspace({ ...xmlReview.workspace, measureRepair: { xml: data.document.xml, selection: data.repair.selection, receipts: [...(xmlReview.workspace.measureRepair?.receipts ?? []), receipt] } });
      const combined = restoreMeasureRepair(workspace);
      if (!combined?.score) throw new Error('수정안을 편집기로 가져올 수 없습니다. XML 파일로 저장해 확인해 주세요.');
      const nextReview = { ...xmlReview, workspace };
      replace(validateScore(combined.score), xmlReview.input.url || null, xmlReview.input.name ?? xmlReview.input.file?.name ?? '', nextReview);
      setRecognition({ model: combined.model, provider: combined.provider, elapsedMs: combined.elapsedMs, usage: combined.usage, ...(combined.cost === undefined ? {} : { cost: combined.cost }) });
      setTab('edit'); setToast('선택한 마디의 수정안을 가져왔습니다. 원본과 AI 사용 내역도 함께 보관했습니다.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '마디 수정안을 적용하지 못했습니다.'); }
  }
  function refreshAIConfig() { fetch('/api/config', { cache: 'no-store' }).then(response => response.ok ? response.json() : Promise.reject()).then(data => setConfig(data as Config)).catch(() => setConfig({ configured: false, provider: 'openai', model: 'gpt-6-luna' })); }
  async function importProject(file?: File) { if (!ready || readingImage || importing || recognizing || localTextBusy || xmlBusy || !file) return; setImporting(true); try { if (file.size > MAX_PROJECT_JSON_BYTES) throw new Error('작업 파일은 45MB 이하로 불러와 주세요.'); const data = parseProject(await file.text()); replace(data.score, data.originalImage, data.originalName, data.reviewWorkspace ? restoredReview(data.reviewWorkspace) : null); setRecognition(data.recognition); setToast('원본과 편집 내용을 불러왔습니다.'); } catch (e) { setError(e instanceof Error ? e.message : '올바른 작업 파일이 아닙니다.'); } finally { setImporting(false); } }
  async function importMusicXML(file?: File) {
    if (!ready || readingImage || !file || importing || recognizing || localTextBusy || xmlBusy) return;
    setImporting(true); setError('');
    try {
      const result = await reviewMusicXMLFile(file);
      acceptXMLReview(result, { id: uid(), file, url: '', width: 0, height: 0 }, 'local');
      setXMLReviewOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : '악보 파일을 읽을 수 없습니다.'); }
    finally { setImporting(false); }
  }
  function transpose(key: string) { try { commit(transposeScore(score, key)); setToast(`${key}키로 전조했습니다.`); } catch (e) { setError((e as Error).message); } }
  function move(index: number, to: number) { if (to < 0 || to >= score.form.length || index === to) return; const form = [...score.form]; const [entry] = form.splice(index, 1); form.splice(to, 0, entry); commit({ ...score, form }); }
  function addSection() { if (score.sections.length >= 32) { setError('구간은 최대 32개까지 만들 수 있습니다.'); return; } const count = score.sections.filter(s => s.type === sectionType).length + 1; const newSection = createBlankScore().sections[0]; newSection.id = uid(); newSection.label = sectionLabel.trim() || (sectionType==='verse'?`${count}절`:`${sectionNames[sectionType]}${count>1?count:''}`); newSection.type = sectionType; newSection.measures = [createEmptyMeasure(score.timeSignature)]; newSection.measures.forEach(m => { m.id = uid(); m.notes.forEach(n => n.id = uid()); m.chords.forEach(c => c.id = uid()); }); commit({ ...score, sections: [...score.sections, newSection], form: [...score.form, { id: uid(), sectionId: newSection.id, repeat: 1 }] }); setSectionId(newSection.id); setMeasureId(null); setTab('edit'); setModal(null); setSectionLabel(''); }
  function cloneSection() { if (!section || score.sections.length >= 32) return; const next = structuredClone(section); next.id = uid(); next.label += ' 복사'; next.measures.forEach(m => { m.id = uid(); m.notes.forEach(n => n.id = uid()); m.chords.forEach(c => c.id = uid()); }); commit({ ...score, sections: [...score.sections, next] }); setSectionId(next.id); setMeasureId(null); }
  async function exportFile(type: 'png' | 'txt' | 'xml' | 'json') { setMenu(false); setExporting(true); setError(''); try { const name = safeName(score.title); if (type === 'png') { validateScore(score); const svg = document.querySelector('#score-svg') as SVGSVGElement | null; if (svg && (svg.dataset.renderReady !== 'true' || svg.dataset.renderKey !== JSON.stringify([score,perLine,fontSize,showLabels,showForm]))) throw new Error('현재 편집 내용을 악보에 반영하고 있습니다. 잠시 후 다시 다운로드해 주세요.'); if (!svg) throw new Error('편집 악보 탭을 선택한 뒤 다시 다운로드해 주세요.'); await downloadScorePNG(svg, `${name}_${score.key}.png`, 2); } if (type === 'txt') { if (!score.form.length) throw new Error('부를 순서에 구간을 추가해 주세요.'); if (!lyrics.trim()) { setTab('lyrics'); throw new Error('저장할 가사가 없습니다. 가사를 입력한 뒤 다시 저장해 주세요.'); } downloadText('\uFEFF' + lyrics, `${name}_가사.txt`); } if (type === 'xml') downloadText(exportMusicXML(validateScore(score)), `${name}.musicxml`, 'application/vnd.recordare.musicxml+xml'); if (type === 'json') downloadText(serializeProject({score, originalImage:image, originalName:imageName, recognition, updatedAt:new Date().toISOString(), ...(xmlReview ? { reviewWorkspace: xmlReview.workspace } : {})}), `${name}.json`, 'application/json'); setToast('다운로드를 시작했습니다.'); } catch (e) { setError(e instanceof Error ? e.message : '내보내기를 완료하지 못했습니다.'); } finally { setExporting(false); } }
  const mode = /(?:m|minor)$/i.test(score.key.trim()) ? 'm' : '';
  const keys = KEY_OPTIONS[mode ? 'minor' : 'major'];
  const beats = measure?.notes.reduce((sum, n) => sum + durationBeats(n), 0) ?? 0;
  const nominalBeats = measureBeats({}, score.timeSignature);
  const expected = measure ? measureBeats(measure, score.timeSignature) : nominalBeats;
  const chordMax = Math.max(expected, measure?.rhythmReview ? beats : expected, ...(measure?.chords.map(chord=>chord.beat-.75)??[])) + .75;
  function openRhythmIssue() { const current = rhythmIssues.findIndex(item=>item.measureId===measureId); const issue = rhythmIssues[(current+1)%rhythmIssues.length]; if (issue) { setSectionId(issue.sectionId); setMeasureId(issue.measureId); setTab('edit'); setView('score'); } }

  return <div className="studio-shell" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); if (readingImage || importing || recognizing || localTextBusy || xmlBusy || xmlReviewOpen || modal || pending) return; const selection = selectImageInput(e.dataTransfer.files); const file = selection.file ?? e.dataTransfer.files[0]; if (selection.file) void upload(selection.file, selection.notice); else if (/\.(musicxml|xml|mxl)$/i.test(file.name)) void importMusicXML(file); else void upload(file); } }}>
    <input hidden type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" ref={fileRef} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/><input hidden type="file" accept="application/json,.json" ref={projectRef} onChange={e => { void importProject(e.target.files?.[0]); e.target.value = ''; }}/>
    <input hidden type="file" accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" ref={musicXMLRef} onChange={e => { void importMusicXML(e.target.files?.[0]); e.target.value = ''; }}/><aside className="sidebar" inert={!ready || readingImage || importing || recognizing || localTextBusy || xmlBusy}><Link className="brand" href="/"><span className="brand-symbol"><BookOpen size={24}/></span><span><strong>워십노트</strong><small>WORSHIP NOTE</small></span></Link><button className="upload-primary" onClick={() => fileRef.current?.click()}><Plus size={18}/> 악보 이미지 올리기</button><div className="sidebar-label">작업 공간</div><button className="side-nav active" onClick={() => { setView('score'); setTab('form'); }}><FolderOpen size={17}/> 내 악보 <span>1</span></button><button className="side-nav" onClick={() => projectRef.current?.click()}><FileJson size={17}/> 작업 파일 불러오기</button><button className="side-nav" disabled={importing} onClick={() => musicXMLRef.current?.click()}>{importing ? <Loader2 size={17} className="spin"/> : <Music2 size={17}/>} {importing ? '악보 파일 읽는 중…' : '악보 파일 불러오기'}</button><div className="sidebar-label songs-label">현재 작업</div><button className="current-song" onClick={() => setView('score')}><span className="song-art"><Music2 size={23}/></span><span><strong>{score.title || '제목 없는 악보'}</strong><small>{score.key} · {score.timeSignature} · {stats.measures}마디</small></span></button><button className="new-empty" onClick={() => setModal('new')}><Plus size={15}/> 새 악보 직접 만들기</button><div className="sidebar-bottom"><div className="local-card"><span className="local-dot"/><div><strong>{storageKind === 'device' ? '이 기기에 파일로 보관' : '브라우저에 보관'}</strong><HelpTip helpKey="saveLocation"/></div></div><button className="side-nav" onClick={() => setModal('settings')}><Settings2 size={17}/> AI 연결 설정<span className={`connection-dot ${config?.configured ? 'connected' : ''}`}/></button><button className="side-nav" onClick={() => setModal('help')}><CircleHelp size={17}/> 사용 안내</button></div></aside>
    <main className="main-area" inert={!ready || readingImage || importing || recognizing || localTextBusy || xmlBusy}><header className="topbar"><div className="breadcrumbs"><FolderOpen size={15}/><span>내 악보</span><ChevronRight size={13}/><strong>{score.title}</strong></div><div className="save-indicator" role="status"><CheckCircle2 size={14}/>{saved}{saved.startsWith('저장 실패') && <button className="text-button" onClick={() => void exportFile('json')}>작업 파일 보관</button>}</div><button className="mobile-upload icon-button" aria-label="이미지 올리기" onClick={() => fileRef.current?.click()}><Upload size={18}/></button></header>
      <section className="document-heading"><div className="title-block"><div className="title-line"><input aria-label="악보 제목" maxLength={150} value={score.title} onChange={e => commit({ ...score, title: e.target.value })}/>{score.source === 'sample' && <span className="sample-tag">연습용 샘플</span>}</div></div><div className="heading-actions"><HelpTip helpKey="imageInput"/>{xmlReview&&<button className="button outline" onClick={()=>setXMLReviewOpen(true)}><Music2 size={16}/> 원본과 인식 결과 비교</button>}<button className="button outline source-action" onClick={() => fileRef.current?.click()}><Upload size={16}/> 이미지 올리기</button><div className="export-wrapper" ref={exportMenuRef}><button className="button primary" disabled={exporting} onClick={e => { e.stopPropagation(); setMenu(!menu); }}>{exporting ? <Loader2 size={16} className="spin"/> : <Download size={16}/>} 내보내기 <ChevronDown size={14}/></button>{menu && <div className="export-menu" onClick={e => e.stopPropagation()}><div className="export-menu-heading">파일로 저장<HelpTip helpKey="exportFormats"/></div><button onClick={() => void exportFile('png')}><ImageIcon size={17}/><span>악보 이미지</span><span className="file-ext">PNG</span></button><button disabled={!lyrics.trim()} onClick={() => void exportFile('txt')}><FileText size={17}/><span>부를 순서대로 가사</span><span className="file-ext">TXT</span></button><div className="menu-divider"/><button onClick={() => void exportFile('xml')}><Music2 size={17}/><span>다른 악보 프로그램에서 편집</span><span className="file-ext">XML</span></button><button onClick={() => void exportFile('json')}><FileJson size={17}/><span>작업 파일 보관</span><span className="file-ext">JSON</span></button></div>}</div></div></section>
      {error && <div className="error-banner" role="alert"><CircleHelp size={17}/><span>{error}</span><button aria-label="알림 닫기" onClick={() => setError('')}><X size={15}/></button></div>}{rhythmIssues.length>0&&<div className="warning-banner rhythm-review-banner" role="status"><CircleHelp size={16}/><span>박자·코드 위치 확인 {rhythmIssues.length}마디</span><HelpTip helpKey="rhythmReview"/><button onClick={openRhythmIssue}>고칠 마디 보기</button></div>}{score.warnings.length > 0 && <div className="warning-banner"><CircleHelp size={16}/><span>가져온 악보 확인 {score.warnings.length}개</span><button onClick={() => setModal('review-notes')}>내용 보기</button></div>}
      <div className="workspace"><div className="score-workspace"><div className="editor-toolbar"><div className="toolbar-group"><span className="help-label"><span className="toolbar-label">조(키)</span><HelpTip helpKey="transpose"/></span><select aria-label="전조할 키" className="key-select" value={score.key} onChange={e => transpose(e.target.value)}>{[...new Set([...keys, score.key])].map(k => <option key={k} value={k}>{k.replace('b','♭').replace('#','♯')}</option>)}</select><span className="toolbar-separator"/><label className="tempo-control">♩ = <input aria-label="템포" type="number" min={20} max={300} value={score.tempo} onChange={e => { const tempo = Number(e.target.value); if (tempo >= 20 && tempo <= 300) commit({ ...score, tempo }); }}/></label><HelpTip helpKey="tempo"/><span className="time-signature">{score.timeSignature}</span></div><div className="toolbar-group toolbar-right"><button className="icon-button" aria-label="실행 취소" disabled={!history.length} onClick={undo}><Undo2 size={17}/></button><button className="icon-button" aria-label="다시 실행" disabled={!future.length} onClick={redo}><Redo2 size={17}/></button><span className="toolbar-separator"/><button className={`toolbar-tab ${view === 'score' ? 'active' : ''}`} onClick={() => setView('score')}><Music2 size={14}/> 편집 악보</button><button className={`toolbar-tab ${view === 'original' ? 'active' : ''}`} disabled={!image} onClick={() => setView('original')}><ImageIcon size={14}/> 원본</button></div></div><div className="canvas-area" ref={canvasRef}><div className="canvas-caption"><span><span className="small-dot"/>{view === 'score' ? '편집 악보' : imageName}{score.source === 'sample' && ' · 직접 작성한 연습곡'}</span><HelpTip helpKey="scoreEditing"/></div><div className="paper-stage" style={{ '--score-zoom': zoom / 100, '--score-page-width': `${scorePageWidth}px` } as React.CSSProperties}>{view === 'original' && image ? <div className="original-paper"><img src={image} alt="업로드한 원본 악보"/></div> : <div className="score-paper"><ScoreView onLayoutWidthChange={setScorePageWidth} score={score} selectedMeasureId={tab === 'edit' ? measure?.id ?? null : null} renderKey={JSON.stringify([score,perLine,fontSize,showLabels,showForm])} onSelectMeasure={(sid, mid) => { setSectionId(sid); setMeasureId(mid); setTab('edit'); }} measuresPerLine={perLine} fontSize={fontSize} showSectionLabels={showLabels} showForm={showForm}/></div>}</div></div><div className="canvas-footer"><div><Music2 size={14}/><span>{stats.measures}마디</span><span>·</span><span>{stats.sections}개 구간</span></div><div className="zoom-control"><HelpTip helpKey="scoreZoom"/><button aria-label="축소" onClick={() => { manualZoom.current = true; setZoom(z => Math.max(45,z-10)); }}>−</button><span>{zoom}%</span><button aria-label="확대" onClick={() => { manualZoom.current = true; setZoom(z => Math.min(150,z+10)); }}>＋</button><button aria-label="화면에 맞추기" onClick={() => { manualZoom.current = false; setZoom(fitZoom); }}><SlidersHorizontal size={14}/></button></div></div></div>
      <aside className="preparation-panel"><div className="panel-heading"><div><ListMusic size={18}/><h2>예배 준비</h2></div></div><div className="panel-tabs"><button className={tab === 'form' ? 'active' : ''} onClick={() => setTab('form')}>부를 순서</button><button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>악보 편집</button><button className={tab === 'lyrics' ? 'active' : ''} onClick={() => setTab('lyrics')}>가사 TXT</button></div><div className="panel-content">
      {tab === 'form' && <><SectionRangeEditor onSelectSection={id=>{setSectionId(id);setMeasureId(null);}} score={score} sectionId={section.id} disabled={xmlBusy || importing} onApply={(next, id) => { commit(next); setSectionId(id); setMeasureId(null); setToast('선택한 마디를 구간으로 나눴습니다. 부를 순서에서 순서를 정해 주세요.'); }} onError={setError}/><div className="panel-section-heading"><h3 className="help-label">곡의 구간<HelpTip helpKey="songForm" label="구간 추가"/></h3><button className="text-button" onClick={() => setModal('section')}><Plus size={13}/> 추가</button></div><div className="section-palette">{score.sections.map(s => <button key={s.id} onClick={() => { if (score.form.length < 100) commit({ ...score, form: [...score.form, { id: uid(), sectionId: s.id, repeat: 1 }] }); }}><Badge section={s}/><span>{sectionNames[s.type]}</span><Plus size={13}/></button>)}</div><div className="panel-section-heading form-heading"><h3 className="help-label">부를 순서 <span>{score.form.length}</span><HelpTip helpKey="songForm"/></h3></div><div className="form-list">{score.form.map((entry,index) => { const s = score.sections.find(x => x.id === entry.sectionId); if (!s) return null; return <div className={`form-item ${dragIndex === index ? 'dragging' : ''}`} key={entry.id} draggable onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)} onDragOver={e => { if (dragIndex !== null) e.preventDefault(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragIndex !== null) move(dragIndex,index); setDragIndex(null); }}><GripVertical size={15} className="grip"/><span className="form-index">{String(index+1).padStart(2,'0')}</span><button className="form-section-select" onClick={() => { setSectionId(s.id); setMeasureId(null); setTab('edit'); }}><Badge section={s}/><span>{sectionNames[s.type]}</span></button><select aria-label={`${index+1}번째 구간 반복 횟수`} value={entry.repeat} onChange={e => commit({ ...score, form: score.form.map((f,i) => i === index ? { ...f, repeat: Number(e.target.value) } : f) })}>{[1,2,3,4,5,6,7,8].map(v => <option key={v} value={v}>×{v}</option>)}</select><div className="form-item-actions"><button aria-label={`${index+1}번째 구간 위로`} disabled={!index} onClick={() => move(index,index-1)}><ArrowUp size={12}/></button><button aria-label={`${index+1}번째 구간 아래로`} disabled={index===score.form.length-1} onClick={() => move(index,index+1)}><ArrowDown size={12}/></button><button aria-label={`${index+1}번째 구간 삭제`} onClick={() => commit({ ...score, form: score.form.filter((_,i) => i!==index) })}><X size={12}/></button></div></div>; })}</div>{!score.form.length && <div className="empty-form">위 구간을 눌러 부를 순서를 만들어 주세요.</div>}<label className="check-row"><input type="checkbox" checked={showForm} onChange={e=>setShowForm(e.target.checked)}/> 악보 상단에 부를 순서 표시</label><label className="check-row"><input type="checkbox" checked={showLabels} onChange={e=>setShowLabels(e.target.checked)}/> 악보에 구간 이름 표시</label></>}
      {tab === 'edit' && <><div className="panel-section-heading"><h3 className="help-label">구간 편집<HelpTip helpKey="sectionRange"/></h3><button className="text-button" onClick={cloneSection}><Copy size={13}/> 복제</button></div><select className="full-select" aria-label="편집할 구간" value={section?.id ?? ''} onChange={e=>{setSectionId(e.target.value);setMeasureId(null);}}>{score.sections.map(s=><option key={s.id} value={s.id}>{s.label} · {sectionNames[s.type]}</option>)}</select>{section && <div className="field-row"><label>이름<input aria-label="구간 이름" value={section.label} maxLength={30} onChange={e=>commit({...score,sections:score.sections.map(s=>s.id===section.id?{...s,label:e.target.value}:s)})}/></label><label>구분<select value={section.type} aria-label="구간 구분" onChange={e=>commit({...score,sections:score.sections.map(s=>s.id===section.id?{...s,type:e.target.value as SectionType}:s)})}>{Object.entries(sectionNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>}<SectionRangeEditor onSelectSection={id=>{setSectionId(id);setMeasureId(null);}} score={score} sectionId={section?.id ?? ''} onApply={(next, id) => { commit(next); setSectionId(id); setMeasureId(null); setToast('마디 구간을 나눴습니다.'); }} onError={setError}/><div className="measure-tabs">{section?.measures.map((m,i)=><button key={m.id} className={`${measure?.id===m.id?'active ':''}${m.rhythmReview?'needs-review':''}`} onClick={()=>setMeasureId(m.id)} title={m.rhythmReview?'음표 길이 합을 확인해 주세요':undefined}>{i+1}{m.rhythmReview?' !':''}</button>)}<button aria-label="마디 추가" onClick={()=>{if(!section||section.measures.length>=64)return;const m=createEmptyMeasure(score.timeSignature);commit({...score,sections:score.sections.map(s=>s.id===section.id?{...s,measures:[...s.measures,m]}:s)});setMeasureId(m.id);}}><Plus size={13}/></button></div><div className="panel-section-heading"><h3 className="help-label">코드<HelpTip helpKey="chordPosition"/></h3><button className="text-button" onClick={()=>updateMeasure(m=>({...m,chords:[...m.chords,{id:uid(),beat:1,symbol:score.key}]}))}><Plus size={13}/> 추가</button></div><div className="chord-editor">{measure?.chords.map(c=><div key={c.id}><label><input aria-label="코드 박 위치" type="number" min={1} max={chordMax} step={.25} value={c.beat} onChange={e=>updateMeasure(m=>({...m,chords:m.chords.map(x=>x.id===c.id?{...x,beat:Number(e.target.value)}:x)}))}/><span>박</span></label><input aria-label="코드 이름" value={c.symbol} maxLength={30} onChange={e=>updateMeasure(m=>({...m,chords:m.chords.map(x=>x.id===c.id?{...x,symbol:e.target.value}:x)}))}/><button className="icon-button" aria-label="코드 삭제" onClick={()=>updateMeasure(m=>({...m,chords:m.chords.filter(x=>x.id!==c.id)}))}><Trash2 size={13}/></button></div>)}</div><label className="modal-field short-measure-field">이 마디의 길이<select aria-label="이 마디의 길이" value={measure?.actualBeats ?? nominalBeats} onChange={e=>updateMeasure(m=>{const rest={...m};delete rest.actualBeats;const length=Number(e.target.value);return length===nominalBeats?rest:{...rest,actualBeats:length};})}><option value={nominalBeats}>보통 마디 · {nominalBeats}박</option>{[...new Set([.25,.5,.75,1,1.5,2,2.5,3,3.5,measure?.actualBeats??nominalBeats])].filter(value=>value>0&&value<nominalBeats).sort((a,b)=>a-b).map(value=><option key={value} value={value}>짧은 마디 · {value}박</option>)}</select></label><div className="field-help"><HelpTip helpKey="shortMeasure"/></div><div className="panel-section-heading note-heading"><h3 className="help-label">음표와 가사<HelpTip helpKey="noteEntry"/></h3><span className={Math.abs(beats-expected)>.001?'beat-warning':'tiny-muted'}>{beats} / {expected}박</span></div><div className="note-table-heading"><span>음이름</span><span>길이</span><span>가사</span></div><div className="note-editor">{measure?.notes.map(n=><div className="note-row" key={n.id}><input aria-label="음표 음이름" placeholder="쉼표" maxLength={5} value={n.pitch??''} onChange={e=>updateNote(n.id,{pitch:e.target.value||null})}/><select aria-label="음표 길이" value={n.duration} onChange={e=>updateNote(n.id,{duration:e.target.value as NoteDuration})}>{[['w','온음표'],['h','2분'],['q','4분'],['8','8분'],['16','16분']].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select><input aria-label="음표 가사" maxLength={100} value={n.lyric} onChange={e=>updateNote(n.id,{lyric:e.target.value})}/><button className={`dot-button ${n.dots?'active':''}`} aria-label="점음표" onClick={()=>updateNote(n.id,{dots:n.dots?0:1})}>·</button><button className={`tie-button ${n.tie?'active':''}`} aria-label="다음 음표와 붙임줄" aria-pressed={n.tie} title="다음 음표와 붙임줄" onClick={()=>updateNote(n.id,{tie:!n.tie})}>⌒</button><button className="icon-button" aria-label="음표 삭제" onClick={()=>updateMeasure(m=>({...m,notes:m.notes.filter(x=>x.id!==n.id)}))}><X size={12}/></button></div>)}</div><button className="dashed-button" onClick={()=>updateMeasure(m=>({...m,notes:[...m.notes,{id:uid(),pitch:'C4',duration:'q',dots:0,lyric:'',tie:false}]}))}><Plus size={14}/> 음표 추가</button><div className="panel-section-heading layout-heading"><h3 className="help-label">출력 모양<HelpTip helpKey="measuresPerLine"/></h3></div><div className="field-row"><label>한 줄의 최대 마디<select aria-label="한 줄의 최대 마디" value={perLine} onChange={e=>setPerLine(Number(e.target.value))}>{[2,3,4].map(v=><option key={v} value={v}>최대 {v}마디</option>)}</select></label><label>가사 글자 크기<select aria-label="가사 글자 크기" value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}>{[12,14,16,18].map(v=><option key={v} value={v}>{v}px</option>)}</select></label></div></>}
      {tab === 'lyrics' && <><div className="panel-section-heading"><h3 className="help-label">부를 순서대로 가사<HelpTip helpKey="lyricExport"/></h3></div><label className="check-row"><input type="checkbox" checked={withNames} onChange={e=>setWithNames(e.target.checked)}/> 구간 이름 포함</label><label className="check-row"><input type="checkbox" checked={instrumentals} onChange={e=>setInstrumentals(e.target.checked)}/> 가사 없는 구간 이름 포함</label><label className="modal-field">출력할 절<select aria-label="가사 TXT 출력할 절" value={selectedVerse??'default'} onChange={e=>setLyricVerse(e.target.value)}><option value="default">기본 가사</option>{verseNumbers.map(verse=><option key={verse} value={verse}>{verse}절</option>)}<option value="all">모든 절</option></select></label>{!lyrics.trim()&&<div className="empty-lyrics-state"><strong>저장할 가사가 아직 없어요</strong><p>무료 음표 읽기는 가사를 붙이지 않습니다. 아래에서 직접 입력할 수 있어요.</p><button className="button outline full-width" onClick={()=>setLyricsEntryOpen(true)}>가사 입력하기</button></div>}{section&&<><label className="modal-field">가사 입력할 구간<select aria-label="가사 입력할 구간" value={section.id} onChange={e=>{setSectionId(e.target.value);setMeasureId(null);}}>{score.sections.map(s=><option value={s.id} key={s.id}>{s.label}</option>)}</select></label><SectionLyricsEditor key={section.id} section={section} forceOpen={lyricsEntryOpen} onOpenChange={setLyricsEntryOpen} onApply={nextSection=>{commit({...score,sections:score.sections.map(s=>s.id===nextSection.id?nextSection:s)});setToast('입력한 가사를 반영했습니다. 원본과 비교해 주세요.');}}/></>}<div className="lyrics-preview-heading"><span>가사 미리 보기</span><HelpTip helpKey="lyricVerse"/></div><pre className="lyrics-preview">{lyrics||'가사를 입력하면 부를 순서에 맞춰 여기에 표시됩니다.'}</pre><div className="lyrics-actions"><button className="button outline" disabled={!lyrics.trim()} onClick={async()=>{try{await navigator.clipboard.writeText(lyrics);setToast('가사를 복사했습니다.');}catch{setError('클립보드를 사용할 수 없습니다. TXT로 다운로드해 주세요.');}}}><Copy size={15}/> 복사</button><button className="button primary" disabled={!lyrics.trim()} onClick={()=>void exportFile('txt')}><Download size={15}/> TXT 다운로드</button></div></>}
      </div></aside></div>
    </main>
    {!ready && <div style={{position:'fixed',inset:0,zIndex:200,background:'rgba(248,249,246,.96)',display:'grid',placeItems:'center'}} role="status"><div style={{display:'flex',gap:12,alignItems:'center'}}><Loader2 size={20} className="spin"/>저장된 작업을 불러오고 있어요…</div></div>}
    {(importing||readingImage)&&<div className="toast" role="status"><Loader2 size={17} className="spin"/>{readingImage?'이미지를 여는 중이에요…':'악보 파일을 읽고 있어요…'}</div>}
    {toast&&!importing&&!readingImage&&<div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
    {pending&&<Modal title={readingOption.label} onClose={closeUpload} wide precision={xmlMode}>
      {error&&<p className="local-text-error" role="alert">{error}</p>}{pending.notice&&<p className="local-text-error" role="status">{pending.notice}</p>}<label className="modal-field upload-mode-field">악보를 읽을 방법<select aria-label="악보 인식 방법" disabled={recognizing||localTextBusy||xmlBusy} value={recognitionMode} onChange={e=>{setRecognitionMode(e.target.value as keyof typeof recognitionOptions);setUploadError('');}}>{(['musicxml-local','musicxml-hybrid','musicxml'] as const).map(value=><option key={value} value={value}>{recognitionOptions[value].label}</option>)}<optgroup label="추가 읽기 방식">{(['annotations','omr','hybrid','full'] as const).filter(value=>omrConfigured||!['omr','hybrid'].includes(value)).map(value=><option key={value} value={value}>{recognitionOptions[value].label}</option>)}</optgroup></select></label>
      <section className={`recognition-explanation ${readingOption.paid?'paid':'free'}`} aria-label="선택한 읽기 방식 안내"><strong>{readingOption.cost}</strong><HelpTip helpKey={recognitionMode}/></section>
      {recognitionMode==='annotations'&&<p className="local-text-error">현재 편집 악보와 올린 이미지가 같은 곡·같은 마디인지 확인해 주세요.</p>}
      {readingOption.paid&&!config?.configured&&<details className="inline-ai-settings"><summary>AI 연결 설정하기 (선택 사항)</summary><AIConnection onChanged={refreshAIConfig}/></details>}
      {xmlMode?<DirectMusicXML key={`${pending.id}:${xmlProcessingMode}`} mode={xmlProcessingMode} localTextInput={localTextConfigured?{width:pending.width,height:pending.height}:undefined} file={pending.file} originalUrl={pending.url} configured={xmlProcessingMode==='local'?omrConfigured:Boolean(config?.configured)} model={xmlProcessingMode==='local'?'HOMR':xmlProcessingMode==='hybrid'?`HOMR + ${config?.musicxmlAnnotationModel??config?.annotationModel??config?.model??'연결 확인 중'}`:(config?.musicxmlModel??config?.model??'연결 확인 중')} result={xmlReview?.input.id===pending.id&&(xmlReview.mode??'direct')===xmlProcessingMode?xmlReview.result:null} onResult={result=>acceptXMLReview(result,pending,xmlProcessingMode)} melody={xmlReview?.input.id===pending.id ? xmlReview.workspace.melody : undefined} onMelodyChange={updateReviewMelody} onDownloadProject={()=>void exportFile('json')} onImport={result=>importXMLReview(result,pending)} aiConfigured={Boolean(config?.configured)} reviewWorkspace={xmlReview?.workspace} onMeasureRepairApply={applyXMLMeasureRepair} onBusyChange={setXMLBusy}/>:<div className="upload-review"><div className="upload-image"><img src={pending.url} alt="인식할 악보 이미지"/></div><div className="upload-details"><span className="eyebrow">이미지에서 악보 읽기</span><h3>{pending.file.name}</h3>{localTextConfigured&&<LocalTextOcr key={pending.id} file={pending.file} width={pending.width} height={pending.height} busy={recognizing||localTextBusy||importing||xmlBusy} onBusyChange={setLocalTextBusy}/>}<details className="help-guide-detail"><summary>인식 정보</summary><div className="model-card"><Sparkles size={16}/><span>{recognitionMode==='omr'?'HOMR':recognitionMode==='hybrid'?`HOMR + ${config?.annotationModel??config?.model??'연결 확인 중'}`:recognitionMode==='annotations'?(config?.annotationModel??config?.model??'연결 확인 중'):(config?.model??'연결 확인 중')}<small>{recognitionMode==='omr'?'로컬 음표 인식 · 추론 API 비용 없음':config?.configured?'코드·가사 등 AI 인식 시 API 사용량이 발생해요.':'AI 연결 설정이 필요해요.'}</small></span></div></details>{uploadError&&<p className="upload-error" role="alert">{uploadError}</p>}<div className="upload-actions"><button className="button outline" onClick={closeUpload}>취소</button><button className="button primary" disabled={recognizing||localTextBusy||(recognitionMode!=='omr'&&!config?.configured)} onClick={()=>void recognize()}>{recognizing?<Loader2 size={16} className="spin"/>:<Sparkles size={16}/>} {recognizing?'악보를 읽고 있어요…':'선택한 방법으로 읽기'}</button></div></div></div>}
    </Modal>}
    {xmlReviewOpen&&xmlReview&&<Modal title="원본과 인식 결과 확인" onClose={()=>setXMLReviewOpen(false)} wide precision>{error&&<p className="local-text-error" role="alert">{error}</p>}<DirectMusicXML mode={xmlReview.mode} file={xmlReview.input.file} originalUrl={xmlReview.input.url} configured={Boolean(config?.configured)} model={config?.musicxmlModel??config?.model??'연결 확인 중'} result={xmlReview.result} sourceName={xmlReview.input.name} onResult={result=>acceptXMLReview(result,xmlReview.input,xmlReview.mode)} melody={xmlReview.workspace.melody} onMelodyChange={updateReviewMelody} onDownloadProject={()=>void exportFile('json')} onImport={result=>importXMLReview(result,xmlReview.input)} aiConfigured={Boolean(config?.configured)} reviewWorkspace={xmlReview?.workspace} onMeasureRepairApply={applyXMLMeasureRepair} onBusyChange={setXMLBusy}/></Modal>}
    {modal==='settings'&&<Modal title="AI 연결 설정" onClose={()=>setModal(null)}><div className="settings-status"><span className={`connection-dot ${config?.configured?'connected':''}`}/><strong>{config?.configured?'AI 연결 정보가 저장되어 있어요':'기본 기능은 무료로 사용할 수 있어요'}</strong></div><details className="help-guide-detail"><summary>연결 정보 자세히 보기</summary><dl className="settings-list"><div><dt>인식 서비스</dt><dd>{config?.provider??'확인 중'}</dd></div><div><dt>현재 모델</dt><dd>{config?.model??'확인 중'}</dd></div><div><dt>AI 전체 읽기 모델</dt><dd>{config?.musicxmlModel??config?.model??'확인 중'}</dd></div><div><dt>AI 가사·코드 모델</dt><dd>{config?.musicxmlAnnotationModel??config?.annotationModel??config?.model??'확인 중'}</dd></div><div><dt>연결 방식</dt><dd>{config?.protocol??'Responses'}</dd></div></dl></details><AIConnection onChanged={refreshAIConfig}/>{recognition&&<><h3 className="modal-subtitle">최근 인식</h3><dl className="settings-list"><div><dt>모델</dt><dd>{recognition.model}</dd></div><div><dt>걸린 시간</dt><dd>{(recognition.elapsedMs/1000).toFixed(1)}초</dd></div><div><dt>보고된 사용료</dt><dd>{recognition.provider==='local-omr'?'무료 · 이 기기에서 처리':recognition.cost!==undefined?`$${recognition.cost.toFixed(6)}`:'AI 사용료 정보 없음 · 서비스에서 확인'}</dd></div><div><dt>입력 / 출력 토큰</dt><dd>{recognition.usage?`${recognition.usage.inputTokens.toLocaleString()} / ${recognition.usage.outputTokens.toLocaleString()}`:'제공되지 않음'}</dd></div></dl></>}{score.warnings.length>0&&<details className="help-guide-detail"><summary>가져온 악보 확인 · {score.warnings.length}개</summary><ul className="warning-list">{score.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}<button className="button primary full-width" onClick={()=>setModal(null)}>확인</button></Modal>}
    {modal==='review-notes'&&<Modal title="가져온 악보의 확인 안내" onClose={()=>setModal(null)}><p className="modal-copy">가져올 때 기록한 안내입니다. 현재 박자·코드 위치를 확인할 마디는 편집 화면 위쪽에 따로 표시합니다.</p><ul className="warning-list">{score.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul><button className="button primary full-width" onClick={()=>setModal(null)}>확인</button></Modal>}
    {modal==='help'&&<Modal title="워십노트 사용 안내" onClose={()=>setModal(null)} wide><GettingStartedHelp onClose={()=>setModal(null)}/></Modal>}
    {modal==='new'&&<Modal title="새 작업 시작" onClose={()=>setModal(null)}><p className="modal-copy">현재 작업은 새 악보로 교체됩니다. 필요하면 작업 파일(JSON)을 먼저 보관하세요.</p><div className="new-options"><button onClick={()=>{replace(createBlankScore());setModal(null);setTab('edit');}}><Music2 size={24}/><strong>빈 악보 만들기</strong><span>음표·코드를 직접 입력해요</span></button><button onClick={()=>{replace(createSampleScore());setModal(null);}}><BookOpen size={24}/><strong>연습용 샘플 열기</strong><span>편집과 전조를 시험해요</span></button></div><button className="button outline full-width" onClick={()=>void exportFile('json')}><Download size={15}/> 현재 작업 파일 보관</button></Modal>}
    {modal==='section'&&<Modal title="새 구간 추가" onClose={()=>setModal(null)}><label className="modal-field">구간 종류<select value={sectionType} onChange={e=>setSectionType(e.target.value as SectionType)}>{Object.entries(sectionNames).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label className="modal-field">표시할 이름<input placeholder="예: 1절, 마지막 후렴" maxLength={30} value={sectionLabel} onChange={e=>setSectionLabel(e.target.value)}/></label><button className="button primary full-width" onClick={addSection}><Plus size={16}/> 구간 추가</button></Modal>}
  </div>;
}
