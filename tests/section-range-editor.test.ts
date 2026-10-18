import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createSampleScore } from '../lib/sample.ts';
import { assignSectionRange } from '../lib/section-ranges.ts';

async function componentURL(name: string): Promise<string> {
  const url = new URL('../components/' + name + '.tsx', import.meta.url);
  let code = ts.transpileModule(await readFile(url, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...code.matchAll(/from\s+(['"])([^'"]+)\1/g)]) {
    const specifier = match[2];
    let resolved: string;
    if (specifier.startsWith('@/components/')) resolved = await componentURL(specifier.slice('@/components/'.length).replace(/\.tsx$/, ''));
    else if (specifier.startsWith('@/')) resolved = new URL('../' + specifier.slice(2) + (/\.ts$/.test(specifier) ? '' : '.ts'), import.meta.url).href;
    else resolved = import.meta.resolve(specifier);
    code = code.replace(match[0], 'from ' + JSON.stringify(resolved));
  }
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}

const { default: SectionRangeEditor } = await import(await componentURL('section-range-editor'));
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(SectionRangeEditor, props));

test('section picker lists every part with its position in the whole score when selection is enabled', () => {
  const score = createSampleScore();
  const html = render({ score, sectionId: score.sections[1].id, onApply() {}, onSelectSection() {} });
  assert.match(html, /나눌 부분<select[^>]*aria-label="나눌 부분"/);
  assert.match(html, /<option value="section-0">V1 · 1–4마디<\/option>/);
  assert.match(html, /<option value="section-1" selected="">V2 · 5–8마디<\/option>/);
  assert.match(html, /<option value="section-3">B · 13–16마디<\/option>/);
});

test('start, end and apply labels use whole-score numbers while the submitted select values stay relative', () => {
  const score = createSampleScore();
  const html = render({ score, sectionId: score.sections[2].id, onApply() {} });
  assert.doesNotMatch(html, /aria-label="나눌 부분"/);
  assert.match(html, /aria-label="구간 시작 마디"[^>]*><option value="1" selected="">9마디<\/option>/);
  assert.match(html, /aria-label="구간 끝 마디"[^>]*>[\s\S]*?<option value="4" selected="">12마디<\/option>/);
  assert.match(html, /9–12마디를 구간으로 지정/);
});

test('after splitting, the remaining part can be selected with continuous original measure numbers', () => {
  const score = createSampleScore();
  const first = assignSectionRange(score, { sectionId: score.sections[0].id, startMeasure: 1, endMeasure: 2, label: '1절', type: 'verse' });
  const remainder = first.score.sections[1];
  const html = render({ score: first.score, sectionId: remainder.id, onApply() {}, onSelectSection() {} });
  assert.match(html, /V1 \(뒤\) · 3–4마디/);
  assert.match(html, /aria-label="구간 시작 마디"[^>]*><option value="1" selected="">3마디<\/option>/);
  assert.match(html, /3–4마디를 구간으로 지정/);
  assert.match(html, /V2 · 5–8마디/);
});

test('disabled range editing also disables switching the part being divided', () => {
  const score = createSampleScore();
  const html = render({ score, sectionId: score.sections[0].id, onApply() {}, onSelectSection() {}, disabled: true });
  assert.match(html, /<fieldset disabled=""[^>]*>[\s\S]*?aria-label="나눌 부분"/);
});
