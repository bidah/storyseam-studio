// Per-session project id backed by a durable eve StateHandle. The channel
// onMessage hook writes it; every tool reads it via getProjectId() — survives
// across Vercel Workflow boundaries where module-level variables don't.
import { defineState } from "eve/context";

const projectState = defineState<string | null>("shot-studio.projectId", () => null);

export function setProjectId(id: string | null) {
  projectState.update(() => id);
}

export function getProjectId(): string | null {
  return projectState.get();
}

// Per-session chat model id, chosen by the in-chat model picker. The browser
// sends it on every turn via the `x-eve-model` header; the channel copies it
// here in `turn.started`, and the model router (agent/lib/model.ts) reads it to
// pick which gateway model this turn runs on. Same durable-state mechanism as
// the project id, so it survives Workflow boundaries and HITL resumes.
const modelState = defineState<string | null>("shot-studio.modelId", () => null);

export function setModelId(id: string | null) {
  modelState.update(() => id);
}

export function getModelId(): string | null {
  return modelState.get();
}
