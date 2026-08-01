// Motion artwork for the derived deck ("Continue building your story") — THE
// source of truth for both surfaces: the web AgentChat landing and, vendored,
// the mobile Chat tab (mobile-app/src/lib/card-art.ts, refreshed by
// `npm --prefix mobile-app run sync:suggestions`). Edit this file, not the copy.
//
// The suggestion card was always designed as a POSTER whose top band is a
// picture slot, with a placeholder standing in until real art existed. This is
// that art, for the cards that have it: a short silent loop instead of a still,
// because these cards are about a MOVE the studio can make and a loop says
// "this does something" in a way a frozen frame doesn't.
//
// Like the Discover heroes the files live in R2 behind the Worker rather than in
// any bundle. Three reasons, in order of how much they cost to get wrong:
//   1. Art is content. A better loop swaps in with an `r2 object put` — no new
//      build, not even an OTA.
//   2. The bundle stays small. The loops are ~1MB each, and most sessions never
//      scroll to half of them.
//   3. `/files/*` answers Range requests, which is what a video element's
//      caching needs — so it downloads once per device and every later launch
//      plays off disk.
//
// Paths are stored RELATIVE, which is also what makes this file vendorable: the
// web app is same-origin with the Worker and uses them as they are, while the
// phone joins its configured API origin on the front (see
// mobile-app/src/lib/card-art-url.ts). A hardcoded workers.dev URL would break
// the moment the Worker moves, and an `API_ORIGIN` import here would make the
// file un-copyable to a platform that spells that differently.
//
// Keyed by the card's own identity, NOT its position — the deck reorders every
// time a stage completes, so a positional key would shuffle the artwork around
// under the author. Keys are card ids from lib/suggestions.ts verbatim, and a
// review card falls back to its DOCTOR when it has no entry of its own
// (`review-<id>` and `rereview-<id>` are the same subject, so by default they
// wear the doctor's loop). Spelling the full id out overrides that — which is
// how "Re-check with the story architect" gets its own art instead of "Shape
// the arc"'s: an exact key always wins over the fallback.
//
// A card with no entry here keeps its plain band. That's the intended fallback,
// not a gap to be filled with a stand-in: a generic loop under a specific
// headline reads as a mistake, an abstract gradient reads as a design.
export const CARD_ART: Record<string, string> = {
  // "Shape the arc" — the story architect, when it has never read the draft.
  story_architect:
    '/files/chat-uploads/0f4b3d21-6c8a-4d1e-9a77-1b2c5e8f3a90-card-shape-the-arc.mp4',
  // "Re-check with the story architect" — the SECOND pass, so it gets its own
  // loop rather than inheriting the arc one. The two cards sit in the same deck
  // whenever a draft has moved on, and one picture under both headlines reads as
  // the same card drawn twice.
  'rereview-story_architect':
    '/files/chat-uploads/78e275e0-4127-4326-b9bd-a4a70dc3d2e3-card-story-architect.mp4',
  // "Find the whys" — the motivation doctor.
  motivation_doctor:
    '/files/chat-uploads/c42e8f3b-6667-45f4-bad0-fca6eccc00cb-card-find-the-whys.mp4',
  // "Hunt the plot holes" — the plot doctor.
  plot_doctor: '/files/chat-uploads/735c2982-53ec-42c0-8783-55d8614d184b-card-plot-hole.mp4',
  // "Design the cast" — the missing character sheets.
  'sheets-characters':
    '/files/chat-uploads/2ea5449f-d572-4d13-ac79-6345697add82-card-design-the-cast.mp4',
  // "Extend your world" — more cast and places for a bible that's already full.
  'world-extend':
    '/files/chat-uploads/8a91c7de-2b04-4f5a-9c63-7d1e04b6a2f5-card-extend-your-world.mp4',
  // "Write your script" — the bible that's ready to become an episode.
  'script-start':
    '/files/chat-uploads/48eb5299-896a-47c3-87a5-76ee86da3139-card-write-your-script.mp4',
  // "Break it into shots" — the script that's ready to become a shot list.
  'shotlist-create':
    '/files/chat-uploads/6626871f-3455-43aa-87cd-6354cc6b47cb-card-break-it-into-shots.mp4',
  // "Board the episode" — the shots still waiting on a storyboard still.
  'storyboard-fill':
    '/files/chat-uploads/3c6e91a4-58bd-4f02-b7e5-9d2a10c4ef37-card-board-the-episode.mp4',
  // "Voice the episode" — casting the roster and rendering the radio.
  'radio-voice':
    '/files/chat-uploads/5d7f28b0-91ac-4e63-8f15-6b3c07d9ae42-card-voice-the-episode.mp4',
  // "Where does it stand?" — the read on the whole episode. The one card that
  // fits every stage, so this loop is the one an author sees most.
  status: '/files/chat-uploads/e1b83f56-4d70-4a29-b60e-27f9c8e5d413-card-where-does-it-stand.mp4',
};

