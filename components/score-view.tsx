'use client';

import { useEffect, useRef, useState } from 'react';
import { durationBeats, measureBeats } from '@/lib/music.ts';
import { spaceMeasure, wrapMeasures } from '@/lib/score-layout.ts';
import type { MeasureSpacingInput } from '@/lib/score-layout.ts';
import type { Score, ScoreMeasure, ScoreNote } from '@/lib/score-types.ts';
import type { RenderContext, StaveNote as VexNote } from 'vexflow';

interface ScoreViewProps {
  score: Score;
  selectedMeasureId: string | null;
  onSelectMeasure: (sectionId: string, measureId: string) => void;
  measuresPerLine?: number;
  fontSize?: number;
  showSectionLabels?: boolean;
  showForm?: boolean;
  renderKey?: string;
  id?: string;
  onLayoutWidthChange?: (width: number) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const TEXT_FONT = 'Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const WIDTH = 1000;
const MARGIN = 58;
const VALID_KEYS = new Set([
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm',
]);

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function addText(svg: SVGElement, text: string, x: number, y: number, size: number, attrs: Record<string, string | number> = {}) {
  const node = svgElement('text', { x, y, fill: '#18181b', stroke: 'none', 'font-family': TEXT_FONT, 'font-size': size, ...attrs }, text);
  svg.appendChild(node);
  return node;
}

function vexPitch(pitch: string): { key: string; accidental?: string } {
  // The editor stores scientific pitch (C#4); accept VexFlow's c#/4 as well.
  const match = pitch.replace(/♯/g, '#').replace(/♭/g, 'b').match(/^([a-g])([#bn]{0,2})\/?(-?\d)$/i);
  if (!match) throw new Error(`지원하지 않는 음높이: ${pitch}`);
  return { key: `${match[1].toLowerCase()}${match[2].toLowerCase()}/${match[3]}`, accidental: match[2].toLowerCase() || undefined };
}

function normalKey(key: string): string {
  return key.trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s*(minor|min)$/i, 'm').replace(/\s*(major|maj)$/i, '');
}

interface MeasureLayout {
  sectionId: string;
  sectionLabel: string;
  measure: ScoreMeasure;
  number: number;
  row: number;
  x: number;
  y: number;
  width: number;
  chordTopPadding: number;
  firstInLine: boolean;
  firstInScore: boolean;
  lastInScore: boolean;
}

export default function ScoreView({
  score,
  selectedMeasureId,
  onSelectMeasure,
  measuresPerLine = 4,
  fontSize = 14,
  showSectionLabels = true,
  showForm = true,
  renderKey,
  id,
  onLayoutWidthChange,
}: ScoreViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelectMeasure);
  const onLayoutWidthRef = useRef(onLayoutWidthChange);
  const [renderError, setRenderError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { onSelectRef.current = onSelectMeasure; }, [onSelectMeasure]);
  useEffect(() => { onLayoutWidthRef.current = onLayoutWidthChange; }, [onLayoutWidthChange]);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    const currentRenderKey = renderKey ?? JSON.stringify([score, measuresPerLine, fontSize, showSectionLabels, showForm]);

    async function draw() {
      host?.querySelector('svg')?.setAttribute('data-render-ready', 'false');
      setLoading(true);
      setRenderError('');
      try {
        // This entry bundles Bravura and Academico. Do not call loadFonts(), which uses a CDN.
        const VF = await import('vexflow/bravura');
        await document.fonts.ready;
        await document.fonts.load('20px Bravura');
        if (cancelled || !host) return;
        if (!document.fonts.check('20px Bravura')) throw new Error('악보 글꼴을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');

        const count = Math.max(1, Math.min(8, Math.round(measuresPerLine) || 4));
        const lyricSize = Math.max(10, Math.min(22, fontSize || 14));
        const key = normalKey(score.key);
        if (!VALID_KEYS.has(key)) throw new Error(`지원하지 않는 조표입니다: ${score.key}`);
        const time = score.timeSignature.match(/^(\d{1,2})\/(2|4|8|16)$/);
        if (!time || Number(time[1]) < 1) throw new Error(`지원하지 않는 박자입니다: ${score.timeSignature}`);
        const numBeats = Number(time[1]);
        const beatUnit = Number(time[2]);
        // Measure after bundled fonts have loaded, using the same browser context
        // used for rendering. Headless VexFlow text metrics can otherwise be zero.
        const stage = document.createElement('div');
        const renderer = new VF.Renderer(stage, VF.Renderer.Backends.SVG);
        renderer.resize(WIDTH, 360);
        const context: RenderContext = renderer.getContext();
        const svg = stage.querySelector('svg');
        if (!svg) throw new Error('악보 SVG를 만들지 못했습니다.');
        const textContext = document.createElement('canvas').getContext('2d');
        if (!textContext) throw new Error('악보 글자 폭을 측정하지 못했습니다.');
        const chordSize = Math.max(13, lyricSize);
        const chordRowHeight = chordSize + 8;
        const textWidth = (text: string, bold = false) => {
          textContext.font = `${bold ? '600 ' : ''}${bold ? chordSize : lyricSize}px ${TEXT_FONT}`;
          return textContext.measureText(text).width;
        };
        const plainStave = new VF.Stave(0, 0, WIDTH).setContext(context);
        const staveInsets = (stave: InstanceType<typeof VF.Stave>) => stave.getNoteStartX() + WIDTH - stave.getNoteEndX();
        const plainInsets = staveInsets(plainStave) + 12;
        const lineHeader = new VF.Stave(0, 0, WIDTH).addClef('treble').addKeySignature(key).setContext(context);
        const scoreHeader = new VF.Stave(0, 0, WIDTH).addClef('treble').addKeySignature(key).addTimeSignature(score.timeSignature).setContext(context);
        const lineHeaderWidth = staveInsets(lineHeader) - staveInsets(plainStave);
        const scoreHeaderWidth = staveInsets(scoreHeader) - staveInsets(plainStave);
        type PreparedMeasure = {
          notes: ScoreNote[];
          vexNotes: InstanceType<typeof VF.StaveNote>[];
          voice: InstanceType<typeof VF.Voice>;
          beams: InstanceType<typeof VF.Beam>[];
          lyrics: InstanceType<typeof VF.Annotation>[];
          spacing: MeasureSpacingInput;
          minimumWidth: number;
          chordRowCount: number;
        };
        const prepared = new Map<ScoreMeasure, PreparedMeasure>();
        for (const section of score.sections) for (const measure of section.measures) {
          const measureQuarterBeats = measureBeats(measure, score.timeSignature);
          if (measure.notes.length > 128) throw new Error('한 마디의 음표가 너무 많습니다.');
          const notes = measure.notes.length ? measure.notes : [{ id: 'empty', pitch: null, duration: 'w', dots: 0, lyric: '', tie: false } satisfies ScoreNote];
          const lyrics: InstanceType<typeof VF.Annotation>[] = [];
          const vexNotes = notes.map((note) => {
            const pitch = note.pitch ? vexPitch(note.pitch) : { key: 'b/4', accidental: undefined };
            const result = new VF.StaveNote({ clef: 'treble', keys: [pitch.key], duration: `${note.duration}${note.pitch ? '' : 'r'}`, dots: note.dots, autoStem: true });
            if (note.dots) VF.Dot.buildAndAttach([result], { all: true });
            if (note.lyric) {
              const annotation = new VF.Annotation(note.lyric)
                .setFont({ family: TEXT_FONT, size: `${lyricSize}px` })
                .setJustification(VF.AnnotationHorizontalJustify.CENTER)
                .setVerticalJustification(VF.AnnotationVerticalJustify.BOTTOM);
              result.addModifier(annotation);
              lyrics.push(annotation);
            }
            return result;
          });
          const voice = new VF.Voice({ numBeats: measureQuarterBeats * 8, beatValue: 32 }).setMode(VF.VoiceMode.SOFT).addTickables(vexNotes);
          VF.Accidental.applyAccidentals([voice], key);
          // Attach the final beams before measuring. Otherwise VexFlow reserves
          // upward flag widths even though those flags disappear when beamed.
          const beams = VF.Beam.generateBeams(vexNotes, { groups: beatUnit === 8 && numBeats % 3 === 0 ? [new VF.Fraction(3, 8)] : undefined });
          new VF.Formatter().joinVoices([voice]).format([voice], 0, { context, stave: plainStave, alignRests: true });
          let beat = 1;
          const spacingNotes = notes.map((note, index) => {
            const metrics = vexNotes[index].getMetrics();
            const halfGlyph = vexNotes[index].getGlyphWidth() / 2;
            const lyricHalf = note.lyric ? textWidth(note.lyric) / 2 : 0;
            const at = measure.notes.length ? beat : 1 + measureQuarterBeats / 2;
            beat += durationBeats(note);
            return { beat: at,
              left: Math.max(halfGlyph + metrics.modLeftPx + metrics.leftDisplacedHeadPx, lyricHalf),
              right: Math.max(metrics.notePx + metrics.modRightPx + metrics.rightDisplacedHeadPx - halfGlyph, lyricHalf),
            };
          });
          const contentEnd = Math.max(measureQuarterBeats, beat - 1, ...measure.chords.map(chord => chord.beat - .75));
          const spacing: MeasureSpacingInput = {
            notes: spacingNotes,
            chords: measure.chords.map(chord => ({ beat: chord.beat, width: textWidth(chord.symbol, true) })),
            beats: contentEnd,
          };
          const measured = spaceMeasure(spacing);
          const minimumWidth = measured.minimumWidth + plainInsets + 8;
          prepared.set(measure, { notes, vexNotes, voice, beams, lyrics, spacing, minimumWidth, chordRowCount: measured.chordRowCount });
        }
        const layout: MeasureLayout[] = [];
        const sectionHeadings: { text: string; y: number }[] = [];
        const formLabels = showForm ? score.form.flatMap((entry) => {
          const section = score.sections.find((item) => item.id === entry.sectionId);
          return section ? [`${section.label}${entry.repeat > 1 ? ` ×${entry.repeat}` : ''}`] : [];
        }) : [];
        const formLines: string[] = [];
        for (const label of formLabels) {
          const current = formLines[formLines.length - 1];
          if (!current || `${current}  →  ${label}`.length > 74) formLines.push(label);
          else formLines[formLines.length - 1] += `  →  ${label}`;
        }
        let y = formLines.length ? 180 + formLines.length * 23 : 171;
        let number = 1;
        let row = 0;
        const totalMeasures = score.sections.reduce((sum, section) => sum + section.measures.length, 0);
        if (totalMeasures > 512) throw new Error('한 악보에는 최대 512마디까지 표시할 수 있습니다. 곡을 나누어 주세요.');
        for (const section of score.sections) {
          if (!section.measures.length) continue;
          if (showSectionLabels) {
            sectionHeadings.push({ text: section.label, y: y - 9 });
            y += 19;
          }
          const rows = wrapMeasures(section.measures.map(measure => ({ id: measure.id, minimumWidth: prepared.get(measure)!.minimumWidth })), {
            lineWidth: WIDTH - MARGIN * 2, maximumMeasures: count,
            firstHeaderWidth: number === 1 ? scoreHeaderWidth : lineHeaderWidth, lineHeaderWidth,
          });
          let sectionIndex = 0;
          for (const line of rows) {
            const chordRows = Math.max(...section.measures.slice(sectionIndex, sectionIndex + line.measures.length).map(measure => prepared.get(measure)!.chordRowCount));
            const chordTopPadding = (chordRows - 1) * chordRowHeight;
            y += chordTopPadding;
            let x = MARGIN;
            line.measures.forEach((allocated, index) => {
              const measure = section.measures[sectionIndex++];
              const width = allocated.width;
              layout.push({ sectionId: section.id, sectionLabel: section.label, measure, number, row, x, y, width, chordTopPadding,
                firstInLine: index === 0, firstInScore: number === 1, lastInScore: number === totalMeasures });
              number++;
              x += width;
            });
            row++;
            y += 165 + Math.max(0, lyricSize - 14) * 2;
          }
          y += 24;
        }
        const height = Math.max(360, y + 20);
        const pageWidth = Math.ceil(Math.max(WIDTH, ...layout.map(item => item.x + item.width + MARGIN)));
        if (pageWidth > 4096) throw new Error('한 마디가 표시할 수 있는 최대 폭보다 깁니다. 음표·코드·가사를 확인해 주세요.');
        // Build off-screen so a failed update cannot leave a partly drawn score visible.
        renderer.resize(pageWidth, height);
        svg.id = 'score-svg';
        svg.setAttribute('data-render-key', currentRenderKey);
        svg.setAttribute('data-render-ready', 'false');
        svg.setAttribute('data-layout-rows', String(row));
        svg.setAttribute('data-layout-width', String(pageWidth));
        svg.setAttribute('xmlns', SVG_NS);
        svg.setAttribute('viewBox', `0 0 ${pageWidth} ${height}`);
        svg.setAttribute('role', 'group');
        svg.setAttribute('aria-label', `${score.title || '제목 없는 곡'} 편집 가능한 악보`);
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';
        svg.style.background = '#ffffff';
        svg.insertBefore(svgElement('rect', { width: pageWidth, height, fill: '#ffffff', stroke: 'none' }), svg.firstChild);
        addText(svg, score.title || '제목 없는 곡', pageWidth / 2, 65, 31, { 'font-weight': 700, 'text-anchor': 'middle' });
        if (score.artist) addText(svg, score.artist, pageWidth - MARGIN, 103, 13, { 'text-anchor': 'end', fill: '#52525b' });
        addText(svg, `${score.key}  ·  ${score.timeSignature}  ·  ♩ = ${score.tempo}${score.sections.some(section => section.measures.some(measure => measure.rhythmReview)) ? '  ·  검토용 초안 (박자·코드 확인)' : ''}`, MARGIN, 131, 12, { fill: '#52525b' });
        if (formLines.length) {
          addText(svg, '부를 순서', MARGIN, 162, 10, { 'font-weight': 700, 'letter-spacing': 1.3, fill: '#71717a' });
          formLines.forEach((line, index) => addText(svg, line, MARGIN + 83, 162 + index * 23, 12, { fill: '#3f3f46' }));
        }
        sectionHeadings.forEach((heading) => addText(svg, heading.text, MARGIN, heading.y, 14, { 'font-weight': 700 }));
        if (!totalMeasures) addText(svg, '구간과 마디를 추가하면 악보가 표시됩니다.', pageWidth / 2, 250, 15, { 'text-anchor': 'middle', fill: '#71717a' });

        const rendered: { source: ScoreNote; note: VexNote; row: number; sectionId: string }[] = [];
        const failed: number[] = [];
        for (const item of layout) {
          const stave = new VF.Stave(item.x, item.y, item.width);
          if (item.firstInLine) stave.addClef('treble').addKeySignature(key);
          if (item.firstInScore) stave.addTimeSignature(score.timeSignature);
          if (item.lastInScore) stave.setEndBarType(VF.BarlineType.END);
          stave.setContext(context).draw();
          svg.querySelector(`[id="vf-${stave.getAttribute('id')}"]`)?.setAttribute('data-stave-measure', item.measure.id);
          addText(svg, String(item.number), item.x + 2, item.y + 31, 9, { fill: '#a1a1aa' });
          if (item.measure.rhythmReview) addText(svg, '박자·코드 확인', item.x + item.width - 8, item.y + 31, 9, { fill: '#b45309', 'text-anchor': 'end', 'data-rhythm-review': item.number });
          else if (item.measure.actualBeats !== undefined) addText(svg, `${item.measure.actualBeats}박`, item.x + item.width - 8, item.y + 31, 9, { fill: '#71717a', 'text-anchor': 'end', 'data-pickup-beats': item.measure.actualBeats });
          try {
            const { notes, vexNotes, voice, beams, lyrics: lyricAnnotations, spacing } = prepared.get(item.measure)!;
            const positioned = spaceMeasure(spacing, stave.getNoteEndX() - stave.getNoteStartX() - 12);
            vexNotes.forEach((note, index) => {
              note.setStave(stave);
              const desiredX = stave.getNoteStartX() + positioned.noteXs[index] - note.getGlyphWidth() / 2;
              const tick = note.checkTickContext();
              tick.setX(tick.getX() + desiredX - note.getAbsoluteX());
            });
            if (item.measure.notes.length) {
              voice.draw(context, stave);
              beams.forEach((beam) => beam.setContext(context).draw());
            } else addText(svg, '음표를 넣어 주세요', item.x + item.width / 2, item.y + 109, 12, { 'text-anchor': 'middle', fill: '#b45309' });
            // VexFlow measures lyric widths, but anchors bottom annotations to individual pitches.
            // Align their SVG groups to one lyric baseline so rests and low notes do not stagger text.
            lyricAnnotations.forEach((annotation) => {
              const group = svg.querySelector(`[id="vf-${annotation.getAttribute('id')}"]`);
              group?.setAttribute('transform', `translate(0, ${item.y + 117 + Math.max(0, lyricSize - 14) - annotation.getY()})`);
            });
            notes.forEach((note, index) => {
              if (item.measure.notes.length) rendered.push({ source: note, note: vexNotes[index], row: item.row, sectionId: item.sectionId });
              const group = svg.querySelector(`[id="vf-${vexNotes[index].getAttribute('id')}"]`);
              group?.setAttribute('data-note-id', note.id);
              group?.setAttribute('data-note-measure', item.measure.id);
              group?.setAttribute('data-note-center', String(stave.getNoteStartX() + positioned.noteXs[index]));
            });
            item.measure.chords.forEach((chord, index) => {
              addText(svg, chord.symbol, stave.getNoteStartX() + positioned.chordXs[index], item.y + 12 - item.chordTopPadding + positioned.chordRows[index] * chordRowHeight, chordSize, {
                'font-weight': 600, 'text-anchor': 'middle', 'data-chord-beat': chord.beat,
                'data-chord-id': chord.id, 'data-chord-measure': item.measure.id, 'data-chord-row': positioned.chordRows[index],
              });
            });
          } catch (error) {
            failed.push(item.number);
            addText(svg, '마디 확인 필요', item.x + item.width / 2, item.y + 109, 12, { 'text-anchor': 'middle', fill: '#b45309' });
            console.warn(`Score measure ${item.number}:`, error);
          }
        }
        for (let index = 0; index < rendered.length - 1; index++) {
          const current = rendered[index];
          const next = rendered[index + 1];
          if (!current.source.tie || !current.source.pitch || !next.source.pitch || current.sectionId !== next.sectionId) continue;
          if (current.row === next.row) new VF.StaveTie({ firstNote: current.note, lastNote: next.note }).setContext(context).draw();
          else {
            new VF.StaveTie({ firstNote: current.note }).setContext(context).draw();
            new VF.StaveTie({ lastNote: next.note }).setContext(context).draw();
          }
        }
        for (const item of layout) {
          const selected = item.measure.id === selectedMeasureId;
          const hitArea = svgElement('rect', {
            x: item.x + 1, y: item.y - item.chordTopPadding - 5, width: item.width - 2, height: 143 + item.chordTopPadding + Math.max(0, lyricSize - 14) * 2,
            rx: 4, fill: selected ? '#b88b43' : 'transparent', 'fill-opacity': selected ? 0.065 : 0,
            stroke: selected ? '#b88b43' : 'none', 'stroke-width': 1.4,
            'data-export-ignore': 'true', 'data-measure-id': item.measure.id,
            'data-measure-number': item.number, 'data-measure-row': item.row,
            'data-expected-beats': measureBeats(item.measure, score.timeSignature),
            'data-minimum-width': prepared.get(item.measure)!.minimumWidth,
            'pointer-events': 'all',
            role: 'button', tabindex: 0, 'aria-label': `${item.sectionLabel} ${item.number}마디 편집`,
            'aria-pressed': String(selected),
          });
          hitArea.style.cursor = 'pointer';
          const select = () => onSelectRef.current(item.sectionId, item.measure.id);
          hitArea.addEventListener('click', select);
          hitArea.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
          });
          svg.appendChild(hitArea);
        }
        // SVG geometry requires a live DOM. Keep the completed stage invisible
        // while checking the actual glyph/text boxes, then publish it atomically.
        stage.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
        stage.setAttribute('aria-hidden', 'true');
        document.body.appendChild(stage);
        let horizontalOverflow = 0;
        let chordOverlaps = 0;
        let noteOverlaps = 0;
        try {
          for (const item of layout) {
            const nodes = Array.from(svg.querySelectorAll<SVGGraphicsElement>('[data-note-measure], [data-chord-measure]'))
              .filter(node => (node.getAttribute('data-note-measure') ?? node.getAttribute('data-chord-measure')) === item.measure.id);
            for (const node of nodes) {
              const box = node.getBBox();
              if (box.width && (box.x < item.x - 1 || box.x + box.width > item.x + item.width + 1)) horizontalOverflow++;
            }
            for (const kind of ['note', 'chord']) {
              const boxes = nodes.filter(node => node.hasAttribute(`data-${kind}-measure`)).map(node => node.getBBox()).sort((a, b) => a.x - b.x);
              for (let index = 0; index < boxes.length; index++) for (let next = index + 1; next < boxes.length; next++) {
                const left = boxes[index];
                const right = boxes[next];
                if (left.x + left.width <= right.x + 1) break;
                const overlapsVertically = left.y + left.height > right.y + 1 && right.y + right.height > left.y + 1;
                if (overlapsVertically) {
                  if (kind === 'chord') chordOverlaps++;
                  else noteOverlaps++;
                }
              }
            }
          }
        } finally {
          stage.remove();
        }
        svg.setAttribute('data-horizontal-overflow-count', String(horizontalOverflow));
        svg.setAttribute('data-chord-overlap-count', String(chordOverlaps));
        svg.setAttribute('data-note-overlap-count', String(noteOverlaps));
        if (cancelled || !host) return;
        svg.setAttribute('data-render-ready', failed.length ? 'false' : 'true');
        host.replaceChildren(svg);
        onLayoutWidthRef.current?.(pageWidth);
        setRenderError(failed.length ? `${failed.join(', ')}마디를 그리지 못했습니다. 음표와 길이를 확인해 주세요.` : '');
      } catch (error) {
        if (!cancelled) {
          host?.replaceChildren();
          setRenderError(error instanceof Error ? error.message : '악보를 표시하지 못했습니다. 입력 내용을 확인해 주세요.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void draw();
    return () => { cancelled = true; };
  }, [score, selectedMeasureId, measuresPerLine, fontSize, showSectionLabels, showForm, renderKey]);

  return <div id={id} className="score-view" data-score-svg="true" aria-busy={loading}>
    {loading && <div className="score-loading" role="status">악보를 정리하고 있습니다…</div>}
    {renderError && <div className="score-render-error" role="alert">{renderError}</div>}
    <div ref={hostRef} className="score-svg-container" />
  </div>;
}
