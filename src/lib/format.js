// Client-side view of the project's FORMAT — feature film vs episodic series.
// See `worker/src/lib/format.js` for what it is and why it lives on the world
// bible. This module is the front-end's copy of the two pickable formats.

export const FORMATS = [
  { id: "feature", label: "Feature film", short: "Feature" },
  { id: "series", label: "Series", short: "Series" },
];

export const DEFAULT_FORMAT = "feature";

export const normalizeFormat = (v) =>
  FORMATS.some((f) => f.id === v) ? v : DEFAULT_FORMAT;

export const isSeries = (v) => normalizeFormat(v) === "series";
