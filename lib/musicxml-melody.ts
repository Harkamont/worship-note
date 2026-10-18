import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { analyzeMusicXML, type MusicXMLReview, type MusicXMLReviewEvent, type MusicXMLReviewMeasure } from './musicxml-review.ts';
import { createCompatibleMusicXML } from './musicxml-compatible.ts';

/** `voice: '*'` explicitly selects staff melody extraction; other IDs stay exact. */
export interface MelodySelection { partId: string; staff: string; voice: string }
export interface MelodySource extends MelodySelection {
  partName: string;
  label: string;
  /** Physical note elements in the stream, including rests and chord tones. */
  noteCount: number;
  /** Measures containing at least one pitched note in this stream. */
  measureCoverage: number;
}
export interface MusicXMLMelodyResult {
  xml: string;
  warnings: string[];
  sourceNoteCount: number;
  melodyNoteCount: number;
  selection: MelodySelection;
}

type Entry = Record<string, unknown>;
type MappedNote = { node: Entry; event: MusicXMLReviewEvent; childIndex: number };
type MelodyGroup = { anchor: MappedNote; chosen: MappedNote; node: Entry; lyrics: MusicXMLReviewEvent['lyrics'] };
const EPSILON = 1e-7;
const options = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
  parseAttributeValue: false, trimValues: false, processEntities: true, ignoreDeclaration: true,
  ignorePiTags: true, commentPropName: '#comment', cdataPropName: '#cdata' };
const tag = (node: Entry) => Object.keys(node).find(key => key !== ':@') ?? '';
const local = (node: Entry) => tag(node).split(':').at(-1) ?? '';
const items = (node: Entry): Entry[] => Array.isArray(node[tag(node)]) ? node[tag(node)] as Entry[] : [];
const children = (node: Entry, name: string) => items(node).filter(child => local(child) === name);
const first = (node: Entry, name: string) => children(node, name)[0];
const text = (node?: Entry): string => node ? Object.hasOwn(node, '#text') ? String(node['#text']) : items(node).map(text).join('') : '';
const value = (node: Entry, name: string) => text(first(node, name)).trim();
const attrs = (node: Entry): Record<string, string> => (node[':@'] ?? {}) as Record<string, string>;
const clone = <T>(node: T): T => structuredClone(node);
const matches = (event: MusicXMLReviewEvent, selection: MelodySelection) => event.staff === selection.staff && (selection.voice === '*' || event.voice === selection.voice);
const equal = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) < EPSILON);
function number(raw: string, label: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw))) throw new Error(label + ': 숫자를 읽을 수 없습니다.');
  return Number(raw);
}
function element(name: string, body: Entry[] = [], attributes?: Record<string, string>): Entry {
  return { [name]: body, ...(attributes ? { ':@': attributes } : {}) };
}
function leaf(name: string, content: string): Entry { return element(name, [{ '#text': content }]); }
function setValue(node: Entry, name: string, content: string, prefix: string) {
  const child = first(node, name);
  if (child) child[tag(child)] = [{ '#text': content }];
  else items(node).push(leaf(prefix + name, content));
}

