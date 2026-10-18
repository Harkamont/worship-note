import assert from 'node:assert/strict';
import test from 'node:test';
import { exportLyrics, sectionLyrics, validateScore } from '../lib/music.ts';
import { createSampleScore } from '../lib/sample.ts';
import { parseProject, serializeProject } from '../lib/project-io.ts';
import type { ScoreNote, ScoreSection } from '../lib/score-types.ts';
let helpers: typeof import('../lib/lyrics.ts') | undefined;
try { helpers = await import('../lib/lyrics.ts'); } catch (error) { if (!(error instanceof Error) || !/Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) throw error; }
const n = (lyric: string, lyrics?: unknown): ScoreNote => ({ id: crypto.randomUUID(), pitch:'C4', duration:'q', dots:0, tie:false, lyric, ...(lyrics ? {lyrics} : {}) } as ScoreNote);
const section = (notes:ScoreNote[]):ScoreSection => ({id:'v',label:'V1',type:'verse',measures:Array.from({length:Math.ceil(notes.length/4)},(_,i)=>({id:'m'+i,notes:notes.slice(i*4,i*4+4),chords:[]}))});

test('TXT excludes performance-only dashes while preserving real hyphenated words',()=>{
  assert.equal(sectionLyrics(section([n('주'),n('-'),n('—'),n('＿'),n('self-giving'),n(' 사랑'),n('_'),n('')])),'주\nself-giving 사랑');
});

test('syllabic word endings and endLine control TXT spaces and lines across barlines',()=>{
  const values = [
    n('하',[{number:'1',text:'하',syllabic:'begin'}]), n('나',[{number:'1',text:'나',syllabic:'middle'}]), n('님',[{number:'1',text:'님',syllabic:'end'}]), n('사',[{number:'1',text:'사',syllabic:'begin'}]),
    n('랑',[{number:'1',text:'랑',syllabic:'end',endLine:true}]), n('self-giving',[{number:'1',text:'self-giving',syllabic:'single',extend:'start'}]), n('',[{number:'1',text:'',extend:'stop'}]), n('다',[{number:'1',text:'다',syllabic:'single'}]),
  ];
  assert.equal(sectionLyrics(section(values)),'하나님 사랑\nself-giving 다');
});

test('verse selection and all verses preserve form order without copying missing verse text',()=>{
  const score=createSampleScore();
  const part=section([n('첫',[{number:'1',text:'첫',syllabic:'begin'},{number:'2',text:'다른',syllabic:'single'}]),n('절',[{number:'1',text:'절',syllabic:'end'},{number:'2',text:'절',syllabic:'single'}]),n(''),n('')]);
  score.sections=[part];score.form=[{id:'f',sectionId:'v',repeat:2}];
  assert.equal(exportLyrics(score,{verse:'2',sectionNames:false}),'다른 절\n\n다른 절');
  assert.equal(exportLyrics(score,{verse:'3',sectionNames:false}),'');
  const all=exportLyrics(score,{verse:'all',sectionNames:false});
  assert.match(all,/\[가사 1\][\s\S]*첫절\n\n첫절/);assert.match(all,/\[가사 2\][\s\S]*다른 절\n\n다른 절/);
});

test('manual primary lyric edits drop stale primary notation but keep other verses immutable',()=>{
  assert.ok(helpers,'lyric metadata helpers are not implemented');
  const note=n('주',[{number:'1',text:'주',syllabic:'begin',extend:'start',endLine:true},{number:'2',text:'Lord',syllabic:'single'}]);
  const changed=helpers.withNoteLyric(note,'하나님');
  assert.equal(note.lyric,'주');
  assert.deepEqual(changed.lyrics,[{number:'1',text:'하나님'},{number:'2',text:'Lord',syllabic:'single'}]);
  assert.deepEqual(helpers.getNoteLyrics({...note,lyric:'새 가사'}),[{number:'1',text:'새 가사'},{number:'2',text:'Lord',syllabic:'single'}]);
});

test('validation and project serialization retain all verse semantics and normalize stale primary text',()=>{
  const score=createSampleScore();const note=score.sections[0].measures[0].notes[0];
  Object.assign(note,{lyric:'주',lyrics:[{number:'1',text:'주',syllabic:'begin',extend:'start',endLine:true},{number:'2',text:'Lord',syllabic:'single'}]});
  const valid=validateScore(score);assert.deepEqual(valid.sections[0].measures[0].notes[0].lyrics,note.lyrics);
  const parsed=parseProject(serializeProject({score,originalImage:null,originalName:'',recognition:null,updatedAt:'2026-10-18T00:00:00.000Z'}));
  assert.deepEqual(parsed.score.sections[0].measures[0].notes[0].lyrics,note.lyrics);
  note.lyric='새말';assert.deepEqual(validateScore(score).sections[0].measures[0].notes[0].lyrics,[{number:'1',text:'새말'},{number:'2',text:'Lord',syllabic:'single'}]);
});

test('validation rejects duplicated verse numbers and invalid or unbounded lyric metadata',()=>{
  for(const entries of [[{number:'1',text:'가'},{number:'1',text:'나'}],[{number:'1',text:'가',syllabic:'broken'}],[{number:'1',text:'가',extend:'broken'}],[{number:'1',text:'가',endLine:'yes'}],[{number:'',text:'가'}],[{number:'1',text:'가\n나'}],Array.from({length:17},(_,i)=>({number:String(i+1),text:'가'}))]){
    const score=createSampleScore();Object.assign(score.sections[0].measures[0].notes[0],{lyrics:entries});
    assert.throws(()=>validateScore(score),/가사|절/);
  }
});