// --- The band under the artwork ---------------------------------------------
// What the picture slot shows before the first video frame lands, what it falls
// back to when a card has no loop of its own, and what it keeps showing if the
// file never arrives. Every card gets its own look, and that look is DERIVED,
// never rolled: the palette comes from a seed, so the same card wears the same
// header on every launch. The seed is always an IDENTITY (the card id) hashed
// through `meshSeed`, never a list position — the deck reorders every time a
// stage completes, and a position-seeded header would repaint the whole screen
// each time. A random pick would do the same on every launch.
//
// Nine colours because the phone renders them as a 3×3 SwiftUI/Compose mesh
// (expo-mesh-gradient), where the vertices bleed into each other so every card
// reads as its own little piece of art. The web builds a stack of radial
// gradients from the same nine, which is as close as CSS gets.

export const MESH_PALETTES: readonly (readonly string[])[] = [
  // emerald — the app's own accent
  ['#6ee7b7', '#34d399', '#059669', '#a7f3d0', '#10b981', '#047857', '#d1fae5', '#6ee7b7', '#065f46'],
  // violet / indigo
  ['#c4b5fd', '#a78bfa', '#6366f1', '#ddd6fe', '#818cf8', '#4f46e5', '#ede9fe', '#a5b4fc', '#4338ca'],
  // amber / orange
  ['#fde68a', '#fbbf24', '#f97316', '#fef3c7', '#fb923c', '#ea580c', '#fef9c3', '#fdba74', '#c2410c'],
  // sky / cyan
  ['#bae6fd', '#38bdf8', '#06b6d4', '#e0f2fe', '#22d3ee', '#0891b2', '#f0f9ff', '#67e8f9', '#0e7490'],
  // rose / fuchsia
  ['#fbcfe8', '#f472b6', '#db2777', '#fce7f3', '#e879f9', '#be185d', '#fdf2f8', '#f0abfc', '#9d174d'],
  // lime / teal
  ['#d9f99d', '#a3e635', '#14b8a6', '#ecfccb', '#65a30d', '#0d9488', '#f7fee7', '#bef264', '#115e59'],
  // slate / steel blue
  ['#cbd5e1', '#94a3b8', '#475569', '#e2e8f0', '#64748b', '#334155', '#f1f5f9', '#a5b4fc', '#1e293b'],
  // coral / red
  ['#fecaca', '#f87171', '#dc2626', '#fee2e2', '#fb7185', '#b91c1c', '#fef2f2', '#fda4af', '#7f1d1d'],
];

// Where the mesh's nine vertices sit (the phone's renderer only). Just the
// inner ones move between shapes — the corners stay pinned or the gradient
// detaches from the card's edges.
export const MESH_SHAPES: readonly (readonly (readonly number[])[])[] = [
  [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]],
  [[0, 0], [0.6, 0], [1, 0], [0, 0.4], [0.35, 0.6], [1, 0.35], [0, 1], [0.45, 1], [1, 1]],
  [[0, 0], [0.35, 0], [1, 0], [0, 0.6], [0.65, 0.35], [1, 0.65], [0, 1], [0.6, 1], [1, 1]],
  [[0, 0], [0.5, 0], [1, 0], [0, 0.3], [0.7, 0.7], [1, 0.6], [0, 1], [0.3, 1], [1, 1]],
];

/** FNV-1a, so a card id maps to a stable number without pulling in a hash lib. */
export function meshSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The nine colours this card's band is painted from. */
export function meshPalette(seed: number): readonly string[] {
  return MESH_PALETTES[seed % MESH_PALETTES.length];
}

/**
 * Which vertex layout this card's mesh uses. Shifted off the palette's own
 * digit so two cards sharing a palette still differ in shape, and so small
 * seeds don't all land on shape 0.
 */
export function meshShape(seed: number): readonly (readonly number[])[] {
  return MESH_SHAPES[(Math.floor(seed / MESH_PALETTES.length) + seed * 3) % MESH_SHAPES.length];
}

/**
 * The looping artwork for a suggestion card as a WORKER-RELATIVE path, or
 * undefined if it has none (which leaves the card wearing its plain band).
 * `id` is the card id from buildSuggestions.
 */
export function cardArtPath(id: string): string | undefined {
  // A finished card keeps the picture it had — that's most of what makes it
  // recognisable as the thing you did, rather than a grey rectangle with a
  // badge on it — so the ledger's `done-` prefix is stripped before lookup, the
  // same way a re-check falls back to its doctor.
  const base = id.replace(/^done-/, '');
  // Exact id first, so a review card can claim its own loop; failing that,
  // review-plot_doctor / rereview-plot_doctor → plot_doctor, because a re-check
  // with no art of its own is the same doctor asking again.
  return CARD_ART[base] ?? CARD_ART[base.replace(/^(?:re)?review-/, '')];
}
