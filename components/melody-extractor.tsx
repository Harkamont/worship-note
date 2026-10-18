'use client';

import { useMemo, useState } from 'react';
import { Download, FileText, Music2 } from 'lucide-react';
import { listMusicXMLMelodySources, extractMusicXMLMelody } from '@/lib/musicxml-melody.ts';
import { reviewExtractedMelody } from '@/lib/musicxml-melody-client.ts';
import { downloadText } from '@/lib/image-export';
import MusicXMLPreview from '@/components/musicxml-preview.tsx';
import { HelpTip } from '@/components/help-tip';
import type { MusicXMLRecognitionResult } from '@/lib/recognition';
import type { ReviewMelody } from '@/lib/review-workspace.ts';

type Props = { source: MusicXMLRecognitionResult; melody: ReviewMelody; onMelodyChange: (melody: ReviewMelody) => void; disabled?: boolean; onImport: (result: MusicXMLRecognitionResult) => void };
type SourceKey = { partId: string; staff: string; voice: string };
const key = (source: SourceKey) => JSON.stringify([source.partId, source.staff, source.voice]);

export default function MelodyExtractor({ source, melody, onMelodyChange, disabled = false, onImport }: Props) {
  const xml = source.document.xml;
  const candidates = useMemo(() => {
    try { return { sources: listMusicXMLMelodySources(xml.replace(/^\uFEFF/, '')), error: '' }; }
    catch (cause) { return { sources: [], error: cause instanceof Error ? cause.message : '멜로디 성부를 찾지 못했습니다.' }; }
  }, [xml]);
  const selectedKey = melody.selection ? key(melody.selection) : '';
  const selected = candidates.sources.find(candidate => key(candidate) === selectedKey) ?? candidates.sources[0];
  const activeKey = selected ? key(selected) : '';
  const [error, setError] = useState('');
  const reviewed = useMemo(() => {
    if (!melody.xml || !melody.selection || key(melody.selection) !== activeKey) return { result: null, error: '' };
    try {
      const result = reviewExtractedMelody(source, { xml: melody.xml.replace(/^\uFEFF/, ''), warnings: melody.warnings });
      result.document.xml = melody.xml;
      return { result, error: '' };
    } catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : '보관한 멜로디 악보를 읽지 못했습니다.' }; }
  }, [source, melody, activeKey]);
  const result = reviewed.result;
  const draftResult = useMemo(() => {
    if (!result || result.score) return null;
    try {
      const draft = reviewExtractedMelody(source, { xml: result.document.xml.replace(/^\uFEFF/, ''), warnings: melody.warnings }, { reviewDraft: true });
      draft.document.xml = result.document.xml;
      return draft.score ? draft : null;
    } catch { return null; }
  }, [source, result, melody.warnings]);
  function extract() {
    if (disabled || !selected) return;
    setError('');
    try {
      const extraction = extractMusicXMLMelody(xml.replace(/^\uFEFF/, ''), { partId: selected.partId, staff: selected.staff, voice: selected.voice });
      onMelodyChange({ selection: extraction.selection, xml: extraction.xml, warnings: extraction.warnings });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '선택한 성부를 멜로디 악보로 만들지 못했습니다. 원래 악보는 그대로 보관합니다.'); }
  }
  const name = (source.document.title || '찬송가').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
  function download(type: 'xml' | 'txt') {
    if (!result) return;
    if (type === 'xml') downloadText(result.document.xml, `${name}_멜로디.musicxml`, 'application/vnd.recordare.musicxml+xml');
    else downloadText('\uFEFF' + result.document.lyricsText, `${name}_멜로디가사.txt`);
  }
  return <section className="melody-extractor" aria-label="찬송가에서 회중 멜로디 만들기">
    <div className="melody-extractor-heading"><div className="help-heading"><h4><Music2 size={17}/>4부 찬송가를 멜로디 악보로</h4><HelpTip helpKey="melody"/></div><span className="melody-local-badge">무료</span></div>
    <div className="melody-extractor-controls"><label>남길 멜로디<select aria-label="멜로디 악보에 남길 성부" disabled={disabled || !candidates.sources.length} value={activeKey} onChange={event => { const candidate = candidates.sources.find(item => key(item) === event.target.value); if (candidate) onMelodyChange({ selection: { partId: candidate.partId, staff: candidate.staff, voice: candidate.voice }, xml: null, warnings: [] }); setError(''); }}>{candidates.sources.map((candidate, index) => <option key={key(candidate)} value={key(candidate)}>{index === 0 ? '추천 · ' : ''}{candidate.voice === '*' ? '맨 위 멜로디 자동 선택 · ' : ''}{candidate.partName} · {candidate.staff}번째 오선{candidate.voice === '*' ? '' : ` · 성부 ${candidate.voice}`}</option>)}</select></label><button className="button outline" disabled={disabled || !selected} onClick={extract}><Music2 size={16}/>멜로디 악보 만들기</button></div>
    {(error || candidates.error || reviewed.error) && <p className="local-text-error" role="alert">{error || candidates.error || reviewed.error}</p>}
    {result && <div className="melody-extractor-result"><div className="direct-musicxml-summary"><span>멜로디 {result.document.measureCount}마디</span><span>음표·쉼표 {result.document.noteCount}개</span><span>기존 코드 {result.document.chordCount}개</span></div>

      <MusicXMLPreview xml={result.document.xml}/>
      {result.document.issues.length > 0 && <details className="melody-extractor-issues"><summary>멜로디 악보 확인할 내용 {result.document.issues.length}개</summary><ul>{result.document.issues.slice(0, 50).map((issue, index) => <li key={index}>{issue.measure ? `${issue.measure}마디 · ` : ''}{issue.message}</li>)}</ul>{result.document.issues.length > 50 && <p>표시한 50개 외에도 확인할 내용이 있습니다. 원본과 마디별로 대조해 주세요.</p>}</details>}
      <div className="direct-musicxml-downloads"><button className="button outline" onClick={() => download('xml')}><Download size={16}/>멜로디 악보 파일 (XML)</button><button className="button outline" disabled={!result.document.lyricsText} onClick={() => download('txt')}><FileText size={16}/>멜로디 가사 파일 (TXT)</button><button className="button primary" disabled={disabled || !result.score} onClick={() => onImport(result)}><Music2 size={16}/>멜로디 편집하기</button>{draftResult && <><button className="button outline" disabled={disabled} onClick={() => onImport(draftResult)}><Music2 size={16}/>검토용으로 열고 고치기</button><HelpTip helpKey="draftImport"/></>}</div>
      {draftResult ? <p className="direct-musicxml-caution">확인할 박자·조표가 있습니다. 원본과 비교하며 고쳐 주세요.</p> : result.editorIssue && <p className="direct-musicxml-caution">이 앱에서 편집할 수 없는 음표·박자 구성이 있습니다. 멜로디 악보 파일을 저장해 다른 악보 앱에서 열 수 있습니다.</p>}
      <p className="melody-extractor-help">편집을 시작하면 현재 편집 중인 악보를 교체합니다.</p>
    </div>}
  </section>;
}
