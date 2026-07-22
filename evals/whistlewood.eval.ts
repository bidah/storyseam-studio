import { describe, it, expect } from "vitest";
import { runAgent, HAS_AGENT, FLUE_BASE_URL } from "./harness.js";

// Behavioural evals for the whistlewood production agent. Each case prompts a
// fresh instance and asserts the agent (a) answers and (b) reaches for the right
// tool. Tool-choice scoring is intentionally LENIENT (regex over the called-tool
// set) — different chat models phrase their tool use differently, and we're
// checking the agent wires prompts to the correct capability, not pinning one
// exact call sequence.
//
// Skipped entirely unless FLUE_BASE_URL points at a running agent.
const d = HAS_AGENT ? describe : describe.skip;

if (!HAS_AGENT) {
  // Make the skip visible in the report instead of silently passing nothing.
  describe("whistlewood evals", () => {
    it.skip("set FLUE_BASE_URL to a running agent to run these", () => {});
  });
}

d(`whistlewood evals @ ${FLUE_BASE_URL}`, () => {
  it("reads the script when asked what it currently says", async () => {
    const run = await runAgent("What does the screenplay currently say? Summarize it.");
    expect(run.text.length).toBeGreaterThan(0);
    expect(run.usedToolMatching(/script/i)).toBe(true); // get_script / list_drafts
  });

  it("reads the shot list when asked for it", async () => {
    const run = await runAgent("Show me the current shot list.");
    expect(run.text.length).toBeGreaterThan(0);
    expect(run.usedToolMatching(/shot/i)).toBe(true); // get_shotlist / list_shots
  });

  it("reads the world when asked about characters/locations", async () => {
    const run = await runAgent("Who are the characters in the Whistlewood world?");
    expect(run.text.length).toBeGreaterThan(0);
    expect(run.usedToolMatching(/world/i)).toBe(true); // get_world / get_visual_world
  });

  it("stays conversational for a plain greeting (no spurious tool calls)", async () => {
    const run = await runAgent("Hi! In one sentence, what can you help me with?");
    expect(run.text.length).toBeGreaterThan(0);
    // A greeting shouldn't trigger a heavy generation/render tool.
    expect(run.usedToolMatching(/render|stitch|generate|seedance/i)).toBe(false);
  });

  it("reports the model it ran on", async () => {
    const run = await runAgent("ping");
    expect(run.model?.provider).toBeTruthy();
    expect(run.model?.id).toBeTruthy();
  });
});
