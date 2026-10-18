import { validateScore } from './music.ts';
import type { FormEntry, Score, ScoreSection, SectionType } from './score-types.ts';

export type SectionRangeAssignment = {
  sectionId: string;
  /** One-based, inclusive measure numbers within the selected section. */
  startMeasure: number;
  endMeasure: number;
  label: string;
  type: SectionType;
};

/** Split only section/form metadata; musical measures and their IDs remain intact. */
export function assignSectionRange(
  score: Score,
  assignment: SectionRangeAssignment,
  idFactory: () => string = () => crypto.randomUUID(),
): { score: Score; selectedSectionId: string } {
  validateScore(score);
  const sectionIndex = score.sections.findIndex(section => section.id === assignment.sectionId);
  if (sectionIndex < 0) throw new Error('마디를 지정할 구간을 찾지 못했습니다.');
  const original = score.sections[sectionIndex];
  const { startMeasure, endMeasure, label, type } = assignment;
  if (!Number.isSafeInteger(startMeasure) || !Number.isSafeInteger(endMeasure) || startMeasure < 1 || endMeasure < startMeasure || endMeasure > original.measures.length) {
    throw new Error(`시작·끝 마디는 선택한 구간 안의 1~${original.measures.length}마디로 지정해 주세요.`);
  }
  const result = structuredClone(score);
  const source = result.sections[sectionIndex];
  if (startMeasure === 1 && endMeasure === source.measures.length) {
    source.label = label;
    source.type = type;
    validateScore(result);
    return { score: result, selectedSectionId: source.id };
  }
  for (const cut of [startMeasure - 1, endMeasure]) {
    if (cut > 0 && cut < source.measures.length && source.measures[cut - 1].notes.at(-1)?.tie) {
      throw new Error('붙임줄로 이어진 두 마디를 서로 다른 구간으로 나눌 수 없습니다. 붙임줄 전체가 포함되도록 마디를 선택해 주세요.');
    }
  }
  const usedLabels = new Set([...result.sections.filter(section => section.id !== source.id).map(section => section.label), label]);
  const remainderLabel = (position: '앞' | '뒤') => {
    let number = 1;
    let candidate: string;
    do {
      const suffix = ` (${position}${number === 1 ? '' : ` ${number}`})`;
      candidate = source.label.slice(0, 60 - suffix.length).trimEnd() + suffix;
      number++;
    } while (usedLabels.has(candidate));
    usedLabels.add(candidate);
    return candidate;
  };
  const selectedSectionId = idFactory();
  const fragments: ScoreSection[] = [];
  if (startMeasure > 1) fragments.push({ ...source, label: remainderLabel('앞'), measures: source.measures.slice(0, startMeasure - 1) });
  fragments.push({ id: selectedSectionId, label, type, measures: source.measures.slice(startMeasure - 1, endMeasure) });
  if (endMeasure < source.measures.length) fragments.push({ ...source, id: fragments.length > 1 ? idFactory() : source.id, label: remainderLabel('뒤'), measures: source.measures.slice(endMeasure) });
  result.sections.splice(sectionIndex, 1, ...fragments);
  result.form = result.form.flatMap(entry => {
    if (entry.sectionId !== source.id) return [entry];
    const expanded: FormEntry[] = [];
    for (let repeat = 0; repeat < entry.repeat; repeat++) for (const fragment of fragments) {
      expanded.push({ id: expanded.length === 0 ? entry.id : idFactory(), sectionId: fragment.id, repeat: 1 });
    }
    return expanded;
  });
  validateScore(result);
  return { score: result, selectedSectionId };
}
