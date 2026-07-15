// Timeline operations barrel — all PURE mutations (mutate a clone, return it).
// These are ported verbatim from web-editor/src/modules/timeline/ops (plus the
// RN-formalized move/trim in ./edit). Web reference: /docs/modules/timeline.
export { removeGap, closeGapsAll } from "./gaps";
export { reorderVideo } from "./reorder";
export { repackWithLinks } from "./repack";
export { detachAudio, linkSelected, unlinkSelected, unlinkItem } from "./link";
export { removeItemFromTimeline, removeItems } from "./remove";
export { snapTargets, computeSnap } from "./snap";
export { applyVerticalDrop, addPoolClip } from "./dragClip";
export type { Drop, PoolItem } from "./dragClip";
export { moveItem, trimItem } from "./edit";
