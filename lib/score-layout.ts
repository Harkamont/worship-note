/** All dimensions are unscaled SVG units. Rendering and PNG export share this layout. */
export interface SpacingNote { beat: number; left: number; right: number; }
export interface SpacingChord { beat: number; width: number; }
export interface MeasureSpacingInput { notes: SpacingNote[]; chords: SpacingChord[]; beats: number; }
export interface MeasureSpacing { minimumWidth: number; width: number; noteXs: number[]; chordXs: number[]; chordRows: number[]; chordRowCount: number; }

const EDGE_PADDING = 10;
const SYMBOL_GAP = 12;

function finite(value: number, minimum = 0): number {
  if (!Number.isFinite(value) || value < minimum) throw new Error('유효한 악보 간격을 계산하지 못했습니다.');
  return value;
}

/**
 * Solve horizontal constraints in musical-time order. Notes/lyrics and chords occupy
 * separate lanes, so a long chord reserves space against other chords while its
 * exact beat stays attached to the same timeline as the melody.
 */
export function spaceMeasure(input: MeasureSpacingInput, availableWidth?: number): MeasureSpacing {
  const endBeat = finite(input.beats, .001) + 1;
  const notes = input.notes.map((note, index) => ({ ...note, index }));
  const chords = input.chords.map((chord, index) => ({ ...chord, index }));
  for (const note of notes) { finite(note.beat, 1); finite(note.left); finite(note.right); }
  for (const chord of chords) { finite(chord.beat, 1); finite(chord.width); }
  if ([...notes, ...chords].some(item => item.beat > endBeat)) throw new Error('박 위치가 마디 길이보다 큽니다.');
  const sortedNotes = [...notes].sort((a, b) => a.beat - b.beat);
  const sortedChords = [...chords].sort((a, b) => a.beat - b.beat);
  // Simultaneous symbols keep one time anchor and use separate vertical rows.
  // Stable sorting preserves their source order without modifying source chords.
  const chordRows = chords.map(() => 0);
  let chordRowCount = 1;
  let previousBeat = Number.NaN;
  let rowAtBeat = 0;
  for (const chord of sortedChords) {
    rowAtBeat = chord.beat === previousBeat ? rowAtBeat + 1 : 0;
    chordRows[chord.index] = rowAtBeat;
    chordRowCount = Math.max(chordRowCount, rowAtBeat + 1);
    previousBeat = chord.beat;
  }
  const beats = [...new Set([1, ...notes.map(item => item.beat), ...chords.map(item => item.beat)])].sort((a, b) => a - b);
  const indices = new Map(beats.map((beat, index) => [beat, index]));
  const minimumXs = beats.map(() => EDGE_PADDING);
  const rightEdges = beats.map(() => 0);
  const constraints: { from: number; to: number; distance: number }[] = [];
  for (let index = 1; index < beats.length; index++) {
    constraints.push({ from: index - 1, to: index, distance: 16 * Math.sqrt(beats[index] - beats[index - 1]) });
  }
  function lane(items: { beat: number; left: number; right: number }[]) {
    items.forEach((item, index) => {
      const at = indices.get(item.beat)!;
      minimumXs[at] = Math.max(minimumXs[at], item.left + EDGE_PADDING);
      rightEdges[at] = Math.max(rightEdges[at], item.right);
      if (index) {
        const previous = items[index - 1];
        constraints.push({ from: indices.get(previous.beat)!, to: at, distance: previous.right + item.left + SYMBOL_GAP });
      }
    });
  }
  lane(sortedNotes);
  for (let row = 0; row < chordRowCount; row++) {
    lane(sortedChords.filter(item => chordRows[item.index] === row)
      .map(item => ({ beat: item.beat, left: item.width / 2, right: item.width / 2 })));
  }
  // All edges point forward, so one pass finds the least width satisfying every lane.
  const incoming = beats.map(() => [] as typeof constraints);
  for (const constraint of constraints) incoming[constraint.to].push(constraint);
  for (let index = 0; index < beats.length; index++) {
    for (const constraint of incoming[index]) {
      minimumXs[index] = Math.max(minimumXs[index], minimumXs[constraint.from] + constraint.distance);
    }
  }
  let minimumWidth = 80;
  minimumXs.forEach((x, index) => {
    minimumWidth = Math.max(minimumWidth, x + rightEdges[index] + EDGE_PADDING + 16 * Math.sqrt(Math.max(0, endBeat - beats[index])));
  });
  minimumWidth = Math.ceil(minimumWidth);
  const width = Number.isFinite(availableWidth) ? Math.max(minimumWidth, availableWidth!) : minimumWidth;
  const extra = width - minimumWidth;
  const xs = minimumXs.map((x, index) => x + extra * (beats[index] - 1) / input.beats);
  return { minimumWidth, width, noteXs: notes.map(item => xs[indices.get(item.beat)!]), chordXs: chords.map(item => xs[indices.get(item.beat)!]), chordRows, chordRowCount };
}

export interface MeasureWidth { id: string; minimumWidth: number; }
export interface WrappedMeasure extends MeasureWidth { width: number; headerWidth: number; }
export interface MeasureRow { width: number; measures: WrappedMeasure[]; }
export interface WrapOptions { lineWidth: number; maximumMeasures: number; firstHeaderWidth: number; lineHeaderWidth: number; }

/** A requested measure count is a maximum. A single wide bar gets its own wider row. */
export function wrapMeasures(measures: MeasureWidth[], options: WrapOptions): MeasureRow[] {
  finite(options.lineWidth, 1);
  finite(options.firstHeaderWidth);
  finite(options.lineHeaderWidth);
  const maximum = Number.isFinite(options.maximumMeasures) ? Math.max(1, Math.min(8, Math.round(options.maximumMeasures))) : 4;
  const rows: MeasureRow[] = [];
  let start = 0;
  while (start < measures.length) {
    const headerWidth = rows.length ? options.lineHeaderWidth : options.firstHeaderWidth;
    const selected: WrappedMeasure[] = [];
    let used = 0;
    while (start + selected.length < measures.length && selected.length < maximum) {
      const item = measures[start + selected.length];
      const minimumWidth = finite(item.minimumWidth, 1);
      const header = selected.length ? 0 : headerWidth;
      const width = minimumWidth + header;
      if (selected.length && used + width > options.lineWidth) break;
      selected.push({ ...item, minimumWidth, width, headerWidth: header });
      used += width;
    }
    const width = Math.max(options.lineWidth, used);
    const spare = width - used;
    const musicWidth = selected.reduce((sum, item) => sum + item.minimumWidth, 0);
    for (const item of selected) item.width += spare * item.minimumWidth / musicWidth;
    rows.push({ width, measures: selected });
    start += selected.length;
  }
  return rows;
}
