import { validateScore } from './music.ts';
import type { Score } from './score-types.ts';

const SAFE_TEXT_PATTERN = '^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]*$';
const LYRIC_PATTERN = '^[^\\r\\n\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]*$';
// Mirror music.ts's suffix tokens without a repeated variable-length digit token.
// Token alternatives cannot split into other complete tokens; parentheses are
// nonnested and delimited, so bounded repetition does not create ambiguous runs.
const CHORD_TOKEN = '(?:maj|min|dim|aug|sus|add|omit|no|[#b♭♯][0-9]|[0-9mM°øΔ+\\-])';
const CHORD_TRIM = '[\\t\\r\\n \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';
const CHORD_PATTERN = '^' + CHORD_TRIM + '{0,39}(?:[Nn]\\.?[Cc]\\.?|[A-G][#b♭♯]?(?:' + CHORD_TOKEN + '|\\((?:' + CHORD_TOKEN + '|[, ]){1,38}\\)){0,39}(?:/[A-G][#b♭♯]?)?)' + CHORD_TRIM + '{0,39}$';

/** Annotation output deliberately has no fields for changing musical notation. */
export const ANNOTATION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'artist', 'warnings', 'measures'],
  properties: {
    title: { type: ['string', 'null'], minLength: 1, maxLength: 200, pattern: SAFE_TEXT_PATTERN },
    artist: { type: ['string', 'null'], maxLength: 200, pattern: SAFE_TEXT_PATTERN },
    warnings: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 500, pattern: SAFE_TEXT_PATTERN } },
    measures: {
      type: 'array', minItems: 1, maxItems: 512,
      items: {
        type: 'object', additionalProperties: false, required: ['measureId', 'lyrics', 'chords'],
        properties: {
          measureId: { type: 'string', minLength: 1, maxLength: 80, pattern: SAFE_TEXT_PATTERN },
          lyrics: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string', maxLength: 120, pattern: LYRIC_PATTERN } },
          chords: {
            type: 'array', maxItems: 32,
            items: {
              type: 'object', additionalProperties: false, required: ['beat', 'symbol'],
              properties: {
                beat: { type: 'number', minimum: 1, maximum: 24.75, multipleOf: 0.25 },
                symbol: { type: 'string', minLength: 1, maxLength: 40, pattern: CHORD_PATTERN },
              },
            },
          },
        },
      },
    },
  },
};

function strictObject(value: unknown, name: string, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(name + ': 객체가 필요합니다.');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key)) || fields.some(key => !Object.hasOwn(value, key))) {
    throw new Error(name + ': 허용된 필드를 모두 포함하고 다른 필드는 제외해야 합니다.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(name + ': 문자열 길이 또는 형식이 올바르지 않습니다.');
  }
  return value;
}

function array(value: unknown, name: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(name + ': 항목 수가 올바르지 않습니다.');
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) throw new Error(name + ': 비어 있는 항목이 있습니다.');
  return value;
}

/** Validate both inputs and replace only title, artist, note lyrics and chords. */
export function mergeScoreAnnotations(inputScore: unknown, patch: unknown): Score {
  const score = validateScore(inputScore);
  const root = strictObject(patch, '가사·코드 응답', ['title', 'artist', 'warnings', 'measures']);
  const title = root.title === null ? score.title : text(root.title, '제목', 200, false);
  const artist = root.artist === null ? score.artist : text(root.artist, '작곡·아티스트', 200);
  const warnings = array(root.warnings, '인식 참고사항', 100).map(value => text(value, '참고사항', 500));
  if (score.warnings.length + warnings.length > 100) throw new Error('기존·추가 참고사항의 합은 100개 이하여야 합니다.');

  const measures = new Map(score.sections.flatMap(section => section.measures.map(measure => [measure.id, measure] as const)));
  const patches = array(root.measures, '마디별 가사·코드', 512, 1);
  if (patches.length !== measures.size) throw new Error('기존의 모든 마디를 한 번씩 포함해야 합니다.');

  const usedIds = new Set(score.form.map(entry => entry.id));
  for (const section of score.sections) {
    usedIds.add(section.id);
    for (const measure of section.measures) {
      usedIds.add(measure.id);
      measure.notes.forEach(note => usedIds.add(note.id));
      measure.chords.forEach(chord => usedIds.add(chord.id));
    }
  }
  let chordSequence = 0;
  const nextChordId = (): string => {
    let id: string;
    do { id = 'annotation-chord-' + ++chordSequence; } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };

  const updatedMeasures = new Set<string>();
  for (const input of patches) {
    const update = strictObject(input, '마디별 가사·코드', ['measureId', 'lyrics', 'chords']);
    const measureId = text(update.measureId, '마디 ID', 80, false);
    const measure = measures.get(measureId);
    if (!measure || updatedMeasures.has(measureId)) throw new Error('마디 ID가 없거나 중복되었습니다.');
    updatedMeasures.add(measureId);
    const lyrics = array(update.lyrics, '음표별 가사', 64, 1);
    if (lyrics.length !== measure.notes.length) throw new Error('가사는 기존 음표 수와 일치해야 합니다.');
    measure.notes.forEach((note, index) => {
      const lyric = text(lyrics[index], '가사', 120);
      if (/[\r\n]/.test(lyric)) throw new Error('음표 가사는 한 줄이어야 합니다.');
      if (note.pitch === null && lyric !== '') throw new Error('쉼표의 가사는 비어 있어야 합니다.');
      note.lyric = lyric;
    });
    measure.chords = array(update.chords, '코드', 32).map(inputChord => {
      const chord = strictObject(inputChord, '코드', ['beat', 'symbol']);
      if (typeof chord.beat !== 'number' || !Number.isFinite(chord.beat) || chord.beat < 1 || chord.beat > 24.75 || !Number.isInteger((chord.beat - 1) * 4)) {
        throw new Error('코드는 마디 안의 16분음표 단위 박에 놓아야 합니다.');
      }
      return { id: nextChordId(), beat: chord.beat, symbol: text(chord.symbol, '코드 기호', 40, false) };
    });
  }
  score.title = title;
  score.artist = artist;
  score.warnings.push(...warnings);
  score.source = 'ai';
  return validateScore(score);
}
