// Web (jsdom) test setup. Each test gets a clean localStorage so the persisted
// stores (agentModel, chat-store) don't leak selections between cases.
import { afterEach, vi } from "vitest";

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom always has it, but be defensive */
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
