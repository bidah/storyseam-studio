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
// under the author. Review cards key off the DOCTOR (`review-<id>` and
// `rereview-<id>` are the same subject, so they wear the same loop); everything
// else keys off the card id from lib/suggestions.ts verbatim.
//
// A card with no entry here keeps the mesh band. That's the intended fallback,
// not a gap to be filled with a stand-in: a generic loop under a specific
// headline reads as a mistake, an abstract gradient reads as a design.
const ART: Record<string, string> = {
  // "Shape the arc" — the story architect.
  story_architect:
    '/files/chat-uploads/0f4b3d21-6c8a-4d1e-9a77-1b2c5e8f3a90-card-shape-the-arc.mp4',
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
  // review-plot_doctor / rereview-plot_doctor → plot_doctor. A re-check is the
  // same doctor asking again, so it gets the same picture.
  const rel = ART[id.replace(/^(?:re)?review-/, '')];
  // Joined to the origin here rather than through mediaUrl(), which appends
  // ?projectId= — these files are the APP's own art, identical for everyone, and
  // /files/* serves them without it. A per-project query string would give the
  // same four videos a different cache key in every project, i.e. re-download
  // them on every project switch for no reason at all.
  return rel ? API_ORIGIN + rel : undefined;
}