function sourcesFromReview(review: MusicXMLReview): MelodySource[] {
  const candidates: (MelodySource & { partOrder: number; soprano: boolean; median: number })[] = [];
  for (const [partOrder, part] of review.parts.entries()) {
    const streams = new Map<string, { staff: string; voice: string; notes: MusicXMLReviewEvent[]; measures: Set<number> }>();
    for (const measure of part.measures) for (const event of measure.events) {
      const key = JSON.stringify([event.staff, event.voice]);
      const stream = streams.get(key) ?? { staff: event.staff, voice: event.voice, notes: [], measures: new Set<number>() };
      stream.notes.push(event);
      if (event.pitchMidi !== null) stream.measures.add(measure.index);
      streams.set(key, stream);
    }
    for (const stream of streams.values()) {
      const pitches = stream.notes.flatMap(note => note.pitchMidi === null ? [] : [note.pitchMidi]).sort((a, b) => a - b);
      // Rest-only streams remain selectable and rank below pitched streams on the same staff.
      const median = pitches.length ? (pitches[Math.floor((pitches.length - 1) / 2)] + pitches[Math.floor(pitches.length / 2)]) / 2 : -Infinity;
      candidates.push({ partId: part.id, partName: part.name, staff: stream.staff, voice: stream.voice,
        label: `${part.name} · 보표 ${stream.staff} · 성부 ${stream.voice}`, noteCount: stream.notes.length,
        measureCoverage: stream.measures.size, partOrder, soprano: /soprano|소프라노|女高音|고음부/i.test(part.name), median });
    }
    for (const staff of new Set([...streams.values()].map(stream => stream.staff))) {
      const staffStreams = [...streams.values()].filter(stream => stream.staff === staff);
      if (staffStreams.length < 2) continue;
      candidates.push({ partId: part.id, partName: part.name, staff, voice: '*',
        label: `${part.name} · 보표 ${staff} · 선율 자동 추출`,
        noteCount: staffStreams.reduce((sum, stream) => sum + stream.notes.length, 0),
        measureCoverage: new Set(staffStreams.flatMap(stream => [...stream.measures])).size,
        partOrder, soprano: /soprano|소프라노|女高音|고음부/i.test(part.name), median: Infinity });
    }
  }
  return candidates.sort((a, b) => Number(b.soprano) - Number(a.soprano) || a.partOrder - b.partOrder
    || Number(a.staff) - Number(b.staff) || Number(b.voice === '*') - Number(a.voice === '*') || b.measureCoverage - a.measureCoverage || b.median - a.median
    || a.voice.localeCompare(b.voice, undefined, { numeric: true }))
    .map(({ partOrder, soprano, median, ...source }) => { void partOrder; void soprano; void median; return source; });
}

/** Exact streams remain selectable beside an explicit staff melody heuristic. */
export function listMusicXMLMelodySources(xml: string): MelodySource[] {
  return sourcesFromReview(analyzeMusicXML(xml));
}

function normalizedNote(chosen: MappedNote, anchor: MappedNote, lyricSources: MappedNote[], prefix: string): Entry {
  const output = clone(chosen.node);
  output[tag(output)] = items(output).filter(child => local(child) !== 'chord');
  const sameRhythm = equal(chosen.event.durationQuarterBeats, anchor.event.durationQuarterBeats) && chosen.event.grace === anchor.event.grace;
  if (chosen !== anchor && sameRhythm) {
    // Engraving belongs to the anchor in many OMR exports. Never copy its pitch,
    // duration, tie, stem or articulation to a different chord tone.
    for (const name of ['type', 'dot', 'time-modification', 'beam']) if (!first(output, name)) {
      items(output).push(...clone(children(anchor.node, name)));
    }
    const tuplets = children(anchor.node, 'notations').flatMap(notations => children(notations, 'tuplet'));
    if (tuplets.length && !children(output, 'notations').some(notations => first(notations, 'tuplet'))) {
      let notations = first(output, 'notations');
      if (!notations) { notations = element(prefix + 'notations'); items(output).push(notations); }
      items(notations).push(...clone(tuplets));
    }
  }
  const verseKey = (lyric: Entry) => attrs(lyric).number || '1';
  const present = new Set(children(output, 'lyric').map(verseKey));
  for (const source of lyricSources) for (const lyric of children(source.node, 'lyric')) if (!present.has(verseKey(lyric))) {
    items(output).push(clone(lyric)); present.add(verseKey(lyric));
  }
  setValue(output, 'voice', '1', prefix);
  setValue(output, 'staff', '1', prefix);
  return output;
}

