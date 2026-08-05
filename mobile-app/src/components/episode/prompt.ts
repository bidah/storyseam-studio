// Episode prompt composition — verbatim port of the pure helpers in the web
// app's src/routes/episode.jsx (refLabel, restrictions, parse/serializePrompt,
// and the IMAGE/VOICE reference blocks that prefix the skill prompt sent to
// the agent). Keep in lockstep with the web implementation.

// ---------------------------------------------------------------------------
// Payload types (GET /api/episode, /api/final, /api/audio, /api/storyboard).

export type Shot = {
  id: string;
  dur?: number;
  location?: string;
  camera?: string;
  summary?: string;
  dialogue?: string;
  characters?: string[];
};

export type Bundle = {
  id: string;
  beat?: string;
  beatTitle?: string;
  shots: Shot[];
  images?: { key: string }[];
  durationEst?: number;
  duration?: number;
  skillPrompt?: string;
};

export type VideoTake = {
  file: string;
  url: string;
  name?: string;
  selected?: boolean;
  kind?: 'gen' | 'trim';
};

export type Signature = { by: string; at: string } | null;
export type Signoff = { images: Signature; prompt: Signature; audio: Signature };

export type EpisodePayload = {
  episode: { title?: string; totalShots?: number; bundles: Bundle[] } | null;
  video?: Record<string, VideoTake[]>;
  prompts?: Record<string, string>;
  signoffs?: Record<string, Signoff>;
};

export type FinalPayload = {
  final?: { name: string; url: string; origin: string }[];
  episode?: Record<string, string[]>; // bundleId -> library rel keys
};

export type AudioRef = {
  rel: string;
  label: string;
  order?: string[];
  url: string;
  refUrl?: string; // ungated absolute /files URL — what the agent actually fetches
  exists?: boolean;
};

export type AudioPayload = {
  audio?: AudioRef[];
  episode?: Record<string, string[]>; // bundleId -> audio rel keys
};

export type StillTake = {
  file: string;
  url: string; // the ORIGINAL png — what a video generation is handed
  // Derived WebP tiers (worker/src/lib/images.js). Absent on records written
  // before the pipe existed, so always fall back to `url`.
  thumb?: string; // ~400px, the grid
  display?: string; // ~1600px, the viewer
  name?: string;
  angle?: string;
  selected?: boolean;
};

export type StoryboardPayload = {
  stills?: Record<string, Record<string, StillTake[]>>; // bundle -> shot -> takes
};

// ---------------------------------------------------------------------------
// Reference labels (web refLabel — filename → human label).

export function refLabel(rel: string): string {
  const base = (rel.split('/').pop() || rel).toLowerCase();
  const night = base.includes('night');
  const t = (n: string) => (night ? `${n} (night)` : n);
  if (base.includes('kids')) return 'Elf kids';
  if (base.includes('king') && base.includes('house')) return "King's house";
  if (base.includes('king')) return t('Forest King');
  if (base.includes('sara')) return t('Sara');
  if (base.includes('helena')) return t('Helena');
  if (base.includes('mote') || base.includes('glow')) return t('Mote');
  if (base.includes('deep') && base.includes('forest')) return t('deep wood');
  if (base.includes('school')) return 'school';
  if (base.includes('classroom')) return 'classroom';
  if (base.includes('forest')) return t('forest');
  return base.replace(/\.[a-z0-9]+$/, '');
}

// ---------------------------------------------------------------------------
// Audio / VFX restriction line (first line of the prompt head).

export const RESTRICTIONS = [
  { key: 'noMusic', label: 'no background music', frag: 'NO BACKGROUND MUSIC' },
  { key: 'noVfx', label: 'no visual effects & sounds', frag: 'NO VISUAL EFFECTS AND NO SOUND EFFECTS' },
  { key: 'justDialog', label: 'just dialog', frag: 'ONLY DIALOGUE — NO OTHER AUDIO' },
] as const;

export type RestrictionKey = (typeof RESTRICTIONS)[number]['key'];
export type RestrictionState = Record<RestrictionKey, boolean>;

