import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';
import { extractMusicXMLMelody } from '../lib/musicxml-melody.ts';
import { parseMusicXML } from '../lib/musicxml-import.ts';
import { createReviewWorkspace } from '../lib/review-workspace.ts';
import type { MusicXMLRecognitionResult } from '../lib/recognition.ts';

// Native node tests lack a JSX loader. Transpile the actual component and keep
// React hooks/rendering and every local XML helper intact during server render.
async function componentURL(name: string): Promise<string> {
  const url = new URL('../components/' + name + '.tsx', import.meta.url);
  let code = ts.transpileModule(await readFile(url, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports = [...code.matchAll(/from\s+(['"])([^'"]+)\1/g)];
  for (const match of imports) {
    const specifier = match[2];
    let resolved: string;
    if (specifier.startsWith('@/components/')) resolved = await componentURL(specifier.slice('@/components/'.length).replace(/\.tsx$/, ''));
    else if (specifier.startsWith('@/')) resolved = new URL('../' + specifier.slice(2) + (/\.ts$/.test(specifier) ? '' : '.ts'), import.meta.url).href;
    else resolved = import.meta.resolve(specifier);
    code = code.replace(match[0], 'from ' + JSON.stringify(resolved));
  }
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}

const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice></note></measure></part></score-partwise>';
const source: MusicXMLRecognitionResult = { document: analyzeMusicXML(xml), score: null, editorIssue: 'multiple voices', model: 'original-model', provider: 'local-file', elapsedMs: 100, usage: null };
const selection = { partId: 'P1', staff: '1', voice: '1' };

test('melody review displays parent-controlled saved XML and warnings immediately on reopen', async () => {
  const { default: MelodyExtractor } = await import(await componentURL('melody-extractor'));
  const extracted = extractMusicXMLMelody(xml, selection);
  const html = renderToStaticMarkup(createElement(MelodyExtractor, { source, melody: { selection, xml: extracted.xml, warnings: ['저장했던 검토 문구'] }, onMelodyChange() {}, onImport() {} }));
  assert.match(html, /멜로디 악보 파일 \(XML\)/);
  assert.match(html, /저장했던 검토 문구/);
  assert.match(html, /멜로디 편집하기/);
  assert.doesNotMatch(html, /검토용으로 열고 고치기/);
});

test('restored direct review uses a source name without creating a fake File', async () => {
  const { default: DirectMusicXML } = await import(await componentURL('direct-musicxml'));
  const html = renderToStaticMarkup(createElement(DirectMusicXML, { file: null, sourceName: '보관한 원본.musicxml', originalUrl: '', configured: false, model: '', result: source, onResult() {}, onImport() {}, onBusyChange() {}, onDownloadProject() {} }));
  assert.match(html, /보관한 원본.musicxml/);
  assert.match(html, /작업 파일 저장 \(JSON\)/);
  assert.doesNotMatch(html, /다시 여는 기능은 아직 제공하지 않습니다/);
});

test('paid review distinguishes missing cost information from free local processing', async () => {
  const { default: DirectMusicXML } = await import(await componentURL('direct-musicxml'));
  const render = (result: MusicXMLRecognitionResult, mode: 'direct' | 'hybrid' | 'local') => renderToStaticMarkup(createElement(DirectMusicXML, { file: null, sourceName: '원본.png', originalUrl: '', configured: false, model: '', mode, result, onResult() {}, onImport() {}, onBusyChange() {} }));
  const paid = { ...source, provider: 'openai-compatible', cost: undefined };
  assert.match(render(paid, 'direct'), /AI 사용료 정보 없음/);
  assert.match(render({ ...paid, cost: 0.025 }, 'direct'), /AI 사용료 \$0\.025000/);
  const unfinishedHybrid = render({ ...source, provider: 'local-omr', cost: 0 }, 'hybrid');
  assert.match(unfinishedHybrid, /AI 사용료는 별도 확인/);
  assert.doesNotMatch(unfinishedHybrid, /보고된 AI 사용료 \$0/);
});

test('melody with invalid rhythm offers an explicit editable review draft while strict import stays disabled', async () => {
  const { default: MelodyExtractor } = await import(await componentURL('melody-extractor'));
  const overfullMeasure = xml.replace('</measure>', '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice></note></measure>');
  const extracted = extractMusicXMLMelody(overfullMeasure, selection);
  const draftSource = { ...source, document: analyzeMusicXML(overfullMeasure) };
  const html = renderToStaticMarkup(createElement(MelodyExtractor, { source: draftSource, melody: { selection, xml: '\uFEFF' + extracted.xml, warnings: extracted.warnings }, onMelodyChange() {}, onImport() {} }));
  assert.match(html, /검토용으로 열고 고치기/);
  assert.match(html, /aria-label="검토용 악보 열기 도움말"/);
  const strictImport = [...html.matchAll(/<button[^>]*>[^]*?<\/button>/g)].find(([button]) => button.includes('멜로디 편집하기'))?.[0];
  assert.match(strictImport ?? '', /disabled=""/);
});

test('a newly uploaded image does not inherit protection notices from the previous review', async () => {
  const { default: DirectMusicXML } = await import(await componentURL('direct-musicxml'));
  const previous = createReviewWorkspace(source, { sourceImage: 'data:image/png;base64,iVBORw0KGgo=', sourceName: 'old.png', mode: 'local' });
  previous.editorChanged = true;
  previous.measureRepair = { xml, selection: { partId: 'P1', startMeasure: 1, endMeasure: 1 }, receipts: Array.from({ length: 32 }, () => previous.receipt) };
  const html = renderToStaticMarkup(createElement(DirectMusicXML, { result: null, originalUrl: 'data:image/png;base64,iVBORw0KGgoA', mode: 'local', configured: true, model: 'HOMR', reviewWorkspace: previous, onResult() {}, onImport() {}, onBusyChange() {} }));
  assert.doesNotMatch(html, /직접 편집한 내용을 보호/);
  assert.doesNotMatch(html, /AI 보완 횟수\(32회\)/);
  const matching = renderToStaticMarkup(createElement(DirectMusicXML, { result: source, originalUrl: previous.sourceImage, mode: 'local', configured: true, model: 'HOMR', reviewWorkspace: { ...previous, editorChanged: false }, onResult() {}, onImport() {}, onBusyChange() {} }));
  assert.match(matching, /AI 보완 횟수\(32회\)/);
  assert.match(matching.slice(matching.indexOf('aria-label="잘못 읽은 마디만 AI로 수정"')), /<fieldset disabled=""/);
});

test('editor-change protection applies only to the same XML, image, mode and selected melody', async () => {
  const { default: DirectMusicXML } = await import(await componentURL('direct-musicxml'));
  const originalUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const workspace = createReviewWorkspace(source, { sourceImage: originalUrl, sourceName: 'score.png', mode: 'local' });
  workspace.editorChanged = true;
  const render = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(DirectMusicXML, { result: source, originalUrl, mode: 'local', configured: true, aiConfigured: true, model: 'HOMR', reviewWorkspace: workspace, onResult() {}, onImport() {}, onBusyChange() {}, ...extra }));
  const matching = render({});
  assert.match(matching, /직접 편집한 내용을 보호/);
  assert.match(matching.slice(matching.indexOf('aria-label="잘못 읽은 마디만 AI로 수정"')), /<fieldset disabled=""/);
  const melody = { selection, xml: xml.replace('Soprano', 'Other melody'), warnings: [] };
  for (const extra of [{ mode: 'direct' }, { originalUrl: originalUrl + 'other' }, { reviewWorkspace: { ...workspace, sourceXML: xml.replace('Soprano', 'Other source') } }, { melody }]) {
    const html = render(extra);
    assert.doesNotMatch(html, /직접 편집한 내용을 보호/);
    assert.doesNotMatch(html.slice(html.indexOf('aria-label="잘못 읽은 마디만 AI로 수정"')), /<fieldset disabled=""/);
  }
});

test('free image review offers collapsed text-only reading without starting a request during render', async () => {
  const { default: DirectMusicXML } = await import(await componentURL('direct-musicxml'));
  const file = new File(['image'], 'score.png', { type: 'image/png' });
  const common = { file, result: null, originalUrl: '', mode: 'local', localTextInput: { width: 600, height: 900 }, configured: true, model: 'HOMR', onResult() {}, onImport() {}, onBusyChange() { assert.fail('Rendering must not start work'); } };
  const html = renderToStaticMarkup(createElement(DirectMusicXML, common));
  assert.match(html, /<details[^>]*><summary[^>]*>[\s\S]*?가사·코드 글자 읽기 \(무료\)<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /가사·코드 글자만 읽기 \(무료\)/);
  assert.match(html, /음표에 가사를 붙이거나 박자에 맞춰 코드를 배치하지는 않습니다/);
  for (const extra of [{ mode: 'direct' }, { mode: 'hybrid' }, { file: null }, { localTextInput: undefined }]) {
    assert.doesNotMatch(renderToStaticMarkup(createElement(DirectMusicXML, { ...common, ...extra })), /가사·코드 글자만 읽기 \(무료\)/);
  }
});

test('an editable result offers import before the long score comparison and explains replacement', async () => {
  const { default: DirectMusicXML } = await import(await componentURL('direct-musicxml'));
  const result = { ...source, score: parseMusicXML(xml), editorIssue: null };
  const render = (value: MusicXMLRecognitionResult) => renderToStaticMarkup(createElement(DirectMusicXML, { result: value, originalUrl: '', configured: false, model: '', onResult() {}, onImport() {}, onBusyChange() {} }));
  const html = render(result);
  const firstComparison = html.indexOf('direct-musicxml-comparison');
  assert.match(html.slice(0, firstComparison), /<button[^>]*>[\s\S]*?이 악보 편집하기<\/button>/);
  assert.match(html.slice(0, firstComparison), /가져오면 현재 편집 중인 악보를 교체합니다/);
  assert.doesNotMatch(render(source).slice(0, firstComparison), /이 악보 편집하기<\/button>/);
});

test('an unrelated tool cleanup cannot clear another active review operation', async () => {
  let helper: typeof import('../lib/review-busy.ts') | undefined;
  try { helper = await import('../lib/review-busy.ts'); }
  catch (error) { if (!(error instanceof Error) || !/Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) throw error; }
  assert.ok(helper, 'review activity aggregation is missing');
  const activity = helper.createReviewBusyState();
  assert.equal(activity.isBusy(), false);
  assert.equal(activity.update('conversion', true), true);
  assert.equal(activity.update('text', false), true);
  assert.equal(activity.update('repair', true), true);
  assert.equal(activity.update('conversion', false), true);
  assert.equal(activity.update('repair', false), false);
  assert.equal(activity.update('text', true), true);
  activity.clear();
  assert.equal(activity.isBusy(), false);
  assert.equal(activity.update('text', false), false);
});