function groupsForMeasure(node: Entry, measure: MusicXMLReviewMeasure, selection: MelodySelection, prefix: string, warnings: Set<string>): MelodyGroup[] {
  const physical = items(node).flatMap((child, childIndex) => local(child) === 'note' ? [{ node: child, childIndex }] : []);
  if (physical.length !== measure.events.length || measure.events.some((event, index) => event.index !== index)) {
    throw new Error(`${measure.number}마디: 원본 음표와 검사 결과의 순서를 연결할 수 없습니다.`);
  }
  const mapped = physical.map((note, index) => ({ ...note, event: measure.events[index] }));
  const allGroups: { anchor: MappedNote; tones: MappedNote[] }[] = [];
  let current: typeof allGroups[number] | undefined;
  let previousChild = -1;
  for (const note of mapped) {
    // backup / forward ends an anchor group, while comments and directions do not.
    if (items(node).slice(previousChild + 1, note.childIndex).some(child => ['backup', 'forward'].includes(local(child)))) current = undefined;
    if (!note.event.chord) { current = { anchor: note, tones: [note] }; allGroups.push(current); }
    else {
      if (!current) { if (matches(note.event, selection)) throw new Error(`${measure.number}마디: 기준 음표가 없는 화음은 추출할 수 없습니다.`); }
      else current.tones.push(note);
    }
    previousChild = note.childIndex;
  }
  const result: MelodyGroup[] = [];
  const previousEnds = new Map<string, number>();
  for (const group of allGroups) {
    const tones = group.tones.filter(note => matches(note.event, selection));
    if (!tones.length) continue;
    if (!matches(group.anchor.event, selection) || tones.some(note => note.event.voice !== group.anchor.event.voice || note.event.staff !== group.anchor.event.staff)) {
      throw new Error(`${measure.number}마디: 다른 보표·성부에 연결된 화음은 자동 추출할 수 없습니다.`);
    }
    if (tones.some(({ event }) => event.unpitched || (!event.rest && event.pitchMidi === null) || event.onsetQuarterBeats === null || event.durationQuarterBeats === null)) {
      throw new Error(`${measure.number}마디: 선택한 성부의 음높이·시간을 확인할 수 없습니다.`);
    }
    if (group.anchor.event.rest && tones.length > 1) throw new Error(`${measure.number}마디: 쉼표와 화음이 함께 있어 추출할 수 없습니다.`);
    const chosen = tones.reduce((best, note) => (note.event.pitchMidi ?? -Infinity) > (best.event.pitchMidi ?? -Infinity) ? note : best);
    if (!equal(chosen.event.onsetQuarterBeats, group.anchor.event.onsetQuarterBeats)) throw new Error(`${measure.number}마디: 화음의 시작 시간이 다릅니다.`);
    const onset = chosen.event.onsetQuarterBeats!;
    const previousEnd = previousEnds.get(chosen.event.voice) ?? 0;
    if (onset < previousEnd - EPSILON) throw new Error(`${measure.number}마디: 선택한 성부 음표의 시간이 겹칩니다. 원본 성부를 확인해 주세요.`);
    if (!chosen.event.grace) previousEnds.set(chosen.event.voice, onset + chosen.event.durationQuarterBeats!);
    // Verse text can be attached to any physical tone of this same chord group.
    // Keep the chosen tone first, then the anchor, then document-order tones.
    const lyricSources = [...new Set([chosen, group.anchor, ...tones])];
    const lyrics: MusicXMLReviewEvent['lyrics'] = [];
    const byVerse = new Map<string, MusicXMLReviewEvent['lyrics'][number]>();
    const lyricSignature = (lyric: MusicXMLReviewEvent['lyrics'][number]) => {
      const { name, ...notation } = lyric; void name;
      return JSON.stringify(notation);
    };
    for (const source of lyricSources) for (const lyric of source.event.lyrics) {
      const retained = byVerse.get(lyric.number);
      if (!retained) { const copy = clone(lyric); lyrics.push(copy); byVerse.set(lyric.number, copy); }
      else if (lyricSignature(retained) !== lyricSignature(lyric)) {
        warnings.add(`${measure.number}마디: 같은 화음의 ${lyric.number.slice(0, 48)}절 가사가 다르게 기록되어 있습니다. 선택한 고음, 기준 음표, 나머지 화음 음표 순서로 우선한 가사를 보존했습니다.`);
      }
    }
    result.push({ anchor: group.anchor, chosen, node: normalizedNote(chosen, group.anchor, lyricSources, prefix), lyrics });
  }
  return result;
}

/** Choose attacks, never slices of notes: a retained duration or explicit rest
 * blocks lower moving voices until it finishes. A voice ID is only a hint. */
