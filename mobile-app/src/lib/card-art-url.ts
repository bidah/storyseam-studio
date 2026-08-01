import { API_ORIGIN } from './env';
import { cardArtPath } from './card-art';

// The phone's half of the card artwork: the shared map (lib/card-art.ts, which
// is VENDORED from the web app and holds the prose about what lives where)
// stores worker-relative paths, and this puts the configured origin in front.
//
// Split in two so the map itself stays import-free and can be copied verbatim
// between the two apps — an `API_ORIGIN` import inside it would make it
// un-vendorable, since the web app is same-origin with the Worker and has no
// such constant.

/**
 * The looping artwork for a suggestion card as a fully-qualified URL, or
 * undefined if it has none. `id` is the card id from buildSuggestions.
 */
export function cardArt(id: string): string | undefined {
  const rel = cardArtPath(id);
  // Joined to the origin here rather than through mediaUrl(), which appends
  // ?projectId= — these files are the APP's own art, identical for everyone, and
  // /files/* serves them without it. A per-project query string would give the
  // same handful of videos a different cache key in every project, i.e.
  // re-download them on every project switch for no reason at all.
  return rel ? API_ORIGIN + rel : undefined;
}
