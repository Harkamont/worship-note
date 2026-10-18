import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { analyzeMusicXML, type MusicXMLReview, type MusicXMLReviewEvent } from './musicxml-review.ts';
import { transposeChord } from './music.ts';

const MAX_XML = 2 * 1024 * 1024;
const MAX_MEASURES = 4096;
const MAX_NOTES = 2048;
const MAX_VERSES = 32;
type Entry = Record<string, unknown>;
type Verse = { number: string; syllables: string[] };
type Chord = { beat: number; symbol: string };
type Annotation = { title: string | null; artist: string | null; warnings: string[]; measures: { index: number; verses: Verse[]; chords: Chord[] }[] };
const options = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
  parseAttributeValue: false, trimValues: false, processEntities: true, commentPropName: '#comment', cdataPropName: '#cdata' };

export const XML_ANNOTATION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'artist', 'warnings', 'measures'],
  properties: {
    title: { type: ['string', 'null'], maxLength: 200 }, artist: { type: ['string', 'null'], maxLength: 200 },
    warnings: { type: 'array', maxItems: 128, items: { type: 'string', maxLength: 500 } },
    measures: { type: 'array', maxItems: MAX_MEASURES, items: {
      type: 'object', additionalProperties: false, required: ['index', 'verses', 'chords'], properties: {
        index: { type: 'integer', minimum: 1, maximum: MAX_MEASURES },
        verses: { type: 'array', maxItems: MAX_VERSES, items: {
          type: 'object', additionalProperties: false, required: ['number', 'syllables'], properties: {
            number: { type: 'string', minLength: 1, maxLength: 32 },
            syllables: { type: 'array', maxItems: MAX_NOTES, items: { type: 'string', maxLength: 120 } },
          },
        } },
        chords: { type: 'array', maxItems: 128, items: {
          type: 'object', additionalProperties: false, required: ['beat', 'symbol'], properties: {
            beat: { type: 'number', minimum: 1 }, symbol: { type: 'string', minLength: 1, maxLength: 40 },
          },
        } },
      },
    } },
  },
} as const;

export const XML_ANNOTATION_PROMPT = `Read only the supplied sheet-music image and add printed Korean/English lyrics and chord labels to the fixed MusicXML context. Return only the strict JSON annotation object.
Never invent or repair notes, pitch, rhythm, meter, key, tuplets, ties, repeats, parts, voices, measures or song form. Source music can contain errors: leave all of it fixed. Do not use song memory or guess missing lyrics/chords. Add uncertainty to warnings.
Each context measure.index is a GLOBAL 1-based index in part order, then measure order; printed measure numbers can repeat. Return EVERY measure index exactly once, even if verses/chords are empty. Each verse syllables array must have exactly the complete XML-note count in that measure, in the supplied 1-based note-index order, including all rests, grace/chord tones and secondary voices. Use empty string for every lyricEligible=false slot and for notes continuing an already sung syllable. Attach only text actually printed at that note. Do not shift lyrics to fill unused notes.
Include separately every printed verse using stable string verse numbers. Keep word-ending spaces in syllable strings to make natural TXT. Standalone engraving dashes, underscores and lyric extension marks are not lyric characters: use empty string instead. Preserve actual lyric punctuation. Existing MusicXML syllabic/extend/end-line metadata will be retained by the merger; do not return or change it.
Chord beat is 1-based QUARTER-note beats within the actual source measure extent, with fractional values allowed for tuplets. For example onset 2/3 is beat 1.6666666667. Read printed chord symbols only, including root accidental, suffix and optional slash bass. Preserve parentheses around an entire printed chord, for example (Bm7) or (Bm7/G); do not interpret them as permission to omit the label. Return a separate chord entry for each distinct printed label; never combine consecutive labels into one symbol. Do not infer harmony from the melody. Use null for title/artist when not clearly printed. Additional properties, note objects and changed note counts are forbidden.`;