function staffMelodyGroups(groups: MelodyGroup[], measure: MusicXMLReviewMeasure, state: { voice: string; tie: number | null }, warnings: Set<string>): MelodyGroup[] {
  const ordered = [...groups].sort((a, b) => a.chosen.event.onsetQuarterBeats! - b.chosen.event.onsetQuarterBeats!
    || Number(b.chosen.event.grace) - Number(a.chosen.event.grace) || a.anchor.childIndex - b.anchor.childIndex);
  const result: MelodyGroup[] = [];
  let end = 0;
  let active: MelodyGroup | undefined;
  const restNotice = `${measure.number}마디: 선율의 명시된 쉼표를 유지하고 다른 성부의 음표를 제외했습니다. 원본 선율의 쉼표를 확인해 주세요.`;
  for (let index = 0; index < ordered.length;) {
    const onset = ordered[index].chosen.event.onsetQuarterBeats!;
    const grace = ordered[index].chosen.event.grace;
    const simultaneous: MelodyGroup[] = [];
    while (index < ordered.length && equal(ordered[index].chosen.event.onsetQuarterBeats, onset) && ordered[index].chosen.event.grace === grace) simultaneous.push(ordered[index++]);
    if (onset < end - EPSILON) {
      if (active?.chosen.event.rest && simultaneous.some(group => group.chosen.event.pitchMidi !== null)) warnings.add(restNotice);
      if (simultaneous.some(group => (group.chosen.event.pitchMidi ?? -Infinity) > (active?.chosen.event.pitchMidi ?? Infinity))) {
        warnings.add(`${measure.number}마디: 지속 중인 선율과 겹치는 다른 성부의 고음을 제외했습니다. 긴 음을 자르지 않았으므로 원본 선율을 확인해 주세요.`);
      }
      continue;
    }
    const continuation = simultaneous.find(group => group.chosen.event.voice === state.voice);
    const tied = state.tie === null ? undefined : simultaneous.find(group => group.chosen.event.tieStop && group.chosen.event.pitchMidi === state.tie);
    const chosen = tied ?? (continuation?.chosen.event.rest ? continuation : undefined) ?? simultaneous.reduce((best, group) => {
      const pitch = group.chosen.event.pitchMidi ?? -Infinity;
      const bestPitch = best.chosen.event.pitchMidi ?? -Infinity;
      return pitch > bestPitch || (pitch === bestPitch && group.chosen.event.voice === state.voice) ? group : best;
    });
    if (chosen.chosen.event.rest && simultaneous.some(group => group.chosen.event.pitchMidi !== null)) warnings.add(restNotice);
    if (onset > end + EPSILON) warnings.add(`${measure.number}마디: 추출한 선율에 음표가 없는 빈 시간이 있습니다. 원본 시작 시간과 길이를 보존했으며 쉼표나 음표를 추가하지 않았습니다.`);
    if (chosen.chosen.event.voice !== state.voice) warnings.add(`${measure.number}마디: 선율 자동 추출 중 성부 ${state.voice}에서 성부 ${chosen.chosen.event.voice}의 음표로 바뀌었습니다. 원본 선율과 대조해 주세요.`);
    result.push(chosen);
    if (!grace) {
      end = onset + chosen.chosen.event.durationQuarterBeats!;
      active = chosen;
      state.voice = chosen.chosen.event.voice;
      state.tie = chosen.chosen.event.tieStart ? chosen.chosen.event.pitchMidi : null;
    }
  }
  if (end < measure.durationQuarterBeats! - EPSILON) warnings.add(`${measure.number}마디: 추출한 선율 끝에 음표가 없는 빈 시간이 있습니다. 원본 마디 길이를 보존했으며 쉼표나 음표를 추가하지 않았습니다.`);
  return result;
}

function normalizedAttributes(source: Entry, staff: string): Entry {
  const output = clone(source);
  const allStaff = new Set(['key', 'time', 'transpose', 'measure-style']);
  const oneStaff = new Set(['clef', 'staff-details']);
  output[tag(output)] = items(output).filter(child => {
    const name = local(child);
    if (name === 'part-symbol') return false;
    if (allStaff.has(name)) return !attrs(child).number || attrs(child).number === staff;
    if (oneStaff.has(name)) return (attrs(child).number || '1') === staff;
    return true;
  });
  for (const child of items(output)) {
    if (local(child) === 'staves') child[tag(child)] = [{ '#text': '1' }];
    if ((allStaff.has(local(child)) || oneStaff.has(local(child))) && attrs(child).number) attrs(child).number = '1';
  }
  return output;
}

