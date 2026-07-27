import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useColors } from './colors';

// The colour a picture is mostly made of, and a blurhash of the picture itself.
//
// Both come from ONE artefact: the blurhash. Its first component (the "DC"
// term, base83 chars 2–6) is the image's average colour in sRGB — which is
// exactly the tint a text block under the picture wants — so generating a hash
// gives us the placeholder AND the palette in a single decode. No native
// palette extractor, no second download, nothing to rebuild the binary for:
// `Image.generateBlurhashAsync` is already part of expo-image.
//
// Hashes are cached twice over: a module Map for the session, and AsyncStorage
// so the SECOND launch can blur-up an image before it has finished downloading.
// The first sight of a remote image can't be blurred — you need the pixels to
// hash them — which is why the shipped hero carries a hash computed at build
// time (see discover.ts) rather than waiting to learn its own.

export type Tint = {
  /** Fill for the text block — the picture's own colour, tuned to the theme. */
  background: string;
  /** Text that stays legible on it. */
  foreground: string;
  /** Secondary text on it. */
  subtle: string;
};

type RGB = { r: number; g: number; b: number };

const BASE83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function decode83(str: string): number {
  let value = 0;
  for (const char of str) {
    const index = BASE83.indexOf(char);
    if (index < 0) return -1;
    value = value * 83 + index;
  }
  return value;
}

/**
 * The average colour a blurhash encodes. Chars 2–6 are the DC term, packed as
 * three sRGB bytes — so this is a string parse, not an image decode.
 */
export function blurhashColor(hash: string | undefined): RGB | null {
  if (!hash || hash.length < 6) return null;
  const value = decode83(hash.slice(2, 6));
  if (value < 0) return null;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

const hex = ({ r, g, b }: RGB) =>
  '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

function parseHex(value: string): RGB {
  const s = value.replace('#', '');
  const full = s.length === 3 ? [...s].map((c) => c + c).join('') : s;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// Perceived brightness (sRGB luma), which is what decides whether white or near
// black sits on top. Cheap and good enough — a full WCAG contrast ratio would
// pick the same side of every colour we actually get out of a photo.
const luma = ({ r, g, b }: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Turn an image's average colour into a usable text-block palette. The raw
 * average of a photograph is usually a washed mid-tone, so it gets pulled 22%
 * toward the page behind it: enough to still read as "this picture's colour",
 * dark enough (or light enough) to belong to the app rather than glow out of it.
 */
export function tintFrom(rgb: RGB | null, pageBg: string): Tint | null {
  if (!rgb) return null;
  const base = mix(rgb, parseHex(pageBg), 0.22);
  const light = luma(base) > 0.6;
  return {
    background: hex(base),
    foreground: light ? '#111114' : '#ffffff',
    subtle: light ? 'rgba(17,17,20,0.72)' : 'rgba(255,255,255,0.78)',
  };
}

// --- The hash itself --------------------------------------------------------

const CACHE_PREFIX = 'blurhash:';
const memory = new Map<string, string>();

async function loadHash(uri: string): Promise<string | undefined> {
  const cached = memory.get(uri);
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(CACHE_PREFIX + uri);
    if (stored) {
      memory.set(uri, stored);
      return stored;
    }
  } catch {
    /* storage is a nicety here — a miss just means we hash again */
  }
  // 4×3 components: enough structure that the blur reads as the picture
  // (horizon, subject, sky) without the hash growing into a string worth
  // worrying about.
  const hash = await Image.generateBlurhashAsync(uri, [4, 3]);
  if (!hash) return undefined;
  memory.set(uri, hash);
  AsyncStorage.setItem(CACHE_PREFIX + uri, hash).catch(() => {});
  return hash;
}

/**
 * The blurhash for `uri` and the tint that follows from it.
 *
 * Pass `seed` when the hash is already known (a shipped image whose hash was
 * computed at build time) — then both are available on the FIRST frame, before
 * a byte of the picture has arrived, which is the only way the blur-up is
 * visible on a cold start.
 */
export function useImageTint(uri: string | undefined, seed?: string) {
  const colors = useColors();
  const [generated, setGenerated] = useState<string | undefined>(() =>
    uri ? memory.get(uri) : undefined,
  );

  useEffect(() => {
    if (seed || !uri || memory.get(uri)) return;
    let alive = true;
    loadHash(uri)
      .then((hash) => {
        if (alive && hash) setGenerated(hash);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uri, seed]);

  const blurhash = seed ?? (uri ? (generated ?? memory.get(uri)) : undefined);

  return useMemo(
    () => ({ blurhash, tint: tintFrom(blurhashColor(blurhash), colors.pageBg) }),
    [blurhash, colors.pageBg],
  );
}
