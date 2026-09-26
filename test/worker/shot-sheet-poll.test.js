import { describe, it, expect, vi } from "vitest";
import { finishRender } from "../../worker/src/lib/shot-sheet-run.js";

// fal's queue serves status/results on the app's base path (owner/app). The
// full endpoint path is a 405 — polling it left finished clips "running".
describe("finishRender polls fal on the app base path", () => {
  it("asks minimax/h3-max, not minimax/h3-max/reference-to-video", async () => {
    const seen = [];
    const fetchFn = vi.fn(async (url) => {
      seen.push(url);
      return new Response(JSON.stringify({ status: "IN_PROGRESS" }));
    });
    const take = { id: "req_1", seriesId: "s1", status: "running", endpoint: "minimax/h3-max/reference-to-video" };
    const out = await finishRender({}, "p1", take, "k", fetchFn);
    expect(out).toBe(take); // still running: nothing written
    expect(seen[0]).toBe("https://queue.fal.run/minimax/h3-max/requests/req_1/status");
  });
});
