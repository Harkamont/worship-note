import { XMLParser } from 'fast-xml-parser';
import { analyzeMusicXML } from './musicxml-review.ts';
import type { MusicXMLReview, MusicXMLReviewChord, MusicXMLReviewEvent, MusicXMLReviewMeasure } from './musicxml-review.ts';

export interface MusicXMLRepairSelection {
  partId: string;
  /** One-based positions in the part, independent of MusicXML's printed number. */
  startMeasure: number;
  endMeasure: number;
}
export interface MusicXMLRepairTie {
  pitchMidi: number;
  voice: string;
  staff: string;
}
export interface MusicXMLRepairContext {
  version: 1;
  selection: MusicXMLRepairSelection;
  inheritedAttributes: { divisions: number | null; key: string[]; time: string[]; clef: string[] };
  measures: {
    ordinal: number;
    number: string;
    xml: string;
    implicit: boolean;
    expectedQuarterBeats: number | null;
    durationQuarterBeats: number | null;
    events: MusicXMLReviewEvent[];
    chords: MusicXMLReviewChord[];
  }[];
  boundaryTies: { incoming: MusicXMLRepairTie[]; outgoing: MusicXMLRepairTie[] };
}
export interface MusicXMLMeasureRepair {
  xml: string;
  originalXML: string;
  selection: MusicXMLRepairSelection;
  changedMeasureNumbers: string[];
  review: MusicXMLReview;
}

const MAX_REPAIR_BYTES = 128 * 1024;
const EPSILON = 1e-7;
const EDITABLE = new Set(['note', 'harmony', 'backup', 'forward']);
// Standard score headers may accompany an AI fragment. They are read under the
// same XML limits and discarded; the immutable source supplies all metadata.
const FRAGMENT_HEADERS = new Set(['work', 'movement-number', 'movement-title', 'identification', 'defaults', 'credit', 'part-list']);
type Span = { start: number; openEnd: number; closeStart: number; end: number; rawName: string };
type Node = { name: string; attrs: Record<string, string>; children: Node[]; text: string; span: Span };
type ScoreDocument = { xml: string; root: Node; review: MusicXMLReview };
const children = (node: Node, name: string) => node.children.filter(child => child.name === name);
const raw = (document: ScoreDocument, node: Node) => document.xml.slice(node.span.start, node.span.end);
const semantic = (node: Node): string => JSON.stringify([node.name, Object.entries(node.attrs).sort(([a], [b]) => a.localeCompare(b)), node.text.trim() ? node.text : '', node.children.map(semantic)]);
const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;

/** Locate parsed elements structurally, so only validated measure spans are replaced. */
function elementSpans(xml: string): Span[] {
  const spans: Span[] = [];
  const stack: Span[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) break;
    const terminator = xml.startsWith('<!--', start) ? '-->' : xml.startsWith('<![CDATA[', start) ? ']]>' : xml.startsWith('<?', start) ? '?>' : null;
    if (terminator) { cursor = xml.indexOf(terminator, start + 2) + terminator.length; continue; }
    let quote = '';
    let end = start + 1;
    for (; end < xml.length; end++) {
      if (quote) { if (xml[end] === quote) quote = ''; }
      else if (xml[end] === '"' || xml[end] === "'") quote = xml[end];
      else if (xml[end] === '>') break;
    }
    const tag = xml.slice(start, end + 1);
    cursor = end + 1;
    if (tag.startsWith('<!')) continue; // The bounded review parser already validated safe DTDs.
    if (tag.startsWith('</')) {
      const span = stack.pop();
      if (!span) throw new Error('XML 구조를 확인할 수 없습니다.');
      span.closeStart = start; span.end = end + 1;
    } else {
      const rawName = /^<([^\s/>]+)/.exec(tag)?.[1];
      if (!rawName) throw new Error('XML 태그 이름을 확인할 수 없습니다.');
      if (rawName.includes(':')) throw new Error('이 마디 교체는 접두사가 없는 MusicXML 태그만 지원합니다.');
      const span: Span = { start, openEnd: end + 1, closeStart: end + 1, end: end + 1, rawName };
      spans.push(span);
      if (!/\/\s*>$/.test(tag)) stack.push(span);
    }
  }
  return spans;
}

