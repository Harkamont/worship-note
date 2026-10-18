import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

type PositionModule = typeof import('../lib/help-tip-position.ts');
async function positions(): Promise<PositionModule> {
  const loaded = await import('../lib/help-tip-position.ts').catch(() => null);
  assert.ok(loaded, 'the tooltip must calculate a position inside the visible screen');
  return loaded;
}
async function component() {
  const path = new URL('../components/help-tip.tsx', import.meta.url);
  const source = await readFile(path, 'utf8').catch(() => null);
  assert.ok(source, 'the contextual help button must exist');
  let code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...code.matchAll(/from\s+(['"])([^'"]+)\1/g)]) {
    const specifier = match[2];
    const resolved = specifier.startsWith('@/') ? new URL('../' + specifier.slice(2) + (/\.ts$/.test(specifier) ? '' : '.ts'), import.meta.url).href : import.meta.resolve(specifier);
    code = code.replace(match[0], 'from ' + JSON.stringify(resolved));
  }
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

test('help opens beneath the control when there is room', async () => {
  const { positionHelpTip } = await positions();
  const result = positionHelpTip({ left: 200, right: 224, top: 100, bottom: 124 }, { width: 280, height: 130 }, { width: 1280, height: 800 });
  assert.equal(result.placement, 'below');
  assert.equal(result.top, 132);
  assert.equal(result.left, 72);
  assert.equal(result.maxWidth, 308);
});

test('help moves above a control near the bottom and stays inside narrow screens', async () => {
  const { positionHelpTip } = await positions();
  const result = positionHelpTip({ left: 287, right: 311, top: 600, bottom: 624 }, { width: 300, height: 150 }, { width: 320, height: 640 });
  assert.equal(result.placement, 'above');
  assert.equal(result.left, 12);
  assert.equal(result.top, 442);
  assert.equal(result.maxWidth, 296);
  assert.ok(result.top + 150 <= 628);
});

test('an enlarged browser viewport and tall help text remain reachable', async () => {
  const { positionHelpTip } = await positions();
  const result = positionHelpTip({ left: 60, right: 84, top: 345, bottom: 369 }, { width: 300, height: 700 }, { left: 40, top: 300, width: 240, height: 260 });
  assert.equal(result.left, 52);
  assert.equal(result.top, 312);
  assert.equal(result.maxWidth, 216);
  assert.equal(result.maxHeight, 236);
});

test('a tap pins focused help and a second tap dismisses it without losing focus', async () => {
  const { helpTipReducer, initialHelpTipState } = await component();
  const focused = helpTipReducer(initialHelpTipState, 'focus');
  assert.equal(focused.open, true);
  const firstTap = helpTipReducer(focused, 'toggle');
  assert.equal(firstTap.open, true);
  assert.equal(firstTap.pinned, true);
  const secondTap = helpTipReducer(firstTap, 'toggle');
  assert.equal(secondTap.open, false);
  assert.equal(secondTap.focused, true);
});

test('Escape stays dismissed while focus and hover remain on the help control', async () => {
  const { helpTipReducer, initialHelpTipState } = await component();
  const focused = helpTipReducer(helpTipReducer(initialHelpTipState, 'pointer-enter'), 'focus');
  const dismissed = helpTipReducer(focused, 'dismiss');
  assert.equal(dismissed.open, false);
  assert.equal(helpTipReducer(dismissed, 'pointer-leave').open, false);
  assert.equal(helpTipReducer(dismissed, 'blur').open, false);
  assert.equal(helpTipReducer(dismissed, 'toggle').open, true);
});

test('keyboard help closes when focus moves to another control', async () => {
  const { helpTipReducer, initialHelpTipState } = await component();
  const pinned = helpTipReducer(helpTipReducer(initialHelpTipState, 'focus'), 'toggle');
  const next = helpTipReducer(pinned, 'blur');
  assert.equal(next.open, false);
  assert.equal(next.pinned, false);
});

test('each help button names its context and does not depend on a title attribute', async () => {
  const { HelpTip } = await component();
  const html = renderToStaticMarkup(createElement(HelpTip, { helpKey: 'transpose' }));
  assert.match(html, /<button[^>]*type="button"/);
  assert.match(html, /aria-label="전조 도움말"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /title="|role="tooltip"|aria-describedby=/);
  const custom = renderToStaticMarkup(createElement(HelpTip, { helpKey: 'musicxmlExport', label: 'MusicXML 초안' }));
  assert.match(custom, /aria-label="MusicXML 초안 도움말"/);
});

test('focused help scrolls by line and page without moving beyond its own content', async () => {
  const { helpTipScrollTarget } = await component();
  assert.equal(typeof helpTipScrollTarget, 'function', 'long help must support scrolling from its focused button');
  const metrics = { scrollTop: 0, scrollHeight: 320, clientHeight: 100 };
  assert.equal(helpTipScrollTarget('ArrowDown', metrics), 40);
  assert.equal(helpTipScrollTarget('ArrowUp', { ...metrics, scrollTop: 20 }), 0);
  assert.equal(helpTipScrollTarget('PageDown', metrics), 90);
  assert.equal(helpTipScrollTarget('PageUp', { ...metrics, scrollTop: 120 }), 30);
  assert.equal(helpTipScrollTarget('PageDown', { ...metrics, scrollTop: 200 }), 220);
});

test('Home and End reach the beginning and end of long help', async () => {
  const { helpTipScrollTarget } = await component();
  assert.equal(typeof helpTipScrollTarget, 'function');
  const metrics = { scrollTop: 90, scrollHeight: 320, clientHeight: 100 };
  assert.equal(helpTipScrollTarget('Home', metrics), 0);
  assert.equal(helpTipScrollTarget('End', metrics), 220);
  assert.equal(helpTipScrollTarget('End', { scrollTop: 0, scrollHeight: 70, clientHeight: 100 }), 0);
});

test('help scrolling does not handle unrelated activation or editing keys', async () => {
  const { helpTipScrollTarget } = await component();
  assert.equal(typeof helpTipScrollTarget, 'function');
  const metrics = { scrollTop: 0, scrollHeight: 320, clientHeight: 100 };
  for (const key of ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'z', 'Escape', 'Tab']) assert.equal(helpTipScrollTarget(key, metrics), null);
});
