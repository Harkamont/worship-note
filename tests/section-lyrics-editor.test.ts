import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { ScoreSection } from '../lib/score-types.ts';

async function component() {
  const url = new URL('../components/section-lyrics-editor.tsx', import.meta.url);
  let source: string;
  try { source = await readFile(url, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  let code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...code.matchAll(/from\s+(['"])([^'"]+)\1/g)]) {
    const name = match[2];
    const resolved = name.startsWith('@/') ? new URL('../' + name.slice(2), import.meta.url).href : import.meta.resolve(name);
    code = code.replace(match[0], 'from ' + JSON.stringify(resolved));
  }
  return await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

test('bulk entry starts with a labelled input and preview action without applying or charging anything', async () => {
  const editor = await component();
  assert.ok(editor, 'section lyric editor is not implemented');
  const section: ScoreSection = { id: 'v', label: '1절', type: 'verse', measures: [{ id: 'm', notes: [{ id: 'n', pitch: 'C4', duration: 'w', dots: 0, tie: false, lyric: '기존 가사' }], chords: [] }] };
  let applied = false;
  const html = renderToStaticMarkup(createElement(editor.SectionLyricsEditor, { section, onApply() { applied = true; } }));
  assert.equal(applied, false);
  assert.match(html, /aria-label="1절 가사 한 번에 넣기"/);
  assert.match(html, /가사 배치 미리보기/);
  assert.match(html, /무료/);
  assert.doesNotMatch(html, /확인한 가사 적용/);
});

test('parent can initially open bulk entry without stealing keyboard focus', async () => {
  const editor = await component();
  assert.ok(editor);
  const section: ScoreSection = { id: 'v', label: '후렴', type: 'chorus', measures: [] };
  const html = renderToStaticMarkup(createElement(editor.SectionLyricsEditor, { section, forceOpen: true, onApply() {} }));
  assert.match(html, /<details[^>]*class="section-lyrics-editor"[^>]*open=""/);
  assert.doesNotMatch(html, /autofocus|autoFocus/);
});
