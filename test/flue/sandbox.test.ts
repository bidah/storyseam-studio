import { describe, it, expect, afterEach } from "vitest";
import { createSandbox } from "../../flue-agent/src/lib/sandbox";

const saved = process.env.DAYTONA_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.DAYTONA_API_KEY;
  else process.env.DAYTONA_API_KEY = saved;
});

describe("createSandbox", () => {
  it("returns undefined (no Daytona) when DAYTONA_API_KEY is unset — flue falls back to its in-memory sandbox", async () => {
    delete process.env.DAYTONA_API_KEY;
    expect(await createSandbox("u1~p1~c1")).toBeUndefined();
  });
});
