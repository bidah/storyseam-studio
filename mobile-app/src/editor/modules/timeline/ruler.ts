// Timeline ruler + lane geometry constants and the adaptive tick model.
// Verbatim port of web-editor/src/modules/timeline/ruler.js, with native lane
// heights tuned for touch targets. Web reference: /docs/modules/timeline.

// Height of one timeline lane, in px. Larger than web (touch targets).
export const LANE_H = 56;
// Each lane group shows at most this many lanes before scrolling.
export const MAX_VISIBLE_LANES = 3;
// Magnet pull radius in px (converted to frames at the current zoom).
export const SNAP_PX = 12;

// Candidate ruler intervals (seconds) + how many minor ticks subdivide each
// labelled major. We pick the smallest step whose on-screen spacing clears the
// label-width target so labels never collide.
export const TICK_STEPS = [
  { step: 0.5, minors: 5 },
  { step: 1, minors: 4 },
  { step: 2, minors: 4 },
  { step: 5, minors: 5 },
  { step: 10, minors: 5 },
  { step: 15, minors: 3 },
  { step: 30, minors: 6 },
  { step: 60, minors: 4 },
  { step: 120, minors: 4 },
  { step: 300, minors: 5 },
  { step: 600, minors: 5 },
  { step: 900, minors: 3 },
  { step: 1800, minors: 6 },
  { step: 3600, minors: 4 },
];

// Pick the tick step whose on-screen spacing (in px) is at least `minPx`.
export function pickTickStep(pxPerSec: number, minPx = 56) {
  for (const t of TICK_STEPS) {
    if (t.step * pxPerSec >= minPx) return t;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

// Format seconds as a timecode label. Below one hour the hours field is dropped;
// when the tick step is sub-second a frames field is appended.
export function formatTimecode(totalSec: number, fps: number, withFrames?: boolean): string {
  const sign = totalSec < 0 ? "-" : "";
  const t = Math.abs(totalSec);
  const whole = Math.floor(t);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  if (!withFrames) return sign + base;
  const f = Math.round((t - whole) * fps);
  return `${sign}${base}:${pad(f)}`;
}
