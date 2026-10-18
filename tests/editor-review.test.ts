import test from 'node:test';
import assert from 'node:assert/strict';
import { withRhythmReview, scoreRhythmIssues } from '../lib/editor-review.ts';
import { createEmptyMeasure } from '../lib/editor.ts';
import { createBlankScore } from '../lib/sample.ts';

test('editing a pickup marks only a real rhythm mismatch and clears it after repair', () => {
  const pickup = createEmptyMeasure('4/4', 1);
  const edited = withRhythmReview({ ...pickup, notes: [{ ...pickup.notes[0], duration: 'h' }] }, '4/4');
  assert.equal(edited.rhythmReview, true);
  assert.equal(edited.actualBeats, 1);
  assert.equal(edited.notes[0].duration, 'h');
  const repaired = withRhythmReview({ ...edited, notes: [{ ...edited.notes[0], duration: 'q' }] }, '4/4');
  assert.equal(repaired.rhythmReview, undefined);
  assert.equal(repaired.actualBeats, 1);
});

test('review navigation uses whole-score numbering across section ranges', () => {
  const score = createBlankScore();
  const full = createEmptyMeasure('4/4');
  const bad = withRhythmReview(createEmptyMeasure('4/4', 1), '4/4');
  delete bad.actualBeats;
  const marked = withRhythmReview(bad, '4/4');
  score.sections[0].measures = [full];
  score.sections.push({ ...score.sections[0], id: 'next', label: '후렴', measures: [marked] });
  assert.deepEqual(scoreRhythmIssues(score), [{ sectionId: 'next', measureId: marked.id, number: 2, beats: 1, expected: 4 }]);
});

test('a retained chord beyond a newly repaired rhythm keeps the correction marker', () => {
  const full = createEmptyMeasure('4/4');
  const edited = withRhythmReview({ ...full, rhythmReview: true, chords: [{ id: 'late', symbol: 'G', beat: 5 }] }, '4/4');
  assert.equal(edited.rhythmReview, true);
  assert.equal(edited.chords[0].beat, 5);
  const repaired = withRhythmReview({ ...edited, chords: [{ ...edited.chords[0], beat: 4 }] }, '4/4');
  assert.equal(repaired.rhythmReview, undefined);
});