export function restrictionsFromLine(line: string): RestrictionState {
  return {
    noMusic: /background music/i.test(line),
    noVfx: /visual effects/i.test(line),
    justDialog: /only dialogue|just dialog/i.test(line),
  };
}

export function lineFromRestrictions(state: RestrictionState): string {
  const frags = RESTRICTIONS.filter((r) => state[r.key]).map((r) => r.frag);
  return frags.length ? frags.join('. ') + '.' : '';
}

// ---------------------------------------------------------------------------
// Prompt body <-> sections (restriction line · STYLE line · directives · shots).

export type PromptSections = {
  restrictionLine: string;
  styleLine: string;
  directives: string;
  shots: string[];
};

export function parsePrompt(body: string): PromptSections {
  const shotStart = body.search(/^SHOT \d+ \(/m);
  const head = (shotStart >= 0 ? body.slice(0, shotStart) : body).replace(/\s+$/, '');
  const shotsText = shotStart >= 0 ? body.slice(shotStart) : '';
  const shots = shotsText
    ? shotsText.split(/\n\n(?=SHOT \d+ \()/).map((s) => s.replace(/\s+$/, ''))
    : [];
  const lines = head.split('\n');
  const restrictionLine = lines[0] ?? '';
  const styleIdx = lines.findIndex((l) => /^STYLE:/i.test(l));
  const directives = (styleIdx >= 0 ? lines.slice(styleIdx + 1) : lines.slice(1)).join('\n').trim();
  return { restrictionLine, styleLine: styleIdx >= 0 ? lines[styleIdx] : '', directives, shots };
}

export function serializePrompt({ restrictionLine, styleLine, directives, shots }: PromptSections): string {
  const head = [restrictionLine, styleLine, directives].join('\n');
  return shots.length ? head + '\n\n' + shots.join('\n\n') : head;
}

// ---------------------------------------------------------------------------
// Reference blocks — the prefix composed in front of the skill prompt for the
// agent (and reused alone as the storyboard refBlock). Mirrors EpisodeBundle
// in episode.jsx: web used `im.abs || im.rel`; the Worker never emits `abs`,
// so the rel key is what the agent receives on both platforms.

export function composeRefBlock(rels: string[]): string {
  return rels.length
    ? 'IMAGE REFERENCES (pass each file as an image_references entry):\n' +
        rels.map((rel) => `- ${refLabel(rel)}: ${rel}`).join('\n')
    : 'IMAGE REFERENCES: (none selected yet — use “choose references” above)';
}

export function composeAudioBlock(refs: AudioRef[]): string {
  return refs.length
    ? '\n\nVOICE / SOUND REFERENCES (pass as the audio reference — voice identity, NOT dialogue):\n' +
        refs
          .map(
            (a) =>
              `- ${a.label}: ${a.refUrl || a.url || a.rel}` +
              (a.order && a.order.length > 1
                ? ` — voices appear in this order: ${a.order.map((n, i) => `${i + 1}=${n}`).join(', ')}`
                : ''),
          )
          .join('\n')
    : '';
}

// Sign-off sections, in signing order (web SIGN_SECTIONS).
export const SIGN_SECTIONS = [
  { key: 'images', label: 'Images', hint: 'all references needed for the prompt are assigned' },
  { key: 'prompt', label: 'Prompt', hint: 'the skill prompt is final' },
  { key: 'audio', label: 'Audio', hint: 'the voice / sound references are correct' },
] as const;

export type SignSectionKey = (typeof SIGN_SECTIONS)[number]['key'];

export function signedCount(signoff: Signoff | undefined | null): number {
  if (!signoff) return 0;
  return (['images', 'prompt', 'audio'] as const).filter((k) => signoff[k]).length;
}

// Does the shot have real dialogue (not the "(no dialogue)" placeholder)?
export function shotDialogue(s: Shot): string | null {
  return s.dialogue && !/\(no dialogue\)/i.test(s.dialogue) ? s.dialogue : null;
}
