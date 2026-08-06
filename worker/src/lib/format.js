// The project's FORMAT — a one-off feature film, or an episodic SERIES. Chosen
// once on the World tab (right after the production type) and read wherever the
// app has to decide whether the episode axis exists.
//
// A feature is a single implicit episode: no episode switcher, no per-episode
// rosters, everything behaves exactly as it did before this field existed. A
// series lets the author create episodes; each episode gets its own script, shot
// list, animatic, editor and cut, while the world bible (title, logline, story
// map, locations, and the character LIBRARY) is shared across all of them.
//
// `feature` is the default and what every pre-existing project is: an absent
// field must keep behaving as a single-episode project.

export const FORMATS = [
  { id: "feature", label: "Feature film", short: "Feature" },
  { id: "series", label: "Series", short: "Series" },
];

export const FORMAT_IDS = FORMATS.map((f) => f.id);

export const DEFAULT_FORMAT = "feature";

// Anything unrecognised — absent, empty, a typo, an old doc — reads as a feature.
export const normalizeFormat = (v) =>
  FORMAT_IDS.includes(String(v || "")) ? String(v) : DEFAULT_FORMAT;

export const isSeries = (v) => normalizeFormat(v) === "series";
