import { describe, it, expect, beforeEach } from "vitest";
import {
  AGENT_MODELS,
  DEFAULT_AGENT_MODEL,
  getAgentModel,
  getAgentModelSpecifier,
  setAgentModel,
  onAgentModelChange,
  defaultModelForProvider,
  modelGroupOf,
} from "@/lib/agentModel";
import {
  DEFAULT_CHAT_PROVIDER,
  getChatProvider,
  setChatProvider,
} from "@/lib/chatProvider";

// The modules keep live singleton selections; reset provider then model to their
// defaults before each case so ordering doesn't matter (provider first — a
// provider switch reconciles the model).
beforeEach(() => {
  setChatProvider(DEFAULT_CHAT_PROVIDER);
  setAgentModel(DEFAULT_AGENT_MODEL);
});

describe("AGENT_MODELS catalog", () => {
  it("has the default as the first entry with a valid spec", () => {
    expect(DEFAULT_AGENT_MODEL).toBe(AGENT_MODELS[0].id);
    expect(AGENT_MODELS[0].spec).toMatch(/^cloudflare\//);
  });

  it("every model has id/spec/label/group and a provider-prefixed spec", () => {
    for (const m of AGENT_MODELS) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.group).toMatch(/^(cloudflare|cerebras)$/);
      expect(m.spec).toMatch(/^(cloudflare|anthropic|cerebras)\//);
    }
  });

  it("groups the Cerebras models with Gemma as their default", () => {
    const cer = AGENT_MODELS.filter((m) => m.group === "cerebras");
    expect(cer.length).toBeGreaterThanOrEqual(3);
    expect(cer.every((m) => m.spec.startsWith("cerebras/"))).toBe(true);
    expect(defaultModelForProvider("cerebras")).toBe("cerebras-gemma-4-31b");
    expect(AGENT_MODELS.find((m) => m.id === "cerebras-gemma-4-31b").spec).toBe(
      "cerebras/gemma-4-31b",
    );
  });
});

describe("chat provider ↔ model catalog", () => {
  it("switching provider snaps the selection into that provider's catalog", () => {
    expect(getChatProvider()).toBe("cloudflare");
    setChatProvider("cerebras");
    expect(modelGroupOf(getAgentModel())).toBe("cerebras");
    expect(getAgentModel()).toBe(defaultModelForProvider("cerebras"));
    expect(getAgentModelSpecifier()).toMatch(/^cerebras\//);
    // …and back to the cloudflare default.
    setChatProvider("cloudflare");
    expect(getAgentModel()).toBe(defaultModelForProvider("cloudflare"));
  });
});

describe("get/set selection", () => {
  it("returns the current selection and its full flue specifier", () => {
    expect(getAgentModel()).toBe(DEFAULT_AGENT_MODEL);
    expect(getAgentModelSpecifier()).toBe(AGENT_MODELS[0].spec);
  });

  it("switching updates the id, the specifier, and localStorage", () => {
    // Any registered model that ISN'T the default, so a pass can't be the
    // fallback in disguise. (This used to name `claude-sonnet-5`; the
    // `anthropic/*` models were removed from the registry — see the comment
    // block in flue-agent/src/lib/models.ts — and the test has been red since.)
    const pick = AGENT_MODELS.find((m) => m.id !== DEFAULT_AGENT_MODEL);
    setAgentModel(pick.id);
    expect(getAgentModel()).toBe(pick.id);
    expect(getAgentModelSpecifier()).toBe(pick.spec);
    expect(localStorage.getItem("shot-studio:agentModel")).toBe(pick.id);
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
