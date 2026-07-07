import { createContext, useContext, useRef } from "react";
import { useEveAgent } from "eve/react";

// ---------------------------------------------------------------------------
// A single shared eve agent session for the whole app.
//
// `useEveAgent` owns one conversation per hook instance, so the chat panel and
// any "drive the agent from the UI" affordances (e.g. the sound-studio Render
// buttons) must read from the SAME instance. This provider creates it once and
// hands it down; `AgentChat` renders it and `useAgent()` lets deep components
// send turns to it (the same as typing in the composer).
// ---------------------------------------------------------------------------

const AgentContext = createContext(null);

export function AgentProvider({ view, children }) {
  // Keep the current screen fresh without recreating the session on every tab
  // switch (session config is read once when the store is created).
  const viewRef = useRef(view);
  viewRef.current = view;

  const agent = useEveAgent({
    // Tell the agent which screen the user is on, every turn.
    prepareSend: (input) => ({ ...input, clientContext: { screen: viewRef.current } }),
  });

  return <AgentContext.Provider value={agent}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within <AgentProvider>");
  return ctx;
}

// Is the agent mid-turn (can't accept a new `send`)?
export function agentIsBusy(agent) {
  return agent.status === "submitted" || agent.status === "streaming";
}

// Build the chat turn that drives the render → attach loop for one pending
// sound version. Mirrors the agent's own instructions (load seed-audio →
// generate via Higgsfield → attach_sound), and hands it the prompt/params so it
// doesn't have to guess.
export function renderSoundMessage(track, ver) {
  const label = `${track.id} v${ver.v}${ver.name ? ` (${ver.name})` : ""}`;
  return [
    `Render the pending sound version ${label} now.`,
    `Load the seed-audio skill, generate the audio from this version's exact prompt` +
      ` and params, then call attach_sound for ${track.id} v${ver.v} so it flips to` +
      ` "ready" and plays in the UI. Confirm the Higgsfield submit with me first, as usual.`,
    "",
    `Track: ${track.name || track.id}`,
    ver.duration ? `Target duration: ~${ver.duration}s` : null,
    "",
    "Prompt:",
    ver.prompt,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Combined turn for "render every pending version in the studio".
export function renderAllPendingMessage(tracks) {
  const pending = [];
  for (const t of tracks) {
    for (const v of t.versions) {
      if (v.status !== "ready") {
        pending.push(`- ${t.id} v${v.v}${v.name ? ` (${v.name})` : ""} — ${t.name || t.id}`);
      }
    }
  }
  return [
    `Render all pending sound versions now, one at a time:`,
    ...pending,
    "",
    `For each: load the seed-audio skill, generate from that version's saved prompt` +
      ` and params, then attach_sound so it flips to "ready". Confirm each Higgsfield` +
      ` submit with me before generating, as usual.`,
  ].join("\n");
}
