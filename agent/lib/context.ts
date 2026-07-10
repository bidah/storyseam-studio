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
