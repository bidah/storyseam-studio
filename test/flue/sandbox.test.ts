import { describe, it, expect, afterEach } from "vitest";
import { daytonaAvailable, daytonaFactory } from "../../flue-agent/src/lib/sandbox";

const saved = process.env.DAYTONA_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.DAYTONA_API_KEY;
  else process.env.DAYTONA_API_KEY = saved;
});

// There is no implicit sandbox in flue 2, so "no Daytona" no longer means
// `undefined` — the agent always attaches SOMETHING, and the free tier is the
// in-memory one (lib/sandbox.ts `memorySandbox`). Two things are worth pinning
// here; the third is not unit-testable and is called out below.
describe("daytonaAvailable", () => {
  it("is false without DAYTONA_API_KEY, so the escalation tool is not mounted", () => {
    delete process.env.DAYTONA_API_KEY;
    expect(daytonaAvailable()).toBe(false);
  });

  it("is true with a key present", () => {
    process.env.DAYTONA_API_KEY = "dtn_test";
    expect(daytonaAvailable()).toBe(true);
  });
});

describe("daytonaFactory", () => {
  // Cheap to build, expensive to resolve: everything slow lives inside
  // `createSessionEnv`, which flue calls once per initialized harness. Building
  // the factory itself must never touch the network — the agent function
  // re-renders one before every model call.
  it("is a lazy SandboxFactory — no client, no key read, at construction", () => {
    delete process.env.DAYTONA_API_KEY;
    const factory = daytonaFactory();
    expect(typeof factory.createSessionEnv).toBe("function");
  });

  // NOT covered here: that a missing/unreachable Daytona degrades to the
  // in-memory environment rather than rejecting (a rejection in
  // `createSessionEnv` fails the agent's whole initialization). Exercising it
  // means instantiating just-bash through flue's real `bash()` wrapper, which
  // the runtime stub can't stand in for. It is the cutover smoke test instead:
  // run one bash call in a chat that has NOT opted into Daytona.
});