function readScore(xml: string): ScoreDocument {
  // Reuse the size/depth/node/entity checks before building a second representation.
  if (utf8Length(xml) > 2 * 1024 * 1024) throw new Error('XML 파일은 2MB 이하여야 합니다.');
  const parsingXML = xml.replace(/^\uFEFF/, '');
  const review = { ...analyzeMusicXML(parsingXML), xml };
  const spans = elementSpans(xml);
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
    parseAttributeValue: false, trimValues: false, removeNSPrefix: true, ignoreDeclaration: true, ignorePiTags: true, processEntities: true });
  const parsed = parser.parse(parsingXML) as Record<string, unknown>[];
  let index = 0;
  const convert = (entry: Record<string, unknown>): Node => {
    const name = Object.keys(entry).find(key => key !== ':@')!;
    const span = spans[index++];
    if (!span || span.rawName !== name) throw new Error('XML 항목과 원본 위치가 일치하지 않습니다.');
    const node: Node = { name, attrs: (entry[':@'] ?? {}) as Record<string, string>, children: [], text: '', span };
    const items = entry[name];
    if (Array.isArray(items)) for (const item of items as Record<string, unknown>[]) {
      if (Object.hasOwn(item, '#text')) node.text += String(item['#text']);
      else node.children.push(convert(item));
    }
    return node;
  };
  return { xml, review, root: convert(parsed[0]) };
}

function selectedPart(document: ScoreDocument, selection: MusicXMLRepairSelection) {
  if (!selection || typeof selection.partId !== 'string' || !selection.partId || !Number.isInteger(selection.startMeasure)
    || !Number.isInteger(selection.endMeasure) || selection.startMeasure < 1 || selection.endMeasure < selection.startMeasure) {
    throw new Error('파트와 마디의 시작·끝 순서를 확인해 주세요. 마디 위치는 1부터 시작하는 정수입니다.');
  }
  if (selection.endMeasure - selection.startMeasure >= 4) throw new Error('한 번에 최대 4마디만 다시 읽을 수 있습니다.');
  const parts = children(document.root, 'part');
  if (new Set(parts.map(part => part.attrs.id)).size !== parts.length) throw new Error('파트 ID가 중복되어 교체할 파트를 구분할 수 없습니다.');
  const part = parts.find(item => item.attrs.id === selection.partId);
  const review = document.review.parts.find(item => item.id === selection.partId);
  if (!part || !review) throw new Error('선택한 파트를 원본 XML에서 찾을 수 없습니다.');
  const measures = children(part, 'measure');
  if (selection.endMeasure > measures.length) throw new Error('선택한 마디가 원본 XML의 마디 수를 벗어납니다.');
  return { part, review, measures, selected: measures.slice(selection.startMeasure - 1, selection.endMeasure) };
}

function inheritedNodes(measures: Node[], before: number): Map<string, Map<string, Node>> {
  const state = new Map<string, Map<string, Node>>();
  for (const measure of measures.slice(0, before)) for (const attributes of children(measure, 'attributes')) {
    for (const child of attributes.children) if (['divisions', 'key', 'time', 'clef'].includes(child.name)) {
      const entries = state.get(child.name) ?? new Map<string, Node>();
      entries.set(child.attrs.number || '*', child); state.set(child.name, entries);
    }
  }
  return state;
}

