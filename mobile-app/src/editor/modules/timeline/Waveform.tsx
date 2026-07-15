// Waveform — SVG bar rendering + a diagonal fade envelope for audio cards.
// React Native port of web-editor/src/modules/timeline/Waveform.jsx (which draws
// to a <canvas>). Same public API so the two components are interchangeable:
//   <Waveform peaks width trimFraction fadeInPx fadeOutPx disabled />
// Web reference: /docs/modules/timeline ↔ this: /docs/react-native/timeline
import { memo, useMemo } from "react";
import Svg, { Line, Polygon, Rect } from "react-native-svg";
import { EditorTheme } from "@/editor/theme";

export interface WaveformProps {
  /** Normalized amplitude peaks (0..1). Matches the web `Float32Array`. */
  peaks: ArrayLike<number>;
  /** Rendered width in px. */
  width: number;
  /** Rendered height in px. */
  height?: number;
  /** Fraction of the source that is trimmed-in (0..1) — peaks window start. */
  trimFraction?: number;
  /** Fade ramp widths in px, drawn as a darkening triangle at head/tail. */
  fadeInPx?: number;
  fadeOutPx?: number;
  disabled?: boolean;
  color?: string;
}

function WaveformImpl({
  peaks,
  width,
  height = 28,
  trimFraction = 0,
  fadeInPx = 0,
  fadeOutPx = 0,
  disabled = false,
  color = "#DFF5EC",
}: WaveformProps) {
  const w = Math.max(1, Math.floor(width));
  const mid = height / 2;
  const barW = 2;
  const gap = 1;
  const cols = Math.max(1, Math.floor(w / (barW + gap)));

  const bars = useMemo(() => {
    const n = peaks?.length || 0;
    const out: { x: number; h: number }[] = [];
    if (!n) return out;
    const start = Math.floor(trimFraction * n);
    for (let i = 0; i < cols; i++) {
      const idx = Math.min(n - 1, start + Math.floor((i / cols) * (n - start)));
      const amp = Math.max(0.04, Math.min(1, Number(peaks[idx]) || 0));
      out.push({ x: i * (barW + gap), h: amp * (height - 4) });
    }
    return out;
  }, [peaks, cols, trimFraction, height]);

  return (
    <Svg width={w} height={height} opacity={disabled ? 0.35 : 1}>
      {bars.map((b, i) => (
        <Line
          key={i}
          x1={b.x + barW / 2}
          x2={b.x + barW / 2}
          y1={mid - b.h / 2}
          y2={mid + b.h / 2}
          stroke={color}
          strokeWidth={barW}
          strokeLinecap="round"
        />
      ))}
      {fadeInPx > 0 && (
        <Polygon
          points={`0,0 ${fadeInPx},0 0,${height}`}
          fill={EditorTheme.track}
          opacity={0.55}
        />
      )}
      {fadeOutPx > 0 && (
        <Polygon
          points={`${w},0 ${w},${height} ${w - fadeOutPx},0`}
          fill={EditorTheme.track}
          opacity={0.55}
        />
      )}
      {disabled && <Rect x={0} y={0} width={w} height={height} fill="#000" opacity={0.25} />}
    </Svg>
  );
}

export const Waveform = memo(WaveformImpl);
export default Waveform;