function name(entry: Entry): string { return Object.keys(entry).find(key => key !== ':@') ?? ''; }
function local(entry: Entry): string { return name(entry).split(':').at(-1) ?? ''; }
function body(entry: Entry): Entry[] { const value = entry[name(entry)]; return Array.isArray(value) ? value as Entry[] : []; }
function children(entry: Entry, tag: string): Entry[] { return body(entry).filter(child => local(child) === tag); }
function first(entry: Entry, tag: string): Entry | undefined { return children(entry, tag)[0]; }
function content(entry?: Entry): string { return entry ? body(entry).map(child => Object.hasOwn(child, '#text') ? String(child['#text']) : content(child)).join('') : ''; }
function attrs(entry: Entry): Record<string, string> { return (entry[':@'] ?? {}) as Record<string, string>; }
function node(tag: string, contents: Entry[] = [], attributes: Record<string, string> = {}, reference?: Entry): Entry {
  const prefix = reference && name(reference).includes(':') ? name(reference).slice(0, name(reference).lastIndexOf(':') + 1) : '';
  return { [prefix + tag]: contents, ...(Object.keys(attributes).length ? { ':@': attributes } : {}) };
}
const text = (value: string): Entry => ({ '#text': value });
const childText = (tag: string, value: string, reference?: Entry) => node(tag, [text(value)], {}, reference);
function replaceChildren(entry: Entry, contents: Entry[]) { entry[name(entry)] = contents; }
function parse(xml: string): Entry[] { return new XMLParser(options).parse(xml) as Entry[]; }
function rootOf(tree: Entry[]): Entry { const root = tree.find(entry => local(entry) === 'score-partwise'); if (!root) throw new Error('파트별 MusicXML 문서가 필요합니다.'); return root; }
function record(value: unknown, keys: string[], label: string): Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  const result = value as Entry;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) throw new Error(`${label}에 허용되지 않은 항목 또는 누락이 있습니다.`);
  return result;
}
function string(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f\ufffe\uffff]/u.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error(`${label}의 문자 또는 길이가 올바르지 않습니다.`);
  return value;
}
function list(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} 개수가 올바르지 않습니다.`);
  return value;
}
function lyricText(value: unknown): string {
  const result = string(value, 120, '음절');
  return /^[\s\-‐‑‒–—―−﹘﹣－_＿]+$/u.test(result) ? '' : result;
}
function validate(value: unknown, measureCount: number): Annotation {
  const input = record(value, ['title', 'artist', 'warnings', 'measures'], '주석');
  const nullable = (value: unknown, label: string) => value === null ? null : string(value, 200, label);
  const seen = new Set<number>();
  const measures = list(input.measures, MAX_MEASURES, '마디').map(value => {
    const measure = record(value, ['index', 'verses', 'chords'], '마디'); const index = measure.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > measureCount || seen.has(index)) throw new Error('마디 인덱스가 누락되거나 중복되었습니다.');
    seen.add(index); const verseIds = new Set<string>();
    const verses = list(measure.verses, MAX_VERSES, '절').map(value => {
      const verse = record(value, ['number', 'syllables'], '절'); const number = string(verse.number, 32, '절 번호');
      if (!number.trim() || number !== number.trim() || verseIds.has(number)) throw new Error('절 번호가 비어 있거나 중복되었습니다.');
      verseIds.add(number); return { number, syllables: list(verse.syllables, MAX_NOTES, '음절').map(lyricText) };
    });
    const chords = list(measure.chords, 128, '코드').map(value => {
      const chord = record(value, ['beat', 'symbol'], '코드');
      if (typeof chord.beat !== 'number' || !Number.isFinite(chord.beat) || chord.beat < 1) throw new Error('코드 박 위치가 올바르지 않습니다.');
      const symbol = string(chord.symbol, 40, '코드 기호').trim(); parseSymbol(symbol);
      return { beat: chord.beat, symbol };
    });
    return { index, verses, chords };
  });
  if (measures.length !== measureCount) throw new Error('모든 원본 마디의 주석이 정확히 한 번 필요합니다.');
  return { title: nullable(input.title, '제목'), artist: nullable(input.artist, '작곡자'), warnings: list(input.warnings, 128, '경고').map(value => string(value, 500, '경고')), measures };
}
function parseSymbol(symbol: string) {
  const parenthesized = symbol.startsWith('(') && symbol.endsWith(')');
  let core = symbol;
  if (parenthesized) {
    let depth = 0;
    for (let index = 0; index < symbol.length; index++) {
      if (symbol[index] === '(') depth++;
      if (symbol[index] === ')') depth--;
      if (depth < 0 || (depth === 0 && index !== symbol.length - 1)) throw new Error('지원하지 않는 단일 코드 기호입니다.');
    }
    if (depth !== 0) throw new Error('지원하지 않는 단일 코드 기호입니다.');
    core = symbol.slice(1, -1).trim();
  }
  const normalized = core.replace(/♯/g, '#').replace(/♭/g, 'b');
  if (/^N\.?C\.?$/i.test(normalized)) return { parenthesized, chord: null };
  const match = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(normalized);
  const displayMatch = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(core);
  if (!match) throw new Error('지원하지 않는 단일 코드 기호입니다.');
  // Reuse the editor's single-chord grammar, retaining the original spelling.
  transposeChord(normalized, 0);
  return { parenthesized, chord: { root: match[1], alter: match[2], suffix: match[3], displaySuffix: displayMatch?.[3] ?? match[3], bass: match[4], bassAlter: match[5], displayBass: match[4] ? (displayMatch?.[4] ?? match[4]) + (displayMatch?.[5] ?? match[5]) : undefined } };
}
type ReviewedMeasure = MusicXMLReview['parts'][number]['measures'][number];
type LyricStream = { staff: string; voice: string };
function pitched(event: MusicXMLReviewEvent): event is MusicXMLReviewEvent & { pitchMidi: number } {
  return !event.rest && !event.grace && !event.chord && !event.unpitched && event.pitchMidi !== null && Number.isFinite(event.pitchMidi);
}
function primaryStream(measures: ReviewedMeasure[]): LyricStream | undefined {
  const staves = [...new Set(measures.flatMap(measure => measure.events.filter(pitched).map(event => event.staff)))];
  const staff = staves.includes('1') ? '1' : staves.filter(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0).sort((a, b) => Number(a) - Number(b))[0];
  if (!staff) return undefined;
  const voices = new Map<string, { measures: Set<number>; pitches: number[] }>();
  measures.forEach((measure, index) => {
    for (const event of measure.events) if (pitched(event) && event.staff === staff) {
      const value = voices.get(event.voice) ?? { measures: new Set<number>(), pitches: [] };
      value.measures.add(index); value.pitches.push(event.pitchMidi); voices.set(event.voice, value);
    }
  });
  const ranked = [...voices].map(([voice, value]) => {
    const pitches = value.pitches.sort((a, b) => a - b); const middle = Math.floor(pitches.length / 2);
    const median = pitches.length % 2 ? pitches[middle] : (pitches[middle - 1] + pitches[middle]) / 2;
    return { voice, coverage: value.measures.size, median };
  }).sort((a, b) => b.coverage - a.coverage || b.median - a.median || (/^\d+$/.test(a.voice) && /^\d+$/.test(b.voice) ? Number(a.voice) - Number(b.voice) : a.voice < b.voice ? -1 : a.voice > b.voice ? 1 : 0));
  return ranked[0] ? { staff, voice: ranked[0].voice } : undefined;
}
function lyricSlots(measure: ReviewedMeasure, primary?: LyricStream): Set<number> {
  const onsets = new Map<string, MusicXMLReviewEvent & { pitchMidi: number }>();
  if (primary) for (const event of measure.events) if (pitched(event) && event.voice === primary.voice && event.staff === primary.staff && event.onsetQuarterBeats !== null && Number.isFinite(event.onsetQuarterBeats)) {
    const onset = event.onsetQuarterBeats.toFixed(9); const previous = onsets.get(onset);
    if (!previous || event.pitchMidi > previous.pitchMidi) onsets.set(onset, event);
  }
  return new Set([...onsets.values()].map(event => event.index));
}
function sourceReview(xml: string) {
  const review = analyzeMusicXML(xml);
  if (!review.totalPartMeasures || review.totalPartMeasures > MAX_MEASURES || review.parts.some(part => part.measures.some(measure => measure.events.length > MAX_NOTES))) throw new Error('원본 마디 또는 음표 개수가 지원 범위를 벗어났습니다.');
  return review;
}

export function createXMLAnnotationContext(xml: string): string {
  const review = sourceReview(xml); let index = 0;
  return JSON.stringify({ version: 1, indexing: { measure: 'global 1-based, part order then physical measure order', note: '1-based, complete physical XML note order within the measure' },
    measures: review.parts.flatMap(part => {
      const primary = primaryStream(part.measures);
      return part.measures.map(measure => { const slots = lyricSlots(measure, primary); return { index: ++index, partId: part.id, partMeasureIndex: measure.index + 1, number: measure.number,
        actualQuarterBeats: measure.durationQuarterBeats, expectedQuarterBeats: measure.expectedQuarterBeats,
        lyricVoice: primary?.voice ?? null, lyricStaff: primary?.staff ?? null,
        notes: measure.events.map(event => ({ index: event.index + 1, pitchMidi: event.pitchMidi, duration: event.durationQuarterBeats,
          onset: event.onsetQuarterBeats, voice: event.voice, staff: event.staff, rest: event.rest, lyricEligible: slots.has(event.index) })) }; });
    }) });
}

function protectedTree(tree: Entry[]): string {
  function clean(entries: Entry[], parent = ''): Entry[] {
    return entries.flatMap(entry => {
      const tag = local(entry);
      if ((parent === 'measure' && tag === 'harmony') || (parent === 'note' && tag === 'lyric') || (parent === 'work' && tag === 'work-title')
        || (parent === 'score-partwise' && tag === 'movement-title') || (parent === 'identification' && tag === 'creator' && attrs(entry).type === 'composer')) return [];
      if (!Array.isArray(entry[name(entry)])) return [entry];
      const contents = clean(body(entry), tag);
      if (['work', 'identification'].includes(tag) && !contents.length && !Object.keys(attrs(entry)).length) return [];
      return [{ ...entry, [name(entry)]: contents }];
    });
  }
  return JSON.stringify(clean(tree));
}
function musicSignature(review: MusicXMLReview): string {
  return JSON.stringify(review.parts.map(part => ({ ...part, measures: part.measures.map(measure => ({ ...measure, chords: [], events: measure.events.map(event => ({ ...event, lyrics: [] })) })) })));
}
function titleArtist(root: Entry, title: string | null, artist: string | null) {
  if (title !== null) {
    let work = first(root, 'work');
    if (!work) { work = node('work', [], {}, root); body(root).unshift(work); }
    const previous = first(work, 'work-title');
    if (previous) replaceChildren(previous, [text(title)]); else body(work).push(childText('work-title', title, work));
    for (const movement of children(root, 'movement-title')) replaceChildren(movement, [text(title)]);
  }
  if (artist !== null) {
    let identification = first(root, 'identification');
    if (!identification) {
      identification = node('identification', [], {}, root);
      const index = body(root).findIndex(child => ['defaults', 'credit', 'part-list', 'part'].includes(local(child)));
      body(root).splice(index < 0 ? body(root).length : index, 0, identification);
    }
    const creators = children(identification, 'creator').filter(creator => attrs(creator).type === 'composer');
    if (creators.length) {
      replaceChildren(creators[0], [text(artist)]);
      replaceChildren(identification, body(identification).filter(child => !creators.slice(1).includes(child)));
    } else body(identification).unshift(node('creator', [text(artist)], { type: 'composer' }, identification));
  }
}
function addLyrics(note: Entry, verses: Verse[], position: number) {
  const originals = children(note, 'lyric'); const replacements: Entry[] = [];
  for (const verse of verses) {
    const previous = originals.find(entry => (attrs(entry).number || '1') === verse.number);
    const value = verse.syllables[position];
    if (!previous && !value) continue;
    const lyric = previous ? structuredClone(previous) : node('lyric', [], { number: verse.number }, note);
    const contents = body(lyric); const insertion = contents.findIndex(child => ['text', 'elision'].includes(local(child)));
    const kept = contents.filter(child => !['text', 'elision'].includes(local(child)));
    if (value) {
      const at = insertion >= 0 ? Math.min(insertion, kept.length) : kept.findIndex(child => local(child) !== 'syllabic');
      kept.splice(at < 0 ? kept.length : at, 0, childText('text', value, lyric));
    }
    replaceChildren(lyric, kept); if (kept.length) replacements.push(lyric);
  }
  const kept = body(note).filter(child => local(child) !== 'lyric');
  const afterLyrics = kept.findIndex(child => ['play', 'listen'].includes(local(child)));
  kept.splice(afterLyrics < 0 ? kept.length : afterLyrics, 0, ...replacements); replaceChildren(note, kept);
}
function harmony(chord: Chord, divisions: number, measure: Entry): Entry {
  const { chord: parsed, parenthesized } = parseSymbol(chord.symbol);
  const pitch = (tag: string, step: string, alter: string, displayStep?: string, hideAlter = false) => node(tag, [node(tag + '-step', [text(step)], displayStep === undefined ? {} : { text: displayStep }, measure), ...(alter ? [node(tag + '-alter', [text(alter === '#' ? '1' : '-1')], hideAlter ? { 'print-object': 'no' } : {}, measure)] : [])], {}, measure);
  const kinds: Record<string, string> = { '': 'major', m: 'minor', min: 'minor', maj: 'major', M: 'major', '7': 'dominant', m7: 'minor-seventh', maj7: 'major-seventh', M7: 'major-seventh', dim: 'diminished', dim7: 'diminished-seventh', '°': 'diminished', '°7': 'diminished-seventh', aug: 'augmented', '+': 'augmented', sus2: 'suspended-second', sus4: 'suspended-fourth', '6': 'major-sixth', m6: 'minor-sixth', '9': 'dominant-ninth', maj9: 'major-ninth', m9: 'minor-ninth', '11': 'dominant-11th', '13': 'dominant-13th', m7b5: 'half-diminished', 'ø7': 'half-diminished' };
  let kind = parsed ? kinds[parsed.suffix] || 'other' : 'none';
  const degrees: Entry[] = [];
  const degree = (value: number, alter: number, type: 'add' | 'alter') => node('degree', [childText('degree-value', String(value), measure), childText('degree-alter', String(alter), measure), childText('degree-type', type, measure)], { 'print-object': 'no' }, measure);
  if (parsed) {
    const suffix = parsed.suffix.replace(/^min/, 'm').replace(/^-/, 'm').replace(/^Δ/, 'maj');
    if (suffix === 'm7(b5)') kind = 'half-diminished';
    else if (/^7sus[24]$/.test(suffix)) { kind = suffix.endsWith('2') ? 'suspended-second' : 'suspended-fourth'; degrees.push(degree(7, -1, 'add')); }
    else if (kinds[suffix]) kind = kinds[suffix];
    else {
      const added = /^(m|maj|M)?add(2|4|6|9|11|13)$/.exec(suffix);
      const altered = /^([^()]*)\(([#b]?\d+(?:\s*,\s*[#b]?\d+)*)\)$/.exec(suffix);
      if (added) { kind = kinds[added[1] || '']; degrees.push(degree(Number(added[2]), 0, 'add')); }
      else if (altered && kinds[altered[1]]) {
        const tokens = altered[2].split(',').map(token => /^([#b]?)(\d+)$/.exec(token.trim())!);
        if (tokens.every(token => Number(token[2]) >= 1 && Number(token[2]) <= 13)) {
          kind = kinds[altered[1]];
          const existing = new Set([1, 3, 5]);
          if (kind === 'dominant' || /seventh|ninth|11th|13th/.test(kind)) existing.add(7);
          if (/ninth|11th|13th/.test(kind)) existing.add(9);
          if (/11th|13th/.test(kind)) existing.add(11);
          if (/13th/.test(kind)) existing.add(13);
          degrees.push(...tokens.map(token => degree(Number(token[2]), token[1] === '#' ? 1 : token[1] === 'b' ? -1 : 0, existing.has(Number(token[2])) ? 'alter' : 'add')));
        }
      }
    }
  }
  const contents: Entry[] = parsed ? [pitch('root', parsed.root, parsed.alter, parenthesized ? '(' + parsed.root : undefined), node('kind', [text(kind)], { text: parsed.displaySuffix + (parenthesized && !parsed.bass ? ')' : '') }, measure), ...(parsed.bass ? [pitch('bass', parsed.bass, parsed.bassAlter, parenthesized ? parsed.displayBass + ')' : undefined, parenthesized && Boolean(parsed.bassAlter))] : []), ...degrees]
    : [node('root', [node('root-step', [text('C')], { text: '' }, measure)], {}, measure), node('kind', [text('none')], { text: chord.symbol }, measure)];
  const offset = (chord.beat - 1) * divisions;
  if (!Number.isFinite(offset)) throw new Error('코드 위치를 원본 divisions로 계산할 수 없습니다.');
  contents.push(childText('offset', String(offset), measure)); return node('harmony', contents, {}, measure);
}

/** Add only text/harmony annotations; source semantic music errors are retained. */
export function mergeMusicXMLAnnotations(xml: string, annotations: unknown): string {
  const before = sourceReview(xml); const annotation = validate(annotations, before.totalPartMeasures);
  const tree = parse(xml); const protectedBefore = protectedTree(tree); const root = rootOf(tree);
  titleArtist(root, annotation.title, annotation.artist);
  let globalIndex = 0;
  for (const [partIndex, part] of children(root, 'part').entries()) {
    const reviewedPart = before.parts[partIndex]; const primary = primaryStream(reviewedPart.measures);
    let divisions: number | null = null;
    for (const [measureIndex, measure] of children(part, 'measure').entries()) {
      globalIndex++;
      const input = annotation.measures.find(entry => entry.index === globalIndex)!;
      const reviewed = reviewedPart.measures[measureIndex]; const notes = children(measure, 'note');
      const slots = lyricSlots(reviewed, primary);
      if (notes.length !== reviewed.events.length || input.verses.some(verse => verse.syllables.length !== notes.length)) throw new Error('각 절의 음절 개수는 원본 XML 음표 개수와 같아야 합니다.');
      for (let index = 0; index < notes.length; index++) {
        if (!slots.has(index)) {
          if (input.verses.some(verse => verse.syllables[index] !== '')) throw new Error('쉼표·보조 성부·화음 추가음·꾸밈음의 가사 칸은 비워야 합니다.');
          continue;
        }
        addLyrics(notes[index], input.verses, index);
      }
      const extent = reviewed.durationQuarterBeats;
      if (input.chords.length && (extent === null || extent <= 0 || input.chords.some(chord => chord.beat - 1 >= extent))) throw new Error('코드는 원본 마디의 실제 길이 안에 있어야 합니다.');
      const kept = body(measure).filter(child => local(child) !== 'harmony');
      let insertion = kept.findIndex(child => ['note', 'backup', 'forward'].includes(local(child)));
      if (insertion < 0) insertion = kept.length;
      let initialDivisions = divisions;
      for (const [index, child] of kept.entries()) if (local(child) === 'attributes' && first(child, 'divisions')) {
        const raw = Number(content(first(child, 'divisions')).trim()); divisions = Number.isFinite(raw) && raw > 0 ? raw : null;
        if (index < insertion) initialDivisions = divisions;
      }
      if (input.chords.length && initialDivisions === null) throw new Error('코드 위치를 계산할 원본 divisions 값이 없습니다.');
      kept.splice(insertion, 0, ...[...input.chords].sort((a, b) => a.beat - b.beat).map(chord => harmony(chord, initialDivisions!, measure)));
      replaceChildren(measure, kept);
    }
  }
  const output = new XMLBuilder({ ...options, format: false, suppressEmptyNode: true }).build(tree) as string;
  if (new TextEncoder().encode(output).byteLength > MAX_XML) throw new Error('완성 XML은 2MB 이하여야 합니다.');
  const after = analyzeMusicXML(output);
  if (protectedTree(parse(output)) !== protectedBefore || musicSignature(after) !== musicSignature(before)) throw new Error('주석 병합 중 원본 음악 구조가 변경되어 결과를 거부했습니다.');
  return output;
}
