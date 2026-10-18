'use client';

import { useEffect, useRef, useState } from 'react';
import { applySectionLyrics, previewSectionLyrics } from '@/lib/lyric-entry.ts';
import { sectionLyricText } from '@/lib/lyrics.ts';
import type { SectionLyricPreview } from '@/lib/lyric-entry.ts';
import type { ScoreSection } from '@/lib/score-types.ts';

type Props = {
  section: ScoreSection;
  onApply: (nextSection: ScoreSection) => void;
  disabled?: boolean;
  forceOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function SectionLyricsFields({ section, onApply, disabled, forceOpen, onOpenChange }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [initiallyOpen] = useState(Boolean(forceOpen));
  const [text, setText] = useState(() => sectionLyricText(section));
  const [preview, setPreview] = useState<{ section: ScoreSection; text: string; result: SectionLyricPreview } | null>(null);
  const [message, setMessage] = useState('');
  const currentPreview = preview?.section === section && preview.text === text;

  useEffect(() => {
    if (forceOpen && detailsRef.current) detailsRef.current.open = true;
  }, [forceOpen]);

  function showPreview() {
    if (disabled) return;
    setMessage('');
    setPreview({ section, text, result: previewSectionLyrics(section, text) });
  }

  function apply() {
    if (disabled || !currentPreview || !preview?.result.canApply) return;
    try {
      onApply(applySectionLyrics(section, text));
      setPreview(null);
      setMessage(`${section.label} 가사를 적용했습니다. 악보에서 음표와 가사가 맞는지 확인해 주세요.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '가사를 적용하지 못했습니다. 다시 미리 봐 주세요.');
    }
  }

  return <details ref={detailsRef} className="section-lyrics-editor" open={initiallyOpen} onToggle={event => onOpenChange?.(event.currentTarget.open)}>
    <summary>가사 한 번에 넣기 <span className="section-lyrics-free">무료</span></summary>
    <fieldset disabled={disabled}>
      <label>가사를 넣을 구간: {section.label}
        <textarea aria-label={`${section.label} 가사 한 번에 넣기`} rows={5} maxLength={16000} value={text} placeholder="예: 하나님 사랑\n나의 주" onChange={event => { setText(event.target.value); setPreview(null); setMessage(''); }}/>
      </label>
      <details className="local-text-notes"><summary>가사 넣는 방법</summary>
        <p>한글은 한 음절씩, 영어는 공백으로 나눈 단위씩 음표에 넣습니다. 쉼표와 붙임줄로 이어진 음표는 자동으로 건너뜁니다.</p>
        <p>같은 글자를 여러 음으로 길게 부를 때는 추가 음표마다 공백으로 구분한 <code>-</code>를 넣으세요. 예: <code>주 - 님</code>. 단어 안의 하이픈은 그대로 둡니다. 영어 음절을 나눠야 하면 <code>a men</code>처럼 직접 띄어 주세요.</p>
        <p>기본 가사만 바꾸며 다른 절의 가사·음표·코드는 유지합니다. 글자 수가 맞아도 부르는 위치가 맞는지는 직접 확인해 주세요.</p>
        <p>건너뛸 음표나 쉼표에 기존 가사가 남아 있으면 적용을 막습니다. 악보 편집에서 해당 가사를 원본과 비교해 고친 뒤 다시 미리 봐 주세요.</p>
      </details>
      <button type="button" className="button outline full-width" onClick={showPreview} disabled={disabled || !text.trim()}>가사 배치 미리보기</button>
      {preview && <div className="section-lyrics-preview">
        <p className="section-lyrics-counts" role="status">넣을 음표 {preview.result.availableNotes}개 · 가사 {preview.result.lyricUnits}개{preview.result.skipUnits > 0 ? ` · 늘임 ${preview.result.skipUnits}개` : ''}</p>
        {(preview.result.restNotes > 0 || preview.result.tiedNotes > 0) && <p className="section-lyrics-excluded">쉼표 {preview.result.restNotes}개·붙임줄 뒤 음표 {preview.result.tiedNotes}개는 제외했습니다.</p>}
        {!currentPreview && <p className="local-text-error" role="alert">악보가 바뀌었습니다. 현재 음표로 다시 미리 봐 주세요.</p>}
        {preview.result.error && <p className="local-text-error" role="alert">{preview.result.error}</p>}
        {preview.result.excludedLyrics.length > 0 && <ul className="section-lyrics-excluded" aria-label="먼저 확인할 기존 가사">{preview.result.excludedLyrics.map(row => <li key={`${row.measureNumber}:${row.noteNumber}`}>{row.measureNumber}마디 {row.noteNumber}번째 · {row.kind === 'rest' ? '쉼표' : '붙임줄 뒤 음표'}: {row.text}</li>)}</ul>}
        {preview.result.remaining.length > 0 && <p className="section-lyrics-remaining">남은 입력: {preview.result.remaining.map(unit => unit.skip ? '−' : unit.text).join('')}</p>}
        <div className="section-lyrics-placement" tabIndex={0} role="region" aria-label="음표별 가사 배치 미리보기">
          <table><thead><tr><th scope="col">위치</th><th scope="col">음</th><th scope="col">넣을 가사</th></tr></thead>
            <tbody>{preview.result.rows.map(row => <tr key={row.noteId}>
              <td>{row.measureNumber}마디 {row.noteNumber}번째</td><td>{row.pitch}</td>
              <td>{row.unit === null ? '입력 부족 · 기존 가사 유지' : row.unit.skip ? '늘임 · 가사 비움' : <>{row.unit.text}{row.unit.endLine && <span aria-label="줄 바꿈"> ↵</span>}</>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <button type="button" className="button primary full-width" onClick={apply} disabled={disabled || !currentPreview || !preview.result.canApply}>확인한 가사 적용</button>
      </div>}
    </fieldset>
    {message && <p className="section-lyrics-message" role="status">{message}</p>}
  </details>;
}

export function SectionLyricsEditor(props: Props) {
  return <SectionLyricsFields key={props.section.id} {...props}/>;
}

export default SectionLyricsEditor;
