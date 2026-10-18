'use client';

import { useState } from 'react';
import { Scissors } from 'lucide-react';
import { HelpTip } from '@/components/help-tip';
import { assignSectionRange } from '@/lib/section-ranges.ts';
import type { Score, ScoreSection, SectionType } from '@/lib/score-types.ts';

type Props = {
  score: Score;
  sectionId: string;
  onApply: (nextScore: Score, selectedSectionId: string) => void;
  onSelectSection?: (sectionId: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
};

const sectionNames: Record<SectionType, string> = {
  intro: '전주', verse: '절 (벌스)', prechorus: '후렴 전 (프리코러스)', chorus: '후렴',
  bridge: '브릿지', interlude: '간주', outro: '마무리',
};

function RangeFields({ score, section, onApply, onSelectSection, onError, disabled }: Omit<Props, 'sectionId'> & { section: ScoreSection }) {
  const [startMeasure, setStartMeasure] = useState(1);
  const [endMeasure, setEndMeasure] = useState(section.measures.length);
  const [label, setLabel] = useState(section.label);
  const [type, setType] = useState<SectionType>(section.type);
  const [error, setError] = useState('');
  const numbers = Array.from({ length: section.measures.length }, (_, index) => index + 1);
  const sectionOffset = score.sections.slice(0, score.sections.findIndex(candidate => candidate.id === section.id)).reduce((total, candidate) => total + candidate.measures.length, 0);

  function apply() {
    if (disabled) return;
    setError('');
    try {
      const result = assignSectionRange(score, { sectionId: section.id, startMeasure, endMeasure, label, type });
      onApply(result.score, result.selectedSectionId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '선택한 마디를 구간으로 지정하지 못했습니다.';
      setError(message);
      onError?.(message);
    }
  }

  return <section className="section-range-editor" aria-label="기존 마디로 구간 지정">
    <div className="panel-section-heading"><h3><Scissors size={14}/> 절·후렴 나누기</h3><HelpTip helpKey="sectionRange"/></div>
    <fieldset disabled={disabled} className="section-range-fields">
      {onSelectSection && <label className="modal-field">나눌 부분<select aria-label="나눌 부분" value={section.id} onChange={event => onSelectSection(event.target.value)}>{score.sections.map((candidate, index) => {
        const first = score.sections.slice(0, index).reduce((total, preceding) => total + preceding.measures.length, 0) + 1;
        return <option key={candidate.id} value={candidate.id}>{candidate.label} · {first}–{first + candidate.measures.length - 1}마디</option>;
      })}</select></label>}
      <div className="field-row">
        <label>시작 마디<select aria-label="구간 시작 마디" value={startMeasure} onChange={event => { const value = Number(event.target.value); setStartMeasure(value); if (value > endMeasure) setEndMeasure(value); setError(''); }}>{numbers.map(number => <option key={number} value={number}>{number + sectionOffset}마디</option>)}</select></label>
        <label>끝 마디<select aria-label="구간 끝 마디" value={endMeasure} onChange={event => { setEndMeasure(Number(event.target.value)); setError(''); }}>{numbers.filter(number => number >= startMeasure).map(number => <option key={number} value={number}>{number + sectionOffset}마디</option>)}</select></label>
      </div>
      <div className="field-row">
        <label>구간 이름<input aria-label="마디 구간 이름" placeholder="예: 1절, 후렴" maxLength={60} value={label} onChange={event => { setLabel(event.target.value); setError(''); }}/></label>
        <label>구간 종류<select aria-label="마디 구간 종류" value={type} onChange={event => { setType(event.target.value as SectionType); setError(''); }}>{Object.entries(sectionNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      </div>
      <button type="button" className="button outline full-width" disabled={disabled || !label.trim()} onClick={apply}><Scissors size={14}/>{startMeasure + sectionOffset}–{endMeasure + sectionOffset}마디를 구간으로 지정</button>
    </fieldset>
    {error && <p className="section-range-error local-text-error" role="alert">{error}</p>}
  </section>;
}

export function SectionRangeEditor({ score, sectionId, ...props }: Props) {
  const section = score.sections.find(candidate => candidate.id === sectionId);
  if (!section) return null;
  return <RangeFields key={`${section.id}:${section.measures.length}:${section.label}:${section.type}`} score={score} section={section} {...props}/>;
}

export default SectionRangeEditor;
