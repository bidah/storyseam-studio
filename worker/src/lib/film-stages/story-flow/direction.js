// The direction ONE segment is prompted with — shared by both story engines'
// compilers (./prompts.js for Seedance, ../h3/prompts.js for H3).
//
// The Shot list writes a film-wide `direction` (environment, camera, sound)
// that is pasted into every segment's prompt. Told the film's arc, a writer
// narrates it there — "moves from the soft light of a Brooklyn apartment to
// the harsh daylight of a busy street and a concrete skate spot" — and a
// video model renders every place a prompt names: segment 1 of film-1fd51691
// (2026-09-27) played apartment → street → skate park in its fifteen seconds,
// segment 3 detoured through the apartment, segment 4 opened there.
//
// Two defences, both here. The writer now gives each SEGMENT its own
// `environment` and `sound` (its place at that moment), which win outright.
// And a film-wide field that names ANOTHER World place than the segment's is
// dropped rather than pasted: the places are the sheets' plates (every World
// location has one), and a place is "named" when one of the significant words
// of its name — "apartment", "street", "skate", "spot", not "the" or "Leo's" —
// appears in the text and is not also a word of this segment's own place.
const key = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

/** Words of a place name that name it: lower-cased, no articles, no possessives, 3+ letters. */
const STOP = new Set(["the", "a", "an", "of", "and", "at", "in", "on", "old", "new", "big", "little"]);
export function placeWords(name) {
  return [...new Set(
    key(name)
      .replace(/['’]s\b/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  )];
}

/**
 * True when `text` names a World place other than `here`. `places` are the
 * World's place names; a word shared with `here`'s own name never counts
 * ("The Skate Spot" and "The Skate Shop" both say skate).
 */
export function namesOtherPlace(text, here, places) {
  const t = ` ${key(text).replace(/[^a-z0-9]+/g, " ")} `;
  if (!t.trim()) return false;
  const own = new Set(placeWords(here));
  return (places || [])
    .filter((p) => key(p) !== key(here))
    .some((p) => placeWords(p).some((w) => !own.has(w) && t.includes(` ${w} `)));
}

/** The World's place names as the sheets know them: the plates' subjects. */
export const platePlaces = (refs) => [...new Set((refs || []).filter((r) => r?.view === "plate").map((r) => str(r.subject)).filter(Boolean))];

/**
 * { environment, camera, sound } for one segment: the segment's own
 * `environment` / `sound` when the writer gave them; otherwise the film-wide
 * field, unless it names another place — then nothing (the segment's stages
 * and its plate carry the place). `camera` is film-wide only, filtered the
 * same way.
 */
export function segmentDirection(segment, direction, refs) {
  const places = platePlaces(refs);
  const here = str(segment?.location);
  const keep = (text) => {
    const t = str(text);
    return t && !namesOtherPlace(t, here, places) ? t : "";
  };
  return {
    environment: str(segment?.environment) || keep(direction?.environment),
    camera: keep(direction?.camera),
    sound: str(segment?.sound) || keep(direction?.sound),
  };
}
