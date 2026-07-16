// Thumbnail + waveform-peak helpers. React Native port of web-editor's
// media/thumbs.js (offscreen <video>→canvas) and media/peaks.js (Web Audio →
// ~1000 peaks). Native has no Web Audio / canvas, so:
//   • peaks are synthesized deterministically from the source id (stable per
//     clip, good enough to render a recognizable waveform shape). A future
//     native module (e.g. a Skia/AudioKit decoder) can drop in behind this API.
//   • thumbnails use `expo-video-thumbnails` for file/remote URIs, with a
//     graceful null fallback (the clip card then falls back to a color tint).
// Web reference: /docs/modules/media ↔ this: /docs/react-native/media
import { useEffect, useMemo, useState } from "react";

// Small string hash (FNV-1a) → deterministic seed per source.
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A stable, pleasant-looking pseudo waveform for a source (0..1 amplitudes).
export function getAudioPeaks(src: string, count = 400): Float32Array {
  const out = new Float32Array(count);
  let s = hash(src) || 1;
  const rand = () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000) / 1000;
  };
  let env = 0.5;
  for (let i = 0; i < count; i++) {
    env += (rand() - 0.5) * 0.4;
    env = Math.max(0.12, Math.min(1, env));
    // add a syllabic beat so it reads as audio
    const beat = 0.5 + 0.5 * Math.abs(Math.sin(i * 0.35 + (s % 7)));
    out[i] = Math.max(0.05, Math.min(1, env * beat));
  }
  return out;
}

export function useAudioPeaks(src: string | null | undefined, count = 400): Float32Array {
  return useMemo(() => getAudioPeaks(src || "", count), [src, count]);
}

// A deterministic tint for a clip lacking a real thumbnail. `src` is nullable
// because a slate (an animatic image item with no still yet) has none — it
// tints by name instead, so every slate doesn't collapse to the same color.
export function colorForSrc(src: string | null | undefined): string {
  const h = hash(src || "") % 360;
  return `hsl(${h}, 45%, 42%)`;
}

// Try to produce a poster thumbnail. `uri` must be a file:// or http(s) URL;
// bundled `require()` sources return null (card falls back to color).
export function useVideoThumb(uri: string | null): string | null {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // Reset when the source changes; correct here (not a cascading render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThumb(null);
    if (!uri || !/^(file|https?):/.test(uri)) return;
    (async () => {
      try {
        const VT = await import("expo-video-thumbnails");
        const { uri: out } = await VT.getThumbnailAsync(uri, { time: 200, quality: 0.4 });
        if (alive) setThumb(out);
      } catch {
        if (alive) setThumb(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [uri]);
  return thumb;
}
