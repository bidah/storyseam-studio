// A rendered take is only visible if its mp4 is an OBJECT in R2 — the episode
// view lists generations by key-set membership. `/api/episode/video` used to
// record the take and skip the download, so every clip attached by URL (which
// is how the agent attaches all of them) was invisible in the UI forever.
import { describe, it, expect, afterEach, vi } from "vitest";
import { makeEnv } from "./_fakes.js";
import { readDoc, writeDoc } from "../../worker/src/lib/docs.js";
import { mediaKey } from "../../worker/src/lib/media.js";
import { buildEpisodeView } from "../../worker/src/routes/episode.js";

const PID = "p1";
const SOURCE = "https://cdn.example/hf_render.mp4";

async function seed(env, takes) {
  await writeDoc(env, PID, "episode-manifest", {
    bundles: [{ id: "MS-01", title: "Teaser", shots: [{ id: "01", dur: 3 }] }],
  });
  await writeDoc(env, PID, "selections", { library: {}, episode: {}, video: { "MS-01": takes } });
}

/** Stub the CDN the take was rendered on. */
function stubFetch(status, body = "mp4-bytes") {
  const fetchMock = vi.fn(async () =>
    status === 200
      ? new Response(new TextEncoder().encode(body), {
          status,
          headers: { "content-type": "video/mp4" },
        })
      : new Response(null, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("episode takes — bytes, not just records", () => {
  it("pulls in a recorded take whose bytes never landed, and lists it", async () => {
    const env = makeEnv();
    await seed(env, [{ file: "MS-01_gen3.mp4", name: "gen 3", source: SOURCE }]);
    const fetchMock = stubFetch(200);

    const { video } = await buildEpisodeView(env, PID);

    expect(fetchMock).toHaveBeenCalledWith(SOURCE);
    expect(env.BUCKET._store.has(mediaKey(PID, "gen", "MS-01_gen3.mp4"))).toBe(true);
    // …and it appears in the SAME response, not only on the next refresh.
    expect(video["MS-01"]).toHaveLength(1);
    expect(video["MS-01"][0].url).toBe("/gen/MS-01_gen3.mp4");
  });

  it("leaves a take with no source alone (nothing to pull from)", async () => {
    const env = makeEnv();
    await seed(env, [{ file: "MS-01_gen1.mp4", name: "gen 1" }]);
    const fetchMock = stubFetch(200);

    const { video } = await buildEpisodeView(env, PID);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(video["MS-01"]).toBeUndefined();
  });

  it("stamps a dead source so it isn't refetched on every load", async () => {
    const env = makeEnv();
    await seed(env, [{ file: "MS-01_gen1.mp4", name: "gen 1", source: SOURCE }]);
    const fetchMock = stubFetch(404);

    const first = await buildEpisodeView(env, PID);
    expect(first.video["MS-01"]).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const db = await readDoc(env, PID, "selections", {});
    expect(db.video["MS-01"][0].hydrateFailedAt).toBeTruthy();

    await buildEpisodeView(env, PID);
    expect(fetchMock).toHaveBeenCalledTimes(1); // not retried within the day
  });

  it("keeps listing takes whose bytes are already there", async () => {
    const env = makeEnv();
    await seed(env, [{ file: "MS-01_gen1.mp4", name: "gen 1", source: SOURCE }]);
    await env.BUCKET.put(mediaKey(PID, "gen", "MS-01_gen1.mp4"), "already-here");
    const fetchMock = stubFetch(200);

    const { video } = await buildEpisodeView(env, PID);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(video["MS-01"]).toHaveLength(1);
  });
});
