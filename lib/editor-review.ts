import { durationBeats, measureBeats } from './music.ts';
import type { Score, ScoreMeasure } from './score-types.ts';

/** Editing a rhythm can take several steps. Keep the intermediate notes intact
 * and identify the mismatch instead of failing local project persistence. */
export function withRhythmReview(measure: ScoreMeasure, timeSignature: string): ScoreMeasure {
  const rest = { ...measure };
  delete rest.rhythmReview;
  const beats = measure.notes.reduce((sum, note) => sum + durationBeats(note), 0);
  const expected = measureBeats(measure, timeSignature);
  const chordIssue = measure.chords.some(chord => chord.beat < 1 || chord.beat >= expected + 1);
  return Math.abs(beats - expected) > 0.000001 || chordIssue ? { ...rest, rhythmReview: true } : rest;
}

export function scoreRhythmIssues(score: Score) {
  let number = 0;
  return score.sections.flatMap(section => section.measures.flatMap(measure => {
    number++;
    const beats = measure.notes.reduce((sum, note) => sum + durationBeats(note), 0);
    const expected = measureBeats(measure, score.timeSignature);
    const chordIssue = measure.chords.some(chord => chord.beat < 1 || chord.beat >= expected + 1);
    return Math.abs(beats - expected) > 0.000001 || chordIssue ? [{ sectionId: section.id, measureId: measure.id, number, beats, expected }] : [];
  }));
}
