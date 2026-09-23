// Map a full-res media src to its 720p preview-proxy src for editor playback /
// scrubbing / thumbnails / waveforms. The Worker serves `/proxy/<prefix>/<file>`
// (falling back to the original with a short TTL until the proxy is generated),
// so the client just rewrites the path prefix; any `?v=` cache-bust query rides
// along untouched.
//
// INTENTIONALLY relative-only. The preview always uses relative srcs
// ("/gen/x?v=1"). The headless export absolutizes tracks to "<worker>/files/..."
// (render.js) and MUST keep originals — passing those through here is a no-op,
// which is the point: previews get proxies, exports get originals.
const MAP = [
  ["/gen/", "/proxy/gen/"],
  ["/multishot-media/", "/proxy/multishot-media/"],
  ["/sound-media/", "/proxy/sound-media/"],
];

export function toPreviewSrc(src) {
  if (!src || typeof src !== "string") return src;
  for (const [from, to] of MAP) {
    if (src.startsWith(from)) return to + src.slice(from.length);
  }
  return src;
}

// The same idea for IMAGES: rewrite an original image path to one of the two
// WebP tiers the Worker derives (`/img/<tier>/<prefix>/<file>` — see
// worker/src/lib/images.js). `thumb` fits a 400px box, `display` a 1600px one;
// both fall back to the original until the encode lands, so a fresh generation
// is never a broken tile.
//
// Relative-only for exactly the reason above: the export path absolutizes to
// "<worker>/files/…" and must keep the untouched original, and a generation
// provider is handed `refUrl`, never one of these. Passing an absolute URL
// through here is a deliberate no-op.
const IMAGE_PREFIXES = [
  "/storyboard-media/",
  "/visual-media/",
  "/moodboard-media/",
  "/stills/",
  "/asset/",
];

export function toImageSrc(src, tier = "thumb") {
  if (!src || typeof src !== "string") return src;
  for (const p of IMAGE_PREFIXES) {
    if (src.startsWith(p)) return `/img/${tier}${p}${src.slice(p.length)}`;
  }
  return src;
}

export const toThumbSrc = (src) => toImageSrc(src, "thumb");
export const toDisplaySrc = (src) => toImageSrc(src, "display");

// The src a tile is PAINTED with → the src its full-screen preview should OPEN.
//
// Zooming should land on the ~1600px `display` webp: the thumb is a 400px box,
// so a lightbox blows it up (or, in a natural-size dialog, draws a postage
// stamp), and the original is multiple megabytes of resolution nobody is
// looking at on screen. Both ends are handled — a `/img/thumb/…` tile upgrades
// a tier, a raw original steps down to one — so a caller can hand this whatever
// it happens to have and get the right middle tier back. Anything else (an
// absolute provider URL, a data: uri, a legacy `/thumb/<rel>`) passes through
// untouched.
export function toZoomSrc(src) {
  if (!src || typeof src !== "string") return src;
  if (src.startsWith("/img/thumb/")) {
    return "/img/display/" + src.slice("/img/thumb/".length);
  }
  return toDisplaySrc(src);
}
