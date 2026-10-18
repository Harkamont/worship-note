import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';
import { createReviewWorkspace } from '../lib/review-workspace.ts';

async function componentURL(name: string): Promise<string> {
  const path = new URL('../components/' + name + '.tsx', import.meta.url);
  let code = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...code.matchAll(/from\s+(['"])([^'"]+)\1/g)]) {
    const specifier = match[2];
    const resolved = specifier.startsWith('@/components/') ? await componentURL(specifier.slice('@/components/'.length).replace(/\.tsx$/, ''))
      : specifier.startsWith('@/') ? new URL('../' + specifier.slice(2) + (/\.ts$/.test(specifier) ? '' : '.ts'), import.meta.url).href : import.meta.resolve(specifier);
    code = code.replace(match[0], 'from ' + JSON.stringify(resolved));
  }
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}

const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="0"><attributes><divisions>1</divisions></attributes><note><rest/><duration>1</duration></note></measure><measure number="1"><note><rest/><duration>1</duration></note></measure></part></score-partwise>';
const source = { document: analyzeMusicXML(xml), score: null, editorIssue: null, provider: 'local-omr', model: 'HOMR', elapsedMs: 1, usage: null, cost: 0 };

test('selective repair starts with no crop and disables paid submission until a crop has been previewed', async () => {
  const { default: MeasureAIRepair } = await import(await componentURL('measure-ai-repair'));
  const html = renderToStaticMarkup(createElement(MeasureAIRepair, { source, originalUrl: 'data:image/png;base64,iVBORw0KGgo=', configured: true, onApply() {} }));
  assert.match(html, /선택한 마디만 AI로 다시 읽기 \(유료\)/);
  const paid = [...html.matchAll(/<button[^>]*>[^]*?<\/button>/g)].find(([button]) => button.includes('선택한 마디만 AI로 다시 읽기'))?.[0];
  assert.match(paid ?? '', /disabled=""/);
  assert.match(html, /영역 미리 보기/);
  assert.doesNotMatch(html, /alt="AI에 보낼 원본 일부"/);
  assert.match(html, /표기 0마디/);
});

test('an absent source image explains what is missing without offering a full page fallback', async () => {
  const { default: MeasureAIRepair } = await import(await componentURL('measure-ai-repair'));
  const html = renderToStaticMarkup(createElement(MeasureAIRepair, { source, originalUrl: '', configured: false, onApply() {} }));
  assert.match(html, /원본 이미지가 있어야/);
  assert.doesNotMatch(html, /선택한 마디만 AI로 다시 읽기 \(유료\)/);
});

test('source rectangles can be entered by keyboard before the first pointer drag', async () => {
  const { SourceRegionPicker } = await import(await componentURL('source-region-picker'));
  const html = renderToStaticMarkup(createElement(SourceRegionPicker, { sourceUrl: 'data:image/png;base64,iVBORw0KGgo=', value: null, onChange() {} }));
  assert.match(html, /aria-label="왼쪽 \(%\)"/);
  assert.match(html, /aria-label="너비 \(%\)"/);
  assert.doesNotMatch(html, /<fieldset[^>]*disabled/);
});

test('direct local review exposes selective repair with a separate AI connection status', async () => {
  const { default: DirectMusicXML } = await import(await componentURL('direct-musicxml'));
  const html = renderToStaticMarkup(createElement(DirectMusicXML, { result: source, originalUrl: 'data:image/png;base64,iVBORw0KGgo=', configured: true, aiConfigured: false, mode: 'local', model: 'HOMR', onResult() {}, onImport() {}, onBusyChange() {} }));
  assert.match(html, /잘못 읽은 마디만 AI로 수정/);
  assert.match(html, /유료 마디 수정을 사용하려면 AI 연결 설정이 필요합니다/);
});

test('selective repair uses the chosen melody and restores prior repairs only for the matching review', async () => {
  const { default: DirectMusicXML } = await import(await componentURL('direct-musicxml'));
  const originalUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const workspace = createReviewWorkspace(source, { sourceImage: originalUrl, sourceName: 'score.png', mode: 'local' });
  workspace.measureRepair = { xml: xml.replace('number="0"', 'number="repaired-zero"'), selection: { partId: 'P1', startMeasure: 1, endMeasure: 1 }, receipts: [] };
  const render = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(DirectMusicXML, { result: source, originalUrl, configured: true, aiConfigured: true, mode: 'local', model: 'HOMR', reviewWorkspace: workspace, onResult() {}, onImport() {}, onBusyChange() {}, ...extra }));
  const repairHTML = (html: string) => html.slice(html.indexOf('aria-label="잘못 읽은 마디만 AI로 수정"'));
  assert.match(repairHTML(render({})), /표기 repaired-zero마디/);
  assert.doesNotMatch(repairHTML(render({ mode: 'direct' })), /repaired-zero/);
  assert.doesNotMatch(repairHTML(render({ reviewWorkspace: { ...workspace, sourceImage: '' } })), /repaired-zero/);
  const melody = { selection: { partId: 'P1', staff: '1', voice: '1' }, xml: xml.replace('<part-name>Voice', '<part-name>Chosen melody'), warnings: [] };
  const chosen = repairHTML(render({ melody }));
  assert.match(chosen, /Chosen melody \(P1\)/);
  assert.doesNotMatch(chosen, /repaired-zero/);
});
