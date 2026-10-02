// The model-hiding switch — the mobile app's copy of src/lib/film-plan.ts
// HIDE_EXTRA_MODELS (the web, Worker and agent share that one). true = only
// GLM-5.3 is offered: as the Film's writer (Create tab) and as the chat model
// (composer chip, Settings › Chat provider / Chat model). A stored pick of any
// other model starts back on GLM-5.3, and the Worker and agent coerce too. The
// other models stay wired; flip to false to offer them again (needs an OTA).
export const HIDE_EXTRA_MODELS = true;
