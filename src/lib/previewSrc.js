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
