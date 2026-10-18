export type NoteDuration = 'w' | 'h' | 'q' | '8' | '16';
export type SectionType = 'intro' | 'verse' | 'prechorus' | 'chorus' | 'bridge' | 'interlude' | 'outro';

export interface NoteLyric {
  number: string;
  text: string;
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
  extend?: 'start' | 'continue' | 'stop';
  endLine?: boolean;
}

export interface ScoreNote {
  id: string;
  pitch: string | null;
  duration: NoteDuration;
  dots: 0 | 1;
  lyric: string;
  /** All numbered lyric lines; lyric mirrors number 1, or the first line when 1 is absent. */
  lyrics?: NoteLyric[];
  tie: boolean;
}
export interface ScoreChord { id: string; beat: number; symbol: string; }
export interface ScoreMeasure {
  id: string;
  notes: ScoreNote[];
  chords: ScoreChord[];
  /** Actual length in quarter-note beats for a pickup or explicitly shortened measure. */
  actualBeats?: number;
  /** Explicitly opened for correction; note lengths do not yet match the expected measure length. */
  rhythmReview?: true;
}
export interface ScoreSection { id: string; label: string; type: SectionType; measures: ScoreMeasure[]; }
export interface FormEntry { id: string; sectionId: string; repeat: number; }
export interface Score {
  version: 1;
  title: string;
  artist: string;
  key: string;
  timeSignature: string;
  tempo: number;
  sections: ScoreSection[];
  form: FormEntry[];
  warnings: string[];
  source: 'sample' | 'manual' | 'ai';
}
export interface ExportLyricsOptions { sectionNames?: boolean; includeInstrumentals?: boolean; verse?: string | 'all'; }
export interface RecognitionUsage { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens: number; }
export interface RecognitionResult { score: Score; model: string; provider: string; elapsedMs: number; usage: RecognitionUsage | null; cost?: number; }
