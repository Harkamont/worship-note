import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { analyzeMusicXML, type MusicXMLReview } from './musicxml-review.ts';

type Entry = Record<string, unknown>;
const MAX_BYTES = 2 * 1024 * 1024;
const options = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
  parseAttributeValue: false, trimValues: false, processEntities: true, commentPropName: '#comment', cdataPropName: '#cdata' };
const ORDERS: Record<string, string[]> = {
  attributes: ['divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part', 'directive', 'measure-style'],
  pitch: ['step', 'alter', 'octave'],
  note: ['grace', 'cue', 'chord', 'pitch', 'unpitched', 'rest', 'duration', 'tie', 'instrument', 'footnote', 'level', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric', 'play', 'listen'],
};
const name = (entry: Entry) => Object.keys(entry).find(key => key !== ':@') ?? '';
const local = (tag: string) => tag.split(':').at(-1) ?? '';
const prefix = (tag: string) => tag.includes(':') ? tag.slice(0, tag.lastIndexOf(':') + 1) : '';

function semanticSignature(review: MusicXMLReview): string {
  const { xml: unusedXML, issues, parts, ...summary } = review; void unusedXML;
  const sorted = <T>(values: T[]) => values.map(value => JSON.stringify(value)).sort();
  return JSON.stringify({ ...summary, issues: sorted(issues), parts: parts.map(part => ({ ...part,
    measures: part.measures.map(measure => ({ ...measure, changes: sorted(measure.changes) })),
  })) });
}

/** Locate the original declaration, comments, PIs and inert DTD. */
function rootStart(xml: string): number {
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) break;
    if (xml.startsWith('<!--', start)) { cursor = xml.indexOf('-->', start + 4) + 3; continue; }
    if (xml.startsWith('<?', start)) { cursor = xml.indexOf('?>', start + 2) + 2; continue; }
    if (!xml.startsWith('<!DOCTYPE', start)) return start;
    let quote = ''; let end = start + 9;
    for (; end < xml.length; end++) {
      const character = xml[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    cursor = end + 1;
  }
  throw new Error('MusicXML 문서 시작을 찾을 수 없습니다.');
}

/** Produce a separate download copy; never repair notes or mutate the source. */
export function createCompatibleMusicXML(xml: string): string {
  if (new TextEncoder().encode(xml).byteLength > MAX_BYTES) throw new Error('호환 XML은 2MB 이하여야 합니다.');
  const before = analyzeMusicXML(xml.replace(/^\uFEFF/, ''));
  const start = rootStart(xml);
  const tree = new XMLParser(options).parse(xml.slice(start)) as Entry[];
  const root = tree.find(entry => local(name(entry)) === 'score-partwise');
  if (!root) throw new Error('파트별 MusicXML 문서가 필요합니다.');
  const rootPrefix = prefix(name(root));
  const walk = (entries: Entry[], path: string[]) => {
    for (const entry of entries) {
      const tag = name(entry); const value = entry[tag];
      if (!Array.isArray(value)) continue;
      const children = value as Entry[];
      const current = prefix(tag) === rootPrefix ? local(tag) : tag;
      const here = [...path, current];
      const key = here.join('/');
      const order = key === 'score-partwise/part/measure/attributes' ? ORDERS.attributes
        : key === 'score-partwise/part/measure/note' ? ORDERS.note
        : key === 'score-partwise/part/measure/note/pitch' ? ORDERS.pitch : undefined;
      if (order) {
        const ranks = new Map(order.map((tag, index) => [tag, index]));
        const rank = (child: Entry) => prefix(name(child)) === rootPrefix ? ranks.get(local(name(child))) : undefined;
        const known = children.map((child, index) => ({ child, index, rank: rank(child) })).filter(value => value.rank !== undefined)
          .sort((a, b) => a.rank! - b.rank! || a.index - b.index);
        let next = 0;
        entry[tag] = children.map(child => rank(child) === undefined ? child : known[next++].child);
      }
      walk(entry[tag] as Entry[], here);
    }
  };
  walk(tree, []);
  // Browser downloads encode this string as UTF-8. Keep version/standalone and
  // the remaining prolog, but never retain an incompatible byte declaration.
  const prolog = xml.slice(0, start).replace(/^(\uFEFF?<\?xml\s[\s\S]*?\?>)/, declaration => declaration.replace(/\bencoding(\s*=\s*)(["'])([^"']*)\2/, (match, equals: string, quote: string, encoding: string) => /^utf-8$/i.test(encoding) ? match : `encoding${equals}${quote}UTF-8${quote}`));
  const output = prolog + new XMLBuilder({ ...options, format: false, suppressEmptyNode: true }).build(tree);
  if (new TextEncoder().encode(output).byteLength > MAX_BYTES) throw new Error('호환 XML은 2MB 이하여야 합니다.');
  const after = analyzeMusicXML(output.replace(/^\uFEFF/, ''));
  if (semanticSignature(before) !== semanticSignature(after)) throw new Error('XML 순서 정리 중 음표·코드·가사·검사 정보가 달라져 복사본을 거부했습니다.');
  return output;
}
