// Shared shapes for the Assets tab (Library | Import | Sounds) — mirrors the
// Worker payloads consumed by the web app's library.jsx / sounds.jsx.

export type LibraryImage = {
  rel: string;
  url: string;
  thumb?: string | null;
  name: string;
  selected?: boolean;
};

export type LibraryFolder = {
  folder: string;
  count: number;
  preview?: string | null;
  images: LibraryImage[];
};

export type HfItem = {
  id: string;
  model?: string;
  prompt?: string;
  width?: number | null;
  height?: number | null;
  rawUrl: string;
  minUrl: string;
  thumb?: string;
  createdAt?: string | null;
};

export type TrackKind = 'music' | 'sfx' | 'voice';

export type SoundVersion = {
  v: number;
  name?: string | null;
  prompt: string;
  status: 'ready' | 'pending';
  url?: string | null;
  file?: string | null;
  duration?: number | null;
  liked?: boolean;
  ref?: { name?: string | null; url?: string | null };
  seedText?: string | null;
  seedUrl?: string | null;
};

export type SoundTrack = {
  id: string;
  name: string;
  kind?: TrackKind;
  versions: SoundVersion[];
};

// Port of the web sounds.jsx trackKind(): explicit `kind` wins; older kindless
// tracks fall back to sniffing the v1 prompt for the builders' fixed lead-ins,
// defaulting to music.
const SFX_RE = /^\s*use the seed audio prompt to create a sound effect/i;
const VOICE_RE = /^\s*(@audio\d|use a seed audio voice reference to voice-act)/i;

export function trackKind(t: SoundTrack): TrackKind {
  if (t.kind === 'voice' || t.kind === 'sfx' || t.kind === 'music') return t.kind;
  const v1 = (t.versions || []).find((v) => v.v === 1) || (t.versions || [])[0];
  const p = v1?.prompt || '';
  if (VOICE_RE.test(p)) return 'voice';
  return SFX_RE.test(p) ? 'sfx' : 'music';
}
