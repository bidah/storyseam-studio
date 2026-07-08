// A stable id for this browser page-load. The Script tab stamps its saves with
// it so the live-update stream can tell the tab's OWN saves apart from edits
// made elsewhere (e.g. by the chat agent) — only the latter reload the editor
// and glow the tab.
export const CLIENT_ID =
  (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
  `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
