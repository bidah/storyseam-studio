// Shared constants + helpers for the Visual nodes (generator flow) canvas.
// Mirrors the worker's FLOW_CONNECT_RULES (worker/src/routes/visual-world.js) —
// the two MUST stay in sync, since the worker re-validates every edge.
//
// The canvas is a node-driven generator: image / video nodes carry a prompt +
// settings and Run to fire a Higgsfield job; text nodes are prompt sources;
// upload nodes hold an existing generation. Edges are TYPED and functional:
//   image-output → image-input   feeds the source image in as a reference,
//   image-output → start-frame   feeds a video its first frame,
//   text-output  → text-input    inherits the source's prompt text.

export const FLOW_NODE_TYPES = ["image", "video", "text", "upload"];

// Source handle → the target handles it may legally connect to (video-output is
// terminal in v1). The single source of truth for isValidConnection.
export const FLOW_CONNECT_RULES = {
  "image-output": ["image-input", "start-frame"],
  "video-output": [],
  "text-output": ["text-input"],
};

// Targets that accept a single edge (the graph enforces one-to-one on connect).
export const ONE_TO_ONE_TARGETS = new Set(["start-frame", "text-input"]);

// Which input (target) handles each node type owns — used both to derive the
// addable node types from a dragged source handle and to auto-wire a dropped edge.
const TARGET_HANDLE_OWNERS = {
  image: ["image-input", "text-input"],
  video: ["start-frame", "image-input", "text-input"],
  text: [],
  upload: [],
};

const ADD_ORDER = ["image", "video", "text", "upload"];

// The live node types reachable by dropping a dragged edge from `handle` onto
// empty canvas (a type is addable when it owns a target the source may reach).
export function allowedTypesForSourceHandle(handle) {
  const validTargets = FLOW_CONNECT_RULES[handle] || [];
  return ADD_ORDER.filter((type) =>
    (TARGET_HANDLE_OWNERS[type] || []).some((t) => validTargets.includes(t)),
  );
}

// The input handle on a freshly-added node a dragged source should wire into:
// the first target the node type owns that the source is allowed to reach.
export function pickTargetHandle(type, allowedTargets) {
  for (const h of TARGET_HANDLE_OWNERS[type] || []) {
    if (allowedTargets.includes(h)) return h;
  }
  return null;
}

export const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
export const VIDEO_DURATIONS = [4, 5, 6, 8, 10, 12, 15];

// New-node settings defaults (image/video carry generation settings; the
// caller seeds presetId with the project's default preset).
export function defaultSettings(type, presetId = "") {
  if (type === "image") return { model: "", aspectRatio: "16:9", presetId };
  if (type === "video") {
    return { model: "", aspectRatio: "16:9", duration: 5, generateAudio: false, presetId };
  }
  return {};
}

// A fresh flow node at a canvas position.
export function freshNode(type, position, presetId = "") {
  return {
    id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    x: position.x,
    y: position.y,
    w: null,
    h: null,
    prompt: "",
    settings: defaultSettings(type, presetId),
    currentGenId: "",
    genIds: [],
  };
}

export const RUNNABLE_TYPES = new Set(["image", "video"]);
