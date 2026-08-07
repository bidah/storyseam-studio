// One shot's canonical field set (ported verbatim from server/index.js
// normalizeShot). `i` is the shot's zero-based position; `n` is 1-based.
import { normalizePromptBlocks, composePromptBlocks } from "./production-type.js";

export function normalizeShot(s, i) {
  const n = i + 1;
  // A LIVE-ACTION shot is authored as `promptBlocks` (the block structure of the
  // shot-list-live-action skill) rather than as one paragraph. `prompt` stays the
  // single field the renderer reads — pack.js splices it into the bundle's
  // skillPrompt and knows nothing about blocks — so it is DERIVED here whenever
  // blocks exist. One source of truth: edit a block on the Shot list tab and the
  // composed prompt follows, with no second copy to keep in sync.
  const promptBlocks = normalizePromptBlocks(s.promptBlocks);
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
    // `extra` marks a shot INSERTED after the script was broken into shots (via
    // the "+" node / save_shotlist mode:"insert"), so the UI can badge it as
    // "extra shot". Preserved here because normalizeShot rebuilds the object from
    // a fixed field set and would otherwise drop it on every read and edit.
    ...(s.extra ? { extra: true } : {}),
    ...(promptBlocks ? { promptBlocks } : {}),
    prompt: promptBlocks ? composePromptBlocks(promptBlocks) : (s.prompt || ""),
  };
}
