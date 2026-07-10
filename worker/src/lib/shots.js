// One shot's canonical field set (ported verbatim from server/index.js
// normalizeShot). `i` is the shot's zero-based position; `n` is 1-based.
export function normalizeShot(s, i) {
  const n = i + 1;
  return {
    n,
    id: s.id || String(n).padStart(2, "0"),
    src: s.src || s.id || String(n).padStart(2, "0"),
    beat: s.beat || "",
    beatTitle: s.beatTitle || "",
    dur: Number(s.dur) || 0,
    location: s.location || "",
    characters: Array.isArray(s.characters) ? s.characters : (s.characters ? [s.characters] : []),
    camera: s.camera || "",
    action: s.action || s.summary || "",
    dialogue: s.dialogue || "",
    audioSync: s.audioSync || "",
    prompt: s.prompt || "",
  };
}