function ties(measure: MusicXMLReviewMeasure | undefined, edge: 'incoming' | 'outgoing'): MusicXMLRepairTie[] {
  return (measure?.events ?? []).filter(event => event.pitchMidi !== null && !event.grace && (edge === 'incoming'
    ? event.tieStop && Math.abs(event.onsetQuarterBeats ?? Infinity) < EPSILON
    : event.tieStart && event.onsetQuarterBeats !== null && event.durationQuarterBeats !== null
      && Math.abs(event.onsetQuarterBeats + event.durationQuarterBeats - (measure?.durationQuarterBeats ?? Infinity)) < EPSILON))
    .map(event => ({ pitchMidi: event.pitchMidi!, voice: event.voice, staff: event.staff }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function repairContext(document: ScoreDocument, selection: MusicXMLRepairSelection): MusicXMLRepairContext {
  const selected = selectedPart(document, selection);
  const inherited = inheritedNodes(selected.measures, selection.startMeasure - 1);
  const asXML = (name: string) => [...(inherited.get(name)?.values() ?? [])].map(node => raw(document, node));
  const division = inherited.get('divisions')?.get('*')?.text.trim();
  const measures = selected.selected.map((node, index) => {
    const ordinal = selection.startMeasure + index;
    const measure = selected.review.measures[ordinal - 1];
    return { ordinal, number: measure.number, xml: raw(document, node), implicit: measure.implicit,
      expectedQuarterBeats: measure.expectedQuarterBeats, durationQuarterBeats: measure.durationQuarterBeats,
      events: measure.events, chords: measure.chords };
  });
  const context: MusicXMLRepairContext = { version: 1, selection: { partId: selection.partId, startMeasure: selection.startMeasure, endMeasure: selection.endMeasure }, inheritedAttributes: {
    divisions: division !== undefined && Number.isFinite(Number(division)) ? Number(division) : null,
    key: asXML('key'), time: asXML('time'), clef: asXML('clef'),
  }, measures, boundaryTies: { incoming: ties(selected.review.measures[selection.startMeasure - 2], 'outgoing'),
    outgoing: ties(selected.review.measures[selection.endMeasure], 'incoming') } };
  if (utf8Length(JSON.stringify(context)) > MAX_REPAIR_BYTES) throw new Error('선택 마디의 문맥 크기는 128KiB 이하여야 합니다. 범위를 줄여 주세요.');
  return context;
}

/** Contains only the chosen bars and notation/tie context, never the full score. */
export function createRepairContext(xml: string, selection: MusicXMLRepairSelection): MusicXMLRepairContext {
  return repairContext(readScore(xml), selection);
}

/** Recheck a server candidate locally; receipt metadata alone cannot prove its scope. */
export function validateMergedRepair(originalXML: string, selection: MusicXMLRepairSelection, mergedXML: string, expectedOriginalXML?: string): MusicXMLMeasureRepair {
  if (expectedOriginalXML !== undefined && expectedOriginalXML !== originalXML) throw new Error('검토 중 원본 악보가 변경되었습니다. 현재 원본으로 마디를 다시 읽어 주세요.');
  const candidate = readScore(mergedXML);
  const selected = selectedPart(candidate, selection).selected;
  const fragment = '<score-partwise version="4.0"><part id="' + escapeAttribute(selection.partId) + '">'
    + selected.map(node => raw(candidate, node)).join('') + '</part></score-partwise>';
  const verified = applyMeasureRepair(originalXML, selection, fragment, expectedOriginalXML);
  if (verified.xml !== mergedXML) throw new Error('수정안에서 선택하지 않은 원본 내용이나 마디 속성이 변경되었습니다.');
  return verified;
}

function reviewMarker(node: Node): boolean {
  if (node.name !== 'direction' || node.children.length !== 1 || node.children[0].name !== 'direction-type') return false;
  const content = node.children[0].children;
  return content.length === 1 && content[0].name === 'words' && /^chanyang-review-m\d+-beats-\d+(?:\.\d+)?$/.test(content[0].attrs.id || '');
}
const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&apos;');

function validateTieChains(measures: MusicXMLReviewMeasure[], incoming: MusicXMLRepairTie[], outgoing: MusicXMLRepairTie[]) {
  const key = (event: MusicXMLRepairTie) => JSON.stringify([event.staff, event.voice, event.pitchMidi]);
  const open = new Map(incoming.map(tie => [key(tie), { ...tie, end: 0 }]));
  const groups = new Map<string, { onset: number; voice: string; staff: string; events: MusicXMLReviewEvent[] }>();
  let offset = 0;
  for (const measure of measures) {
    for (const event of measure.events) {
      if ((event.tieStart || event.tieStop) && (event.grace || event.pitchMidi === null)) throw new Error('붙임줄은 길이가 있는 같은 음높이의 음표끼리 이어야 합니다.');
      if (event.grace) continue;
      const onset = offset + event.onsetQuarterBeats!;
      const id = JSON.stringify([onset, event.voice, event.staff]);
      const group = groups.get(id) ?? { onset, voice: event.voice, staff: event.staff, events: [] };
      group.events.push(event); groups.set(id, group);
    }
    offset += measure.durationQuarterBeats!;
  }
  for (const group of [...groups.values()].sort((a, b) => a.onset - b.onset)) {
    for (const tie of open.values()) if (tie.voice === group.voice && tie.staff === group.staff && tie.end <= group.onset + EPSILON) {
      if (Math.abs(tie.end - group.onset) > EPSILON || !group.events.some(event => event.pitchMidi === tie.pitchMidi && event.tieStop)) {
        throw new Error('붙임줄의 끝 음표가 없거나 음높이·음표 시작 시간이 맞지 않습니다.');
      }
    }
    for (const event of group.events) if (event.tieStop) {
      const id = key({ pitchMidi: event.pitchMidi!, staff: event.staff, voice: event.voice });
      const previous = open.get(id);
      if (!previous || Math.abs(previous.end - group.onset) > EPSILON) throw new Error('붙임줄의 시작 음표와 끝 음표가 맞지 않습니다.');
      open.delete(id);
    }
    for (const event of group.events) if (event.tieStart) {
      const tie = { pitchMidi: event.pitchMidi!, staff: event.staff, voice: event.voice };
      if (open.has(key(tie))) throw new Error('같은 음표의 붙임줄 시작 표시가 중복됩니다.');
      open.set(key(tie), { ...tie, end: group.onset + event.durationQuarterBeats! });
    }
  }
  if (open.size !== outgoing.length || outgoing.some(tie => !open.has(key(tie))) || [...open.values()].some(tie => Math.abs(tie.end - offset) > EPSILON)) {
    throw new Error('붙임줄이 다음 음표까지 이어지지 않습니다.');
  }
}

function mergedMeasure(source: ScoreDocument, original: Node, repair: ScoreDocument, proposed: Node, inherited: Map<string, Map<string, Node>>): string {
  const redundantAttribute = (child: Node) => {
    const previous = inherited.get(child.name)?.get(child.attrs.number || '*');
    return previous !== undefined && semantic(previous) === semantic(child);
  };
  const redundantBlock = (node: Node) => node.name === 'attributes' && !Object.keys(node.attrs).length && !node.text.trim()
    && node.children.length > 0 && node.children.every(redundantAttribute);
  const matchesAttributeBlock = (node: Node, expected: Node | undefined) => {
    if (node.name !== 'attributes' || expected?.name !== 'attributes') return false;
    let index = 0;
    const kept: Node[] = [];
    for (const child of node.children) {
      if (expected.children[index] && semantic(child) === semantic(expected.children[index])) { kept.push(child); index++; }
      else if (!redundantAttribute(child)) return false;
    }
    return index === expected.children.length && semantic({ ...node, children: kept }) === semantic(expected);
  };
  const protectedSource = original.children.filter(node => !EDITABLE.has(node.name) && !reviewMarker(node));
  const edits: { node: Node; value: string }[] = [];
  let protectedIndex = 0;
  const invalidMetadata = () => new Error('원본 마디의 속성·지시어·반복 표시를 보존해야 합니다. 선택한 음표·리듬·코드·가사만 고칠 수 있습니다.');
  for (const node of proposed.children) {
    if (reviewMarker(node)) { edits.push({ node, value: '' }); continue; }
    if (EDITABLE.has(node.name)) continue;
    const expected = protectedSource[protectedIndex];
    if (matchesAttributeBlock(node, expected)) {
      // Keep the exact original partial attribute block, dropping only verified
      // redundant inherited siblings needed to make the AI fragment standalone.
      edits.push({ node, value: raw(source, expected) }); protectedIndex++;
    } else if (redundantBlock(node)) edits.push({ node, value: '' });
    else if (expected && semantic(node) === semantic(expected)) protectedIndex++;
    else throw invalidMetadata();
  }
  if (protectedIndex !== protectedSource.length) throw invalidMetadata();
  const marked = original.children.some(reviewMarker);
  const implicit = proposed.attrs.implicit === 'yes';
  if (!marked && implicit !== (original.attrs.implicit === 'yes')) throw new Error('리듬 검사를 통과하려고 원본 마디의 implicit 못갖춘마디 표시를 바꿀 수 없습니다.');
  let inside = repair.xml.slice(proposed.span.openEnd, proposed.span.closeStart);
  for (const { node, value } of edits.sort((a, b) => b.node.span.start - a.node.span.start)) {
    const start = node.span.start - proposed.span.openEnd;
    const end = node.span.end - proposed.span.openEnd;
    inside = inside.slice(0, start) + value + inside.slice(end);
  }
  let opening = source.xml.slice(original.span.start, original.span.openEnd);
  if (marked && implicit !== (original.attrs.implicit === 'yes')) {
    const attrs = { ...original.attrs, implicit: implicit ? 'yes' : 'no' };
    opening = '<measure' + Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('') + '>';
  } else if (opening.endsWith('/>')) opening = opening.slice(0, -2) + '>';
  return opening + inside + '</measure>';
}

/** Normalize only equivalent units/header notation, then use the ordinary strict merge. */
function normalizeRepresentation(source: ScoreDocument, sourceMeasures: Node[], selection: MusicXMLRepairSelection, repair: ScoreDocument, proposed: Node[], staffCount: number): ScoreDocument {
  const known = new Set(['divisions', 'key', 'time', 'clef']);
  const stateKey = (node: Node) => node.name + ':' + (node.attrs.number || (node.name === 'clef' ? '1' : '*'));
  const initial = inheritedNodes(sourceMeasures, selection.startMeasure - 1);
  const providerState = new Map<string, Node>();
  for (const values of initial.values()) for (const node of values.values()) providerState.set(stateKey(node), node);
  const equivalent = (original: Node, candidate: Node) => {
    let left = original;
    let right = candidate;
    if (original.name === 'key' && !children(original, 'mode').length) {
      const modes = children(candidate, 'mode');
      if (modes.length > 1 || modes.some(mode => !['major', 'minor'].includes(mode.text.trim()))) return false;
      right = { ...candidate, children: candidate.children.filter(child => child.name !== 'mode') };
    }
    if (original.name === 'clef' && staffCount === 1) {
      const withoutDefaultNumber = (node: Node) => {
        const attrs = { ...node.attrs };
        if (attrs.number === '1') delete attrs.number;
        return { ...node, attrs };
      };
      left = withoutDefaultNumber(left); right = withoutDefaultNumber(right);
    }
    return semantic(left) === semantic(right);
  };
  const bars = proposed.map((candidate, index) => {
    const original = sourceMeasures[selection.startMeasure + index - 1];
    const originalAttributes = children(original, 'attributes');
    const candidateAttributes = children(candidate, 'attributes');
    for (const measure of [original, candidate]) {
      let timed = false;
      for (const child of measure.children) {
        if (EDITABLE.has(child.name)) timed = true;
        if (child.name === 'attributes' && timed) throw new Error('마디 중간의 속성 변경은 이 단위 변환에서 보존할 수 없습니다.');
      }
    }
    const expected = new Map<string, Node>();
    for (const values of inheritedNodes(sourceMeasures, selection.startMeasure + index - 1).values()) for (const node of values.values()) expected.set(stateKey(node), node);
    for (const attributes of originalAttributes) for (const child of attributes.children) if (known.has(child.name)) expected.set(stateKey(child), child);
    for (const attributes of candidateAttributes) {
      if (Object.keys(attributes.attrs).length && !originalAttributes.some(original => JSON.stringify(original.attrs) === JSON.stringify(attributes.attrs))) throw new Error('원본 attributes 속성을 보존해야 합니다.');
      for (const child of attributes.children) if (known.has(child.name)) providerState.set(stateKey(child), child);
    }
    for (const [id, originalNode] of expected) if (originalNode.name !== 'divisions') {
      const candidateNode = providerState.get(id);
      if (!candidateNode || !equivalent(originalNode, candidateNode)) throw new Error('원본의 조표·박자·음자리표 속성을 보존해야 합니다.');
    }
    for (const [id, candidateNode] of providerState) if (candidateNode.name !== 'divisions' && !expected.has(id)) throw new Error('원본에 없는 조표·박자·음자리표 속성을 추가할 수 없습니다.');
    const other = (attributes: Node[]) => attributes.flatMap(node => node.children).filter(node => !known.has(node.name)).map(semantic);
    if (JSON.stringify(other(originalAttributes)) !== JSON.stringify(other(candidateAttributes))) throw new Error('원본의 보표 수와 기타 attributes 속성을 보존해야 합니다.');
    const sourceDivisions = Number(expected.get('divisions:*')?.text.trim());
    const providerDivisions = Number(providerState.get('divisions:*')?.text.trim());
    if (![sourceDivisions, providerDivisions].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('단위 변환에는 양의 정수 divisions가 필요합니다.');
    const edits: { node: Node; value: string }[] = [];
    const attributesXML = originalAttributes.map(node => raw(source, node)).join('');
    candidateAttributes.forEach((node, index) => edits.push({ node, value: index === 0 ? attributesXML : '' }));
    for (const node of children(candidate, 'print')) edits.push({ node, value: '' });
    const convert = (node: Node) => {
      if ((node.name === 'duration' || node.name === 'offset') && sourceDivisions !== providerDivisions) {
        const value = Number(node.text.trim());
        if (node.children.length || !/^[+-]?\d+(?:\.0+)?$/.test(node.text.trim()) || !Number.isSafeInteger(value)) throw new Error('duration·offset 단위를 정확한 정수로 변환할 수 없습니다.');
        const numerator = BigInt(value) * BigInt(sourceDivisions);
        if (numerator % BigInt(providerDivisions) !== BigInt(0)) throw new Error('duration·offset 단위 변환 결과가 정수가 아닙니다.');
        const next = numerator / BigInt(providerDivisions);
        if (next > BigInt(Number.MAX_SAFE_INTEGER) || next < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('duration·offset 단위 변환 결과가 너무 큽니다.');
        edits.push({ node, value: repair.xml.slice(node.span.start, node.span.openEnd) + next.toString() + '</' + node.span.rawName + '>' });
      } else for (const child of node.children) convert(child);
    };
    for (const child of candidate.children) if (child.name !== 'attributes' && child.name !== 'print') convert(child);
    let inside = repair.xml.slice(candidate.span.openEnd, candidate.span.closeStart);
    for (const { node, value } of edits.sort((a, b) => b.node.span.start - a.node.span.start)) {
      inside = inside.slice(0, node.span.start - candidate.span.openEnd) + value + inside.slice(node.span.end - candidate.span.openEnd);
    }
    const layout = children(original, 'print').map(node => raw(source, node)).join('');
    if (!candidateAttributes.length) inside = attributesXML + inside;
    return repair.xml.slice(candidate.span.start, candidate.span.openEnd) + layout + inside + '</measure>';
  });
  return readScore('<score-partwise version="4.0"><part id="' + escapeAttribute(selection.partId) + '">' + bars.join('') + '</part></score-partwise>');
}

const sameTiming = (before: MusicXMLReviewMeasure, after: MusicXMLReviewMeasure) => JSON.stringify(before.events.map(event => [event.voice, event.staff, event.onsetQuarterBeats, event.durationQuarterBeats, event.chord, event.grace]))
  === JSON.stringify(after.events.map(event => [event.voice, event.staff, event.onsetQuarterBeats, event.durationQuarterBeats, event.chord, event.grace]));

/**
 * Build a review candidate from an immutable snapshot. No image-reading accuracy
 * is implied by passing these structural checks; a person must compare the crop.
 */
export function applyMeasureRepair(originalXML: string, selection: MusicXMLRepairSelection, repairXML: string, expectedOriginalXML?: string): MusicXMLMeasureRepair {
  if (expectedOriginalXML !== undefined && originalXML !== expectedOriginalXML) throw new Error('검토 중 원본 악보가 변경되었습니다. 현재 원본으로 마디를 다시 읽어 주세요.');
  if (utf8Length(repairXML) > MAX_REPAIR_BYTES) throw new Error('다시 읽은 XML 크기는 128KiB 이하여야 합니다.');
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(repairXML)) throw new Error('마디 교체 XML에는 DTD·엔터티 선언을 사용할 수 없습니다.');
  const source = readScore(originalXML);
  const target = selectedPart(source, selection);
  const context = repairContext(source, selection);
  let repair = readScore(repairXML);
  const repairParts = children(repair.root, 'part');
  if (repairParts.length !== 1 || repairParts[0].attrs.id !== selection.partId
    || repair.root.children.some(node => node.name !== 'part' && !FRAGMENT_HEADERS.has(node.name))) throw new Error('교체 XML에는 선택한 파트 하나와 선택한 마디만 있어야 합니다.');
  let proposed = children(repairParts[0], 'measure');
  if (repairParts[0].children.some(node => node.name !== 'measure') || proposed.length !== target.selected.length) throw new Error('교체 XML의 마디 수가 선택한 마디 수와 다릅니다.');
  if (proposed.some((measure, index) => measure.attrs.number !== context.measures[index].number)) throw new Error('교체 XML의 마디 번호와 순서가 원본 선택 범위와 다릅니다.');
  repair = normalizeRepresentation(source, target.measures, selection, repair, proposed, target.review.staffCount);
  proposed = children(children(repair.root, 'part')[0], 'measure');
  const replacements = proposed.map((measure, index) => mergedMeasure(source, target.selected[index], repair, measure,
    inheritedNodes(target.measures, selection.startMeasure + index - 1)));
  let xml = originalXML;
  for (let index = target.selected.length - 1; index >= 0; index--) {
    const { start, end } = target.selected[index].span;
    xml = xml.slice(0, start) + replacements[index] + xml.slice(end);
  }
  const result = readScore(xml);
  const updated = selectedPart(result, selection);
  // Number-based issue labels can repeat, so validate a temporary ordinal-labeled
  // copy of this part. That copy is never returned or stored as the user's score.
  let validationXML = xml;
  for (const [index, measure] of [...updated.measures.entries()].reverse()) {
    const attrs = { ...measure.attrs, number: String(index + 1) };
    const opening = '<measure' + Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('') + '>';
    const content = xml.slice(measure.span.openEnd, measure.span.closeStart);
    validationXML = validationXML.slice(0, measure.span.start) + opening + content + '</measure>' + validationXML.slice(measure.span.end);
  }
  const validation = analyzeMusicXML(validationXML.replace(/^\uFEFF/, ''));
  const invalidCodes = new Set(['MEASURE_UNDERFULL', 'NOTATED_DURATION_MISMATCH', 'MISSING_TIME_SIGNATURE', 'NON_METRIC_MEASURE', 'MULTIMETRIC_MEASURE', 'MID_MEASURE_TIME_CHANGE']);
  const issue = validation.issues.find(issue => {
    const ordinal = Number(issue.measure);
    if (issue.partId !== selection.partId || ordinal < selection.startMeasure || ordinal > selection.endMeasure) return false;
    if (issue.code === 'MEASURE_UNDERFULL') {
      const before = target.review.measures[ordinal - 1];
      const after = updated.review.measures[ordinal - 1];
      if (before.durationQuarterBeats !== null && before.expectedQuarterBeats !== null && before.durationQuarterBeats < before.expectedQuarterBeats - EPSILON && sameTiming(before, after)) return false;
    }
    return issue.severity === 'error' || invalidCodes.has(issue.code);
  });
  if (issue) throw new Error('교체 마디의 리듬·음표를 확인해 주세요: ' + issue.message);
  for (let index = selection.startMeasure - 1; index < selection.endMeasure; index++) {
    const before = target.review.measures[index];
    const after = updated.review.measures[index];
    if (!after.events.length || after.durationQuarterBeats === null || after.durationQuarterBeats <= 0 || after.expectedQuarterBeats === null) throw new Error('교체 마디의 음표와 박자 길이를 확인할 수 없습니다.');
    if (after.events.some(event => !target.review.voiceIds.includes(event.voice) || Number(event.staff) > target.review.staffCount)) throw new Error('선택한 파트에 없는 성부·보표를 추가할 수 없습니다.');
    const streams = (measure: MusicXMLReviewMeasure) => [...new Set(measure.events.map(event => JSON.stringify([event.staff, event.voice])))].sort();
    if (before.events.length && JSON.stringify(streams(before)) !== JSON.stringify(streams(after))) throw new Error('선택한 마디의 원본 성부·보표 구성을 바꿀 수 없습니다.');
    if (after.chords.some(chord => !/^\d+$/.test(chord.staff) || Number(chord.staff) < 1 || Number(chord.staff) > target.review.staffCount)) throw new Error('선택한 파트에 없는 보표에 코드를 추가할 수 없습니다.');
    if (after.chords.some(chord => (!chord.root && chord.kind !== 'none') || !chord.kind || chord.onsetQuarterBeats === null || chord.onsetQuarterBeats < -EPSILON || chord.onsetQuarterBeats >= after.durationQuarterBeats! - EPSILON)) throw new Error('코드의 근음·종류·마디 안 박 위치를 확인해 주세요.');
    const markerLengths = target.measures[index].children.filter(reviewMarker).map(marker => Number(marker.children[0].children[0].attrs.id.split('-beats-')[1]));
    if (markerLengths.length && (markerLengths.length !== 1 || !Number.isFinite(markerLengths[0]) || markerLengths[0] <= 0 || Math.abs(markerLengths[0] - after.durationQuarterBeats) > EPSILON)) throw new Error('리듬 검토 표시의 원본 마디 길이 ' + markerLengths[0] + '박을 유지해야 합니다.');
    if (before.implicit && Math.abs((before.durationQuarterBeats ?? Infinity) - after.durationQuarterBeats) > EPSILON) throw new Error('원본 못갖춘마디의 길이는 유지해야 합니다.');
    if (after.implicit && after.durationQuarterBeats >= after.expectedQuarterBeats - EPSILON) throw new Error('못갖춘마디의 음표 길이는 한 마디보다 짧아야 합니다.');
  }
  if (JSON.stringify(ties(updated.review.measures[selection.startMeasure - 1], 'incoming')) !== JSON.stringify(context.boundaryTies.incoming)
    || JSON.stringify(ties(updated.review.measures[selection.endMeasure - 1], 'outgoing')) !== JSON.stringify(context.boundaryTies.outgoing)) {
    throw new Error('교체 마디의 붙임줄·음높이가 선택하지 않은 앞뒤 마디의 붙임줄과 맞지 않습니다.');
  }
  validateTieChains(updated.review.measures.slice(selection.startMeasure - 1, selection.endMeasure), context.boundaryTies.incoming, context.boundaryTies.outgoing);
  // Verify every unselected measure semantically after merging. Source bytes
  // outside the identified selected spans were already copied without re-export.
  for (const [partIndex, originalPart] of children(source.root, 'part').entries()) {
    const resultPart = children(result.root, 'part')[partIndex];
    const originalMeasures = children(originalPart, 'measure');
    const resultMeasures = children(resultPart, 'measure');
    if (originalMeasures.length !== resultMeasures.length) throw new Error('선택하지 않은 마디 수가 바뀌었습니다.');
    for (const [index, measure] of originalMeasures.entries()) if (originalPart.attrs.id !== selection.partId || index + 1 < selection.startMeasure || index + 1 > selection.endMeasure) {
      if (semantic(measure) !== semantic(resultMeasures[index])) throw new Error('선택하지 않은 마디의 내용이 바뀌었습니다.');
    }
  }
  return { xml, originalXML, selection: { ...context.selection }, changedMeasureNumbers: context.measures.map(measure => measure.number), review: result.review };
}