function normalizeStaffReferences(node: Entry, staff: string) {
  if (local(node) === 'print' || local(node) === 'defaults') {
    node[tag(node)] = items(node).filter(child => local(child) !== 'staff-layout' || !attrs(child).number || attrs(child).number === staff);
  }
  for (const child of items(node)) {
    if (local(child) === 'staff' || local(child) === 'voice') child[tag(child)] = [{ '#text': '1' }];
    // Only these numbers identify staves. Slur, tied, verse and tuplet numbers do not.
    if (local(child) === 'staff-layout' && attrs(child).number) attrs(child).number = '1';
    normalizeStaffReferences(child, staff);
  }
}

function noteSignature(event: MusicXMLReviewEvent) {
  const { index, chord, voice, staff, ...music } = event; void index; void chord; void voice; void staff;
  return music;
}

/**
 * Make a separate one-stream copy without altering the original XML. Chord tops
 * are chosen only inside each selected voice/staff anchor group. Non-note nodes
 * stay at their original cursor time (and keep their original offsets) by using
 * explicit MusicXML time moves; this also handles a direction during a held note.
 */
export function extractMusicXMLMelody(xml: string, selection: MelodySelection): MusicXMLMelodyResult {
  // Security/size/depth/entity checks always happen before the second parser.
  const before = analyzeMusicXML(xml);
  if (!selection || typeof selection.partId !== 'string' || typeof selection.staff !== 'string' || typeof selection.voice !== 'string'
    || !sourcesFromReview(before).some(source => source.partId === selection.partId && source.staff === selection.staff && source.voice === selection.voice)) {
    throw new Error('추출할 파트·보표·성부를 명시적으로 선택해 주세요.');
  }
  if (before.parts.filter(part => part.id === selection.partId).length !== 1) throw new Error('파트 ID가 중복되어 선택한 성부를 구분할 수 없습니다.');
  if (before.parts.some(part => part.id !== selection.partId && part.measures.some(measure => measure.chords.length))) {
    throw new Error('다른 파트에 인쇄된 코드가 있어 코드 표시를 보존한 단일 파트로 자동 추출할 수 없습니다. 코드가 있는 파트를 선택하거나 원본을 사용해 주세요.');
  }
  const partReview = before.parts.find(part => part.id === selection.partId)!;
  const tree = new XMLParser(options).parse(xml) as Entry[];
  const root = tree.find(entry => local(entry) === 'score-partwise');
  if (!root) throw new Error('파트별 MusicXML 문서가 필요합니다.');
  const prefix = tag(root).includes(':') ? tag(root).slice(0, tag(root).lastIndexOf(':') + 1) : '';
  const partNode = children(root, 'part').find(part => attrs(part).id === selection.partId);
  if (!partNode) throw new Error('선택한 파트의 원본 XML을 찾을 수 없습니다.');
  const measures = children(partNode, 'measure');
  if (measures.length !== partReview.measures.length) throw new Error('원본 마디와 검사 결과를 연결할 수 없습니다.');
  const automatic = selection.voice === '*';
  const warnings = new Set<string>([automatic
    ? '선율 자동 추출은 같은 보표의 동시 시작 음표 중 고음을 고르고, 선택한 긴 음과 명시된 쉼표를 끝까지 보존합니다. 성부 번호가 바뀔 수 있으며 원본 이미지 대조가 필요합니다. 선택하지 않은 음표의 가사는 함께 제외합니다.'
    : '선택한 파트·보표·성부의 각 화음에서 가장 높은 음을 추출했습니다. 성부가 바뀌는 원본 인식 오류는 자동으로 고치지 않습니다.']);
  const melodyState = { voice: sourcesFromReview(before).find(source => source.partId === selection.partId && source.staff === selection.staff && source.voice !== '*')!.voice, tie: null as number | null };
  const retainedVoices = new Set<string>();
  const expectedNotes: MusicXMLReviewEvent[][] = [];
  let divisions = 0;
  let melodyNoteCount = 0;
  for (const [measureIndex, measureNode] of measures.entries()) {
    const measure = partReview.measures[measureIndex];
    if (measure.durationQuarterBeats === null) throw new Error(`${measure.number}마디: 원본 시간 정보를 계산할 수 없습니다.`);
    const candidates = groupsForMeasure(measureNode, measure, selection, prefix, warnings);
    const groups = automatic ? staffMelodyGroups(candidates, measure, melodyState, warnings) : candidates;
    for (const group of groups) retainedVoices.add(group.chosen.event.voice);
    expectedNotes.push(groups.map(group => {
      const event = clone(group.chosen.event);
      event.lyrics = clone(group.lyrics);
      return event;
    }));
    const byChild = new Map(groups.map(group => [group.anchor.childIndex, group]));
    const sourceChildren = items(measureNode);
    const output: Entry[] = [];
    const scheduled: { node: Entry; position: number; order: number; duration?: number }[] = [];
    let sourceCursor = 0;
    let outputCursor = 0;
    let noteIndex = 0;
    let progressed = false;
    const moveTo = (position: number) => {
      const delta = position - outputCursor;
      if (Math.abs(delta) < EPSILON) return;
      if (!Number.isFinite(position) || position < -EPSILON || divisions <= 0) throw new Error(`${measure.number}마디: 음표와 기호의 시간을 보존할 수 없습니다.`);
      // Repeated tuplets can yield 5.000000000000001 source units. Keep exact
      // integer MusicXML moves; refuse a genuinely fractional/unsafe new unit.
      const sourceUnits = Math.abs(delta) * divisions;
      const integerUnits = Math.round(sourceUnits);
      if (!Number.isSafeInteger(integerUnits) || integerUnits <= 0 || Math.abs(sourceUnits - integerUnits) > EPSILON) {
        throw new Error(`${measure.number}마디: 기호의 시간을 정수 divisions 단위로 표현할 수 없어 추출을 중단했습니다.`);
      }
      output.push(element(prefix + (delta < 0 ? 'backup' : 'forward'), [leaf(prefix + 'duration', String(integerUnits))]));
      outputCursor = position;
    };
    for (const [childIndex, child] of sourceChildren.entries()) {
      const name = local(child);
      if (name === 'note') {
        const event = measure.events[noteIndex++];
        const group = byChild.get(childIndex);
        if (group) {
          if (automatic) scheduled.push({ node: group.node, position: group.chosen.event.onsetQuarterBeats!, order: childIndex, duration: group.chosen.event.durationQuarterBeats! });
          else {
            moveTo(group.chosen.event.onsetQuarterBeats!);
            output.push(group.node);
            outputCursor += group.chosen.event.durationQuarterBeats!;
          }
          melodyNoteCount++;
        }
        if (!event.chord) sourceCursor = event.onsetQuarterBeats! + event.durationQuarterBeats!;
        progressed ||= sourceCursor > EPSILON;
      } else if (name === 'backup' || name === 'forward') {
        if (divisions <= 0) throw new Error(`${measure.number}마디: divisions 값이 없습니다.`);
        const delta = number(value(child, 'duration'), 'duration') / divisions;
        sourceCursor += name === 'backup' ? -delta : delta;
        if (sourceCursor < -EPSILON) throw new Error(`${measure.number}마디: 시간이 마디 시작보다 앞입니다.`);
        progressed ||= sourceCursor > EPSILON;
      } else {
        // A scoped octave-shift/dynamic belongs to its original stream. Moving
        // an omitted staff's direction onto staff 1 could change the melody.
        const directionVoice = name === 'direction' ? value(child, 'voice') : '';
        const selectedDirectionVoice = automatic ? groups.some(group => group.chosen.event.voice === directionVoice
          && group.chosen.event.onsetQuarterBeats! <= sourceCursor + EPSILON
          && group.chosen.event.onsetQuarterBeats! + group.chosen.event.durationQuarterBeats! >= sourceCursor - EPSILON) : directionVoice === selection.voice;
        if (name === 'direction' && ((value(child, 'staff') && value(child, 'staff') !== selection.staff)
          || (directionVoice && !selectedDirectionVoice))) continue;
        if (name === 'attributes' && first(child, 'divisions')) {
          const next = number(value(child, 'divisions'), 'divisions');
          if (next <= 0) throw new Error('divisions는 양수여야 합니다.');
          if (progressed && next !== divisions) throw new Error(`${measure.number}마디: 마디 안의 divisions 변경은 자동 추출을 지원하지 않습니다.`);
          // Move using the old unit before changing it, if there was already music.
          if (!automatic) moveTo(sourceCursor);
          divisions = next;
        } else if (!automatic) moveTo(sourceCursor);
        const retained = name === 'attributes' ? normalizedAttributes(child, selection.staff) : clone(child);
        if (name !== 'attributes') normalizeStaffReferences(retained, selection.staff);
        if (automatic) scheduled.push({ node: retained, position: sourceCursor, order: childIndex });
        else output.push(retained);
      }
    }
    // Voice streams can be interleaved in source order. Emit selected notes in
    // time order so ordinary contiguous melodies do not require time moves.
    if (automatic) {
      const notes = scheduled.filter(entry => entry.duration !== undefined).sort((a, b) => a.position - b.position
        || Number(Boolean(first(b.node, 'grace'))) - Number(Boolean(first(a.node, 'grace'))) || a.order - b.order);
      let nextNote = 0;
      for (const slot of scheduled.sort((a, b) => a.position - b.position || a.order - b.order)) {
        // Keep non-note ordering at a shared time, with grace notes before the
        // principal note even when another voice was written first in XML.
        const entry = slot.duration === undefined ? slot : notes[nextNote++];
        moveTo(entry.position);
        output.push(entry.node);
        outputCursor += entry.duration ?? 0;
      }
    }
    // Preserve the original extent, including explicit silence and shorter top
    // chord tones, without inventing rest notes or a new measure duration.
    moveTo(measure.durationQuarterBeats);
    measureNode[tag(measureNode)] = output;
    const sounding = groups.filter(group => !group.chosen.event.rest && !group.chosen.event.grace);
    for (const other of automatic ? [] : measure.events) {
      if (other.staff !== selection.staff || other.voice === selection.voice || other.pitchMidi === null || other.onsetQuarterBeats === null) continue;
      // Search an already ordered monophonic stream instead of comparing every
      // omitted note with every selected note (large XML remains bounded).
      let low = 0; let high = sounding.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (sounding[middle].chosen.event.onsetQuarterBeats! <= other.onsetQuarterBeats + EPSILON) low = middle + 1;
        else high = middle;
      }
      const candidate = sounding[low - 1];
      const active = candidate && candidate.chosen.event.onsetQuarterBeats! + candidate.chosen.event.durationQuarterBeats! > other.onsetQuarterBeats + EPSILON ? candidate : undefined;
      if (active && other.pitchMidi > active.chosen.event.pitchMidi! + EPSILON) {
        warnings.add(`${measure.number}마디: 같은 보표의 다른 성부에 선택한 선율보다 높은 음이 있습니다. 소프라노 성부가 원본에서 바뀌었는지 확인해 주세요.`);
        break;
      }
    }
  }
  for (const issue of before.issues) if (issue.code !== 'SOURCE_COMPARISON_REQUIRED') {
    warnings.add(`원본 검사${issue.partId ? ` ${issue.partId}` : ''}${issue.measure ? ` ${issue.measure}마디` : ''}: ${issue.message}`);
  }
  const partList = first(root, 'part-list');
  if (!partList || children(partList, 'score-part').filter(part => attrs(part).id === selection.partId).length !== 1) {
    throw new Error('선택한 파트의 악기·파트 정보를 하나로 확인할 수 없습니다.');
  }
  partList[tag(partList)] = items(partList).filter(child => local(child) === 'score-part' && attrs(child).id === selection.partId);
  root[tag(root)] = items(root).filter(child => local(child) !== 'part' || child === partNode);
  for (const defaults of children(root, 'defaults')) normalizeStaffReferences(defaults, selection.staff);
  const xmlCopy = '<?xml version="1.0" encoding="UTF-8"?>' + new XMLBuilder({ ...options, format: false, suppressEmptyNode: true }).build([root]);
  const outputXML = createCompatibleMusicXML(xmlCopy);
  const after = analyzeMusicXML(outputXML);
  const short = (content: string) => content.length > 48 ? content.slice(0, 45) + '…' : content;
  const streamLabel = (verse: MusicXMLReview['lyricVerses'][number]) => `${short(verse.partId)} · 보표 ${short(verse.staff)} · 성부 ${short(verse.voice)}`;
  const retainedVerses = new Set(after.lyricVerses.map(verse => verse.number));
  const missingVerses = before.lyricVerses.filter(verse => !retainedVerses.has(verse.number));
  if (missingVerses.length) {
    const numbers = [...new Set(missingVerses.map(verse => verse.number))];
    const labels = [...new Set(missingVerses.map(streamLabel))];
    throw new Error(`가사 ${numbers.slice(0, 8).map(short).join(', ')}절${numbers.length > 8 ? ` 외 ${numbers.length - 8}개 절` : ''}이 선택한 선율에서 모두 사라져 추출을 중단했습니다. 원본 ${labels.slice(0, 8).join('; ')}${labels.length > 8 ? ` 외 ${labels.length - 8}개 성부` : ''}의 가사는 다른 성부 음표로 자동 옮기지 않습니다. 원본 XML을 사용해 주세요.`);
  }
  const omittedLyricStreams = new Map<string, Set<string>>();
  for (const verse of before.lyricVerses) if (verse.partId !== selection.partId || verse.staff !== selection.staff || (automatic ? !retainedVoices.has(verse.voice) : verse.voice !== selection.voice)) {
    const label = streamLabel(verse);
    const numbers = omittedLyricStreams.get(label) ?? new Set<string>();
    numbers.add(verse.number); omittedLyricStreams.set(label, numbers);
  }
  for (const [label, numbers] of [...omittedLyricStreams].slice(0, 8)) {
    warnings.add(`${label}의 ${[...numbers].slice(0, 8).map(short).join(', ')}절${numbers.size > 8 ? ` 외 ${numbers.size - 8}개 절` : ''} 가사는 해당 성부와 함께 제외했습니다. 선택한 선율의 같은 절 가사만 보존했습니다.`);
  }
  if (omittedLyricStreams.size > 8) warnings.add(`그 밖의 ${omittedLyricStreams.size - 8}개 성부에 있는 가사도 함께 제외했습니다.`);
  if (after.partCount !== 1 || after.parts[0].staffCount !== 1 || after.measureCount !== partReview.measures.length || after.noteCount !== melodyNoteCount) {
    throw new Error('선율 복사본의 파트·보표·마디·음표 수가 달라져 결과를 거부했습니다.');
  }
  for (const [index, measure] of after.parts[0].measures.entries()) {
    const expected = expectedNotes[index];
    if (measure.events.length !== expected.length) throw new Error('추출 후 음표 수가 달라졌습니다.');
    for (const [eventIndex, event] of measure.events.entries()) {
      const original = expected[eventIndex];
      const { durationQuarterBeats: actualDuration, onsetQuarterBeats: actualOnset, ...actualMusic } = noteSignature(event);
      const { durationQuarterBeats: originalDuration, onsetQuarterBeats: originalOnset, ...originalMusic } = noteSignature(original);
      if (JSON.stringify(actualMusic) !== JSON.stringify(originalMusic) || !equal(actualDuration, originalDuration) || !equal(actualOnset, originalOnset)
        || event.chord || event.staff !== '1' || event.voice !== '1') {
        throw new Error(`${measure.number}마디: 추출 중 음높이·시간·붙임줄 정보가 달라져 결과를 거부했습니다.`);
      }
    }
    const originalChords = partReview.measures[index].chords.map(chord => ({ ...chord, staff: '1' }));
    if (JSON.stringify(measure.chords) !== JSON.stringify(originalChords)) throw new Error(`${measure.number}마디: 추출 중 코드 위치·내용이 달라져 결과를 거부했습니다.`);
  }
  let pendingTie: number | null = null;
  for (const measure of after.parts[0].measures) for (const event of measure.events) {
    if (event.grace) continue;
    if ((event.tieStop && pendingTie !== event.pitchMidi) || (pendingTie !== null && (!event.tieStop || pendingTie !== event.pitchMidi))) {
      warnings.add(`${measure.number}마디: 추출한 선율의 붙임줄을 연결할 같은 음이 없습니다. 원본 붙임줄과 성부 구분을 확인해 주세요.`);
    }
    pendingTie = event.tieStart ? event.pitchMidi : null;
  }
  if (pendingTie !== null) warnings.add('추출한 선율의 마지막 붙임줄에 이어지는 음이 없습니다. 원본 붙임줄과 성부 구분을 확인해 주세요.');
  return { xml: outputXML, warnings: [...warnings], sourceNoteCount: before.noteCount, melodyNoteCount, selection: { ...selection } };
}
