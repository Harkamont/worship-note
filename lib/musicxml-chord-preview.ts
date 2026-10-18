import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { analyzeMusicXML } from './musicxml-review.ts';
type Entry = Record<string, unknown>;
const options = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true, commentPropName: '#comment', cdataPropName: '#cdata' };
const name = (entry: Entry) => Object.keys(entry).find(key => key !== ':@') ?? '';
const local = (entry: Entry) => name(entry).split(':').at(-1) ?? '';
const body = (entry: Entry): Entry[] => Array.isArray(entry[name(entry)]) ? entry[name(entry)] as Entry[] : [];
const attrs = (entry: Entry): Record<string,string> => (entry[':@'] ?? {}) as Record<string,string>;
const children = (entry: Entry, tag: string) => body(entry).filter(node => local(node) === tag);
const first = (entry: Entry, tag: string) => children(entry, tag)[0];
function content(entry?: Entry): string { return entry ? body(entry).map(node => Object.hasOwn(node, '#text') ? String(node['#text']) : content(node)).join('') : ''; }
const kinds: Record<string,string> = {major:'',minor:'m',augmented:'aug',diminished:'dim',dominant:'7','major-seventh':'maj7','minor-seventh':'m7','diminished-seventh':'dim7','augmented-seventh':'aug7','half-diminished':'m7b5','major-minor':'mMaj7','major-sixth':'6','minor-sixth':'m6','dominant-ninth':'9','major-ninth':'maj9','minor-ninth':'m9','dominant-11th':'11','major-11th':'maj11','minor-11th':'m11','dominant-13th':'13','major-13th':'maj13','minor-13th':'m13','suspended-second':'sus2','suspended-fourth':'sus4',power:'5'};
function accidental(value: string) { const n = Number(value || 0); return Number.isInteger(n) && Math.abs(n) <= 4 ? n > 0 ? '#'.repeat(n) : 'b'.repeat(-n) : `[${value}]`; }
function pitch(entry: Entry, tag: 'root'|'bass') {
  const step = first(entry, tag + '-step');
  const alter = first(entry, tag + '-alter');
  return (step && attrs(step).text !== undefined ? attrs(step).text : content(step).trim()) + (alter && attrs(alter)['print-object'] !== 'no' ? accidental(content(alter).trim()) : '');
}
function label(harmony: Entry): string | null {
  // Existing numeral/function notation already has its own literal text. Avoid
  // flattening polychords or non-root harmonic analyses into a different chord.
  if (children(harmony,'root').length !== 1 || children(harmony,'kind').length !== 1 || children(harmony,'numeral').length || children(harmony,'function').length) return null;
  const root = first(harmony,'root')!; const kind = first(harmony,'kind')!;
  const type = content(kind).trim();
  if (type === 'none') return attrs(kind).text || 'N.C.';
  const suffix = attrs(kind).text?.trim() || kinds[type] || (type === 'major' ? '' : `[${type}]`);
  const degrees = children(harmony,'degree').filter(degree => attrs(degree)['print-object'] !== 'no').map(degree => {
    const type = content(first(degree,'degree-type')).trim();
    return (type === 'add' ? 'add' : type === 'subtract' ? 'no' : '') + accidental(content(first(degree,'degree-alter')).trim()) + content(first(degree,'degree-value')).trim();
  }).join('');
  const bass = first(harmony,'bass');
  return pitch(root,'root') + suffix + degrees + (bass ? '/' + pitch(bass,'bass') : '');
}
/** OSMD 2.2.1 ignores some harmony display text. Give only its rendering copy
 * a literal numeral label; the review, pitch data and downloadable XML stay intact.
 */
export function createMusicXMLChordPreview(xml: string): string {
  analyzeMusicXML(xml);
  const tree = new XMLParser(options).parse(xml) as Entry[];
  function visit(entries: Entry[]) {
    for (const entry of entries) {
      if (local(entry) === 'harmony') {
        const value = label(entry);
        if (value !== null) {
          const prefix = name(entry).includes(':') ? name(entry).slice(0,name(entry).lastIndexOf(':')+1) : '';
          const keep = body(entry).filter(child => !['root','kind','inversion','bass','degree'].includes(local(child)));
          entry[name(entry)] = [
            { [prefix+'numeral']: [{ [prefix+'numeral-root']: [{ '#text':'1' }], ':@': { text:value } }] },
            { [prefix+'kind']: [{ '#text':'none' }] }, ...keep,
          ];
        }
      } else visit(body(entry));
    }
  }
  visit(tree);
  return new XMLBuilder({ ...options, format:false, suppressEmptyNode:true }).build(tree) as string;
}
