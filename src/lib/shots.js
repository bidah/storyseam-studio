// Front-end mirror of the WIDE-SHOT detector. The source of truth is
// `worker/src/lib/shots.js` (`WIDE_CAMERA_RE` / `isWideShot`) — keep the regex
// identical here. Wide framings are the trigger for the 2D "miniature" reference
// prompt on the Shot list and Episode tabs (characters too small for a
// portrait-heavy sheet to read, so a full-figure miniature is offered).
export const WIDE_CAMERA_RE =
  /\bwide\b|\bwide[- ]shots?\b|\be?w\.?s\.?\b|\bestablishing\b|\b(?:extreme |very )?long shots?\b|\baerial\b|\bbird'?s[- ]?eye\b/i;

export const isWideShot = (shot) => WIDE_CAMERA_RE.test(String(shot?.camera || ""));
