import { describe, it, expect, beforeEach } from "vitest";
import {
  AGENT_MODELS,
  DEFAULT_AGENT_MODEL,
  getAgentModel,
  getAgentModelSpecifier,
  setAgentModel,
  onAgentModelChange,
} from "@/lib/agentModel";

// The module keeps a live singleton selection; reset it to the default before
// each case so ordering doesn't matter.
beforeEach(() => setAgentModel(DEFAULT_AGENT_MODEL));

describe("AGENT_MODELS catalog", () => {
  it("has the default as the first entry with a valid spec", () => {
    expect(DEFAULT_AGENT_MODEL).toBe(AGENT_MODELS[0].id);
    expect(AGENT_MODELS[0].spec).toMatch(/^cloudflare\//);
  });

  it("every model has id/spec/label and a provider-prefixed spec", () => {
    for (const m of AGENT_MODELS) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.spec).toMatch(/^(cloudflare|anthropic)\//);
    }
  });
});

describe("get/set selection", () => {
  it("returns the current selection and its full flue specifier", () => {
    expect(getAgentModel()).toBe(DEFAULT_AGENT_MODEL);
    expect(getAgentModelSpecifier()).toBe(AGENT_MODELS[0].spec);
  });

  it("switching updates the id, the specifier, and localStorage", () => {
    setAgentModel("claude-sonnet-5");
    expect(getAgentModel()).toBe("claude-sonnet-5");
    expect(getAgentModelSpecifier()).toBe("anthropic/claude-sonnet-5");
    expect(localStorage.getItem("shot-studio:agentModel")).toBe("claude-sonnet-5");
  });

  it("ignores an unknown id (never pushes an arbitrary model)", () => {
    setAgentModel("gpt-99-ultra");
    expect(getAgentModel()).toBe(DEFAULT_AGENT_MODEL);
  });
});

describe("onAgentModelChange", () => {
  it("notifies subscribers on a real change and stops after unsubscribe", () => {
    const seen = [];
    const off = onAgentModelChange((id) => seen.push(id));
    setAgentModel("glm-4.7-flash");
    setAgentModel("glm-4.7-flash"); // no-op: same value → no notification
    off();
    setAgentModel("gpt-oss-120b"); // after unsubscribe → not seen
    expect(seen).toEqual(["glm-4.7-flash"]);
  });
});
