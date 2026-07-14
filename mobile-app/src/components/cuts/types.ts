// Shapes of GET /api/episode/cuts — the complete-cut manifest (verified against
// the web app's src/routes/cuts.jsx). `output` is the latest immutable
// generation; `history` keeps every generation newest-first, each frozen with
// the segments/music it was baked from so an old version always plays exactly
// as rendered.

export type CutSegment = {
  id: string;
  name?: string;
  file?: string | null;
  start: number;
  end: number;
  duration?: number;
  selected?: string | null;
  fallback?: boolean;
  missing?: boolean;
  musicCue?: { label?: string } | null;
};

export type CutCue = {
  track: string;
  label: string;
  name?: string;
  start: number;
  beatEnd: number;
};

export type CutGen = {
  v: number;
  kind: 'scored' | 'base';
  url: string;
  at?: string;
  segments?: CutSegment[];
  music?: CutCue[];
  range?: { from?: string; to?: string };
  totalDuration?: number;
  gainDb?: number;
};

export type CutsPayload = {
  range?: { from?: string; to?: string };
  segments?: CutSegment[];
  music?: CutCue[];
  history?: CutGen[];
  output?: CutGen | null;
};

export function segDuration(s: CutSegment): number {
  return typeof s.duration === 'number' ? s.duration : Math.max(0, s.end - s.start);
}

// m:ss — port of the web app's fmtTime in components/shared.
export function fmtTime(sec?: number | null): string {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '0:00';
  const s = Math.round(n);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
