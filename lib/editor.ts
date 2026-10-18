import { durationBeats, measureBeats } from './music.ts';
import type { NoteDuration, ScoreMeasure, ScoreNote } from './score-types.ts';

/** Represent explicit silence exactly, using only the editor's supported note values. */
export function createRestNotes(beats: number): ScoreNote[] {
  if (!Number.isFinite(beats) || beats <= 0 || beats > 384 || !Number.isInteger(beats * 8)) throw new Error('빈 시간(forward)은 지원하는 쉼표로 표현할 수 있는 양의 길이여야 합니다.');
  let remaining = beats;
  const notes: ScoreNote[] = [];
  const choices = (['w', 'h', 'q', '8', '16'] as const).flatMap(duration => ([1, 0] as const).map(dots => ({ duration, dots })));
  while (remaining > 0) {
    const choice = choices.find(choice => {
      const value = durationBeats(choice);
      return value <= remaining && remaining - value !== 0.125;
    });
    if (!choice || notes.length >= 64) throw new Error('이 길이는 지원하는 쉼표 64개 이내로 표현할 수 없습니다.');
    notes.push({ id: crypto.randomUUID(), pitch: null, ...choice, lyric: '', tie: false });
    remaining -= durationBeats(notes.at(-1)!);
  }
  return notes;
}

export function createEmptyMeasure(timeSignature: string, actualBeats?: number): ScoreMeasure {
  const match = /^(\d{1,2})\/(2|4|8|16)$/.exec(timeSignature);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) throw new Error('박자는 1~12 / 2·4·8·16 형식이어야 합니다.');
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  const whole = numerator * 4 / denominator === 4;
  const durations: Record<number, NoteDuration> = { 2: 'h', 4: 'q', 8: '8', 16: '16' };
  if (actualBeats !== undefined) {
    return { id: crypto.randomUUID(), notes: createRestNotes(measureBeats({ actualBeats }, timeSignature)), chords: [], actualBeats };
  }
  return {
    id: crypto.randomUUID(),
    notes: Array.from({ length: whole ? 1 : numerator }, () => ({
      id: crypto.randomUUID(),
      pitch: null,
      duration: whole ? 'w' : durations[denominator],
      dots: 0,
      lyric: '',
      tie: false,
    })),
    chords: [],
  };
}
