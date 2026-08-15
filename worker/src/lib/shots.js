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

// WIDE-SHOT detection, from the shot's free-text `camera` field — there is no
// shot-size enum, framing is only ever described in prose. This is the trigger
// for the 2D "miniature" reference: on a wide/establishing shot the characters
// are too small in frame for a portrait-heavy character sheet to read, so a
// full-figure MINIATURE reference is offered instead (see pack.js and the
// Episode/Shot-list tabs). Kept deliberately conservative — it only gates an
// OPTIONAL reference and an author prompt, so a stray match costs nothing.
//
// The front-end mirrors this in `src/lib/shots.js`; keep the two regexes in sync.
export const WIDE_CAMERA_RE =
  /\bwide\b|\bwide[- ]shots?\b|\be?w\.?s\.?\b|\bestablishing\b|\b(?:extreme |very )?long shots?\b|\baerial\b|\bbird'?s[- ]?eye\b/i;

export function isWideShot(shot) {
  return WIDE_CAMERA_RE.test(String(shot?.camera || ""));
}
