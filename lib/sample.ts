import type { Score, ScoreSection } from './score-types.ts';

/** Original exercise composed for this editor; no existing hymn melody or lyrics. */
export function createSampleScore(): Score {
  const specifications = [
    { label: 'V1', type: 'verse' as const, words: ['오늘하루', '주신은혜', '마음모아', '노래해요'], pitches: [['C4', 'D4', 'E4', 'G4'], ['A4', 'G4', 'E4', 'D4'], ['F4', 'E4', 'D4', 'G4'], ['E4', 'D4', 'C4', 'C4']], chords: ['C', 'F', 'G', 'C'] },
    { label: 'V2', type: 'verse' as const, words: ['작은손을', '서로잡고', '사랑나눠', '함께가요'], pitches: [['E4', 'G4', 'A4', 'G4'], ['F4', 'E4', 'D4', 'E4'], ['F4', 'G4', 'E4', 'D4'], ['E4', 'D4', 'C4', 'C4']], chords: ['C', 'Am', 'Dm7', 'G'] },
    { label: 'C', type: 'chorus' as const, words: ['감사해요', '나의주님', '밝은노래', '주께드려'], pitches: [['G4', 'G4', 'A4', 'G4'], ['E4', 'G4', 'C5', 'B4'], ['A4', 'G4', 'F4', 'E4'], ['D4', 'E4', 'D4', 'C4']], chords: ['C', 'C/E', 'F', 'G7'] },
    { label: 'B', type: 'bridge' as const, words: ['비가와도', '힘을내요', '주의말씀', '따라살래'], pitches: [['A4', 'G4', 'E4', 'A4'], ['G4', 'E4', 'D4', 'G4'], ['F4', 'G4', 'A4', 'F4'], ['G4', 'E4', 'D4', 'G4']], chords: ['Am', 'Em', 'F', 'Gsus4'] },
  ];
  const sections: ScoreSection[] = specifications.map((spec, sectionIndex) => ({
    id: 'section-' + sectionIndex,
    label: spec.label,
    type: spec.type,
    measures: spec.words.map((words, measureIndex) => ({
      id: 'measure-' + sectionIndex + '-' + measureIndex,
      chords: [{ id: 'chord-' + sectionIndex + '-' + measureIndex, beat: 1, symbol: spec.chords[measureIndex] }],
      notes: Array.from(words).map((lyric, noteIndex) => ({ id: 'note-' + sectionIndex + '-' + measureIndex + '-' + noteIndex, pitch: spec.pitches[measureIndex][noteIndex], duration: 'q', dots: 0, lyric, tie: false })),
    })),
  }));
  return {
    version: 1,
    title: '오늘의 찬양',
    artist: '직접 만든 연습곡',
    key: 'C',
    timeSignature: '4/4',
    tempo: 84,
    sections,
    form: [0, 1, 2, 3, 2].map((sectionIndex, index) => ({ id: 'form-' + index, sectionId: sections[sectionIndex].id, repeat: 1 })),
    warnings: [],
    source: 'sample',
  };
}

export function createBlankScore(): Score {
  return {
    version: 1,
    title: '새 악보',
    artist: '',
    key: 'C',
    timeSignature: '4/4',
    tempo: 84,
    sections: [{ id: 'blank-section', label: 'V1', type: 'verse', measures: [{ id: 'blank-measure', chords: [{ id: 'blank-chord', beat: 1, symbol: 'C' }], notes: [{ id: 'blank-note', pitch: null, duration: 'w', dots: 0, lyric: '', tie: false }] }] }],
    form: [{ id: 'blank-form', sectionId: 'blank-section', repeat: 1 }],
    warnings: [],
    source: 'manual',
  };
}
