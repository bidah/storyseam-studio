import { API_ORIGIN } from './env';

// Motion artwork for the Home tab's derived deck ("Continue building your
// story" — see app/(tabs)/chat/index.tsx).
//
// The suggestion card was always designed as a POSTER whose top band is a
// picture slot, with the mesh gradient standing in until real art existed. This
// is that art, for the cards that have it: a short silent loop instead of a
// still, because these cards are about a MOVE the studio can make and a loop
// says "this does something" in a way a frozen frame doesn't.
//
// Like the Discover heroes (lib/discover.ts) the files live in R2 behind the
// Worker rather than in the binary. Three reasons, in order of how much they
// cost to get wrong:
//   1. Art is content. A better loop swaps in with an `r2 object put` — no new
//      build, not even an OTA.
//   2. The bundle stays small. Four loops is ~4MB of video that most sessions
//      never scroll to.
//   3. `/files/*` answers Range requests, which is what expo-video's disk cache
//      needs (see useCaching at the call site) — so it downloads once per
//      device and every later launch plays off disk.
// Stored RELATIVE so the configured API origin goes in front at read time; a
// hardcoded workers.dev URL would break the moment the Worker moves.
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
// A card with no entry here keeps the mesh band. That's the intended fallback,
// not a gap to be filled with a stand-in: a generic loop under a specific
// headline reads as a mistake, an abstract gradient reads as a design.
const ART: Record<string, string> = {
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

/**
 * The looping artwork for a suggestion card, or undefined if it has none (which
 * leaves it wearing its mesh band). `id` is the card id from buildSuggestions.
 */
export function cardArt(id: string): string | undefined {
  // Exact id first, so a review card can claim its own loop; failing that,
  // review-plot_doctor / rereview-plot_doctor → plot_doctor, because a re-check
  // with no art of its own is the same doctor asking again.
  const rel = ART[id] ?? ART[id.replace(/^(?:re)?review-/, '')];
  // Joined to the origin here rather than through mediaUrl(), which appends
  // ?projectId= — these files are the APP's own art, identical for everyone, and
  // /files/* serves them without it. A per-project query string would give the
  // same four videos a different cache key in every project, i.e. re-download
  // them on every project switch for no reason at all.
  return rel ? API_ORIGIN + rel : undefined;
}
