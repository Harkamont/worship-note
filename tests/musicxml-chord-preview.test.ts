import assert from 'node:assert/strict';
import test from 'node:test';
import osmd from 'opensheetmusicdisplay';
import { XMLParser } from 'fast-xml-parser';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';
import { createMusicXMLChordPreview } from '../lib/musicxml-chord-preview.ts';
const wrap=(harmony:string)=>`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${harmony}<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note></measure></part></score-partwise>`;
const displayed=(xml:string)=>new XMLParser({ignoreAttributes:false,attributeNamePrefix:''}).parse(xml)['score-partwise'].part.measure.harmony.numeral['numeral-root'].text;
test('literal chord labels retain alterations, slash bass and whole parentheses in rendering copy',()=>{for(const [harmony,expected]of [
 ['<harmony placement="above"><root><root-step>F</root-step><root-alter>1</root-alter></root><kind text="m7(b5)">other</kind><bass><bass-step>C</bass-step><bass-alter>1</bass-alter></bass><offset>2</offset><staff>1</staff></harmony>','F#m7(b5)/C#'],
 ['<harmony><root><root-step text="(B">B</root-step></root><kind text="m7">minor-seventh</kind><bass><bass-step text="C#)">C</bass-step><bass-alter print-object="no">1</bass-alter></bass></harmony>','(Bm7/C#)'],
 ['<harmony><root><root-step>C</root-step></root><kind text="7sus4">other</kind></harmony>','C7sus4'],
 ['<harmony><root><root-step>C</root-step></root><kind text="">minor-seventh</kind></harmony>','Cm7'],
 ['<harmony><root><root-step>C</root-step></root><kind text="N.C.">none</kind></harmony>','N.C.'],
 ['<harmony><root><root-step>A</root-step></root><kind>major</kind><degree><degree-value>2</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree></harmony>','Aadd2'],
 ]){const original=wrap(harmony);const rendered=createMusicXMLChordPreview(original);assert.equal(displayed(rendered),expected);assert.deepEqual(analyzeMusicXML(rendered).parts[0].measures[0].events,analyzeMusicXML(original).parts[0].measures[0].events);assert.ok(original.includes(harmony));if(harmony.includes('<offset>'))assert.match(rendered,/<offset>2<\/offset><staff>1<\/staff>/);}});
test('escapes markup in display text and does not flatten existing numeral analysis',()=>{const source=wrap('<harmony><root><root-step>C</root-step></root><kind text="&lt;script&gt;">other</kind></harmony>');const rendered=createMusicXMLChordPreview(source);assert.equal(displayed(rendered),'C<script>');assert.ok(!rendered.includes('<script>'));const numeral=wrap('<harmony><numeral><numeral-root text="V">5</numeral-root></numeral><kind>major</kind></harmony>');assert.match(createMusicXMLChordPreview(numeral),/text="V"/);});

test('installed OSMD actually returns exact complex and optional chord labels',()=>{
  type Node = { name:string; value:string; hasAttributes:boolean; element:(key:string)=>Node|undefined; elements:(key:string)=>Node[]; attribute:(key:string)=>{value:string}|undefined };
  const adapt = (entry: Record<string,unknown>):Node => {
    const name=Object.keys(entry).find(key=>key!==':@')!;const entries=entry[name] as Record<string,unknown>[];
    const attributes=(entry[':@']??{}) as Record<string,string>;const nodes=entries.filter(child=>!Object.hasOwn(child,'#text')).map(adapt);
    return {name,value:entries.filter(child=>Object.hasOwn(child,'#text')).map(child=>String(child['#text'])).join(''),hasAttributes:Object.keys(attributes).length>0,element:key=>nodes.find(child=>child.name===key),elements:key=>nodes.filter(child=>child.name===key),attribute:key=>Object.hasOwn(attributes,key)?{value:attributes[key]}:undefined};
  };
  for(const label of ['(Bm7)','F#m7(b5)/C#','F#(b9)','(Bm7/G)','N.C.']){
    const harmony={harmony:[{numeral:[{'numeral-root':[{'#text':'1'}],':@':{text:label}}]},{kind:[{'#text':'none'}]}]};
    const sheet={Rules:new osmd.EngravingRules(),SheetErrors:{pushMeasureError(){}}};
    const chord=osmd.ChordSymbolReader.readChordSymbol(adapt(harmony) as unknown as Parameters<typeof osmd.ChordSymbolReader.readChordSymbol>[0],sheet as unknown as Parameters<typeof osmd.ChordSymbolReader.readChordSymbol>[1],undefined as unknown as Parameters<typeof osmd.ChordSymbolReader.readChordSymbol>[2]);
    assert.equal(osmd.ChordSymbolContainer.calculateChordText(chord,0,undefined as unknown as Parameters<typeof osmd.ChordSymbolContainer.calculateChordText>[2]),label);
  }
});
