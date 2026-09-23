// The two Director pieces the Worker owns alone: turning a project's own media
// paths into urls fal can fetch, and refusing to forward a fal key anywhere it
// was not meant to go.
//
// Both fail SILENTLY when they are wrong. A relative url handed to the endpoint
// is a 404 on fal's network that nobody sees until the frames come back in the
// wrong hand; a proxy that forwards one host too many is a key with extra steps.
import { describe, it, expect } from "vitest";
import { absolutize, absolutizeSeries, seriesDocName } from "../../worker/src/lib/director.js";
import {
  DIRECTOR_ENDPOINT,
  createSessionClock,
  falAuthorization,
  heartbeatSessionId,
  refuseCappedSession,
  refuseTarget,
} from "../../worker/src/routes/stage.js";

const env = { WORKER_PUBLIC_URL: "https://storyseam.app" };
const PID = "p_test";

describe("absolutize", () => {
  it("resolves this project's own media into a url fal can fetch", () => {
    expect(absolutize(env, PID, "/sound-media/take_3.mp3")).toBe(
      "https://storyseam.app/files/media/p_test/sound-media/take_3.mp3",
    );
    expect(absolutize(env, PID, "/visual-media/open.png")).toBe(
      "https://storyseam.app/files/media/p_test/visual/open.png",
    );
    expect(absolutize(env, PID, "/storyboard-media/ms01.png")).toBe(
      "https://storyseam.app/files/media/p_test/storyboard/ms01.png",
    );
  });

  it("resolves a library asset, which lives under its own prefix", () => {
    expect(absolutize(env, PID, "/asset/refs/kai.png")).toBe(
      "https://storyseam.app/files/media/p_test/asset/refs/kai.png",
    );
  });

  it("leaves an absolute url alone — that is what makes an imported Series play", () => {
    const outside = "https://example.com/frame.png";
    expect(absolutize(env, PID, outside)).toBe(outside);
  });

  it("leaves a path it does not serve alone rather than inventing a url for it", () => {
    expect(absolutize(env, PID, "/made-up/x.png")).toBe("/made-up/x.png");
    expect(absolutize(env, PID, "")).toBe("");
  });
});

describe("absolutizeSeries", () => {
  it("resolves every url the endpoint will be handed, and no others", () => {
    const series = {
      id: "s_1",
      imageUrl: "/visual-media/open.png",
      endImageUrl: null,
      audioUrl: null,
      directions: [
        { offset: 0, prompt: "open" },
        { offset: 8, endImageUrl: "/storyboard-media/a.png", audioUrl: "/sound-media/b.mp3" },
      ],
      modelSheets: [{ kind: "style", name: "the look", imageUrl: "/visual-media/style.png" }],
      audioVersion: { prompt: "the mix", audioUrl: "/sound-media/mix.mp3" },
    };
    const out = absolutizeSeries(env, PID, series);

    expect(out.imageUrl).toMatch(/^https:\/\//);
    expect(out.directions[1].endImageUrl).toMatch(/^https:\/\//);
    expect(out.directions[1].audioUrl).toMatch(/^https:\/\//);
    expect(out.modelSheets[0].imageUrl).toMatch(/^https:\/\//);
    expect(out.audioVersion.audioUrl).toMatch(/^https:\/\//);

    // A beat with no pin keeps its absence: `null` is not a url to resolve, and
    // turning it into "" would put an empty string on the wire.
    expect(out.endImageUrl).toBeNull();
    expect(out.directions[0].endImageUrl).toBeUndefined();
  });

  it("does not mutate the stored row — portability is the whole point", () => {
    const series = { id: "s_1", imageUrl: "/visual-media/open.png", directions: [], modelSheets: [] };
    absolutizeSeries(env, PID, series);
    expect(series.imageUrl).toBe("/visual-media/open.png");
  });
});

describe("seriesDocName", () => {
  it("namespaces a Series into its own doc row", () => {
    expect(seriesDocName("s_abc")).toBe("director:s_abc");
  });
});

describe("refuseTarget", () => {
  const body = JSON.stringify({ app_id: DIRECTOR_ENDPOINT });

  it("forwards the three session routes of the bridge, for this endpoint", () => {
    expect(refuseTarget("https://wma.fal.run/ice", body)).toBeNull();
    expect(refuseTarget("https://wma.fal.run/session", body)).toBeNull();
    // The heartbeat names no app — it acts on a session already authorized.
    expect(refuseTarget("https://wma.fal.run/session/heartbeat", JSON.stringify({ session_id: "x" }))).toBeNull();
  });

  it("refuses another model on the bridge", async () => {
    const res = refuseTarget("https://wma.fal.run/session", JSON.stringify({ app_id: "some/other/model" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain(DIRECTOR_ENDPOINT);
  });

  it("refuses a route on the bridge that is not a session route", async () => {
    const res = refuseTarget("https://wma.fal.run/anything", body);
    expect(res.status).toBe(403);
  });

  it("refuses the token mint, which would undo the endpoint pin entirely", async () => {
    // `rest.fal.ai/tokens/` returns a credential whose SCOPE COMES FROM THE
    // REQUEST BODY. Forwarding it hands any caller a key for any model.
    const res = refuseTarget("https://rest.fal.ai/tokens/", body);
    expect(res.status).toBe(403);
  });

  it("refuses a host that is not fal's at all", async () => {
    const res = refuseTarget("https://evil.example.com/ice", body);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("evil.example.com");
  });

  it("refuses plain http and a target that is not a url", () => {
    expect(refuseTarget("http://wma.fal.run/ice", body).status).toBe(403);
    expect(refuseTarget("not a url", body).status).toBe(400);
  });
});

describe("the session cap", () => {
  it("starts a session's clock on its first heartbeat and lets it run", () => {
    const clock = createSessionClock();
    const body = JSON.stringify({ session_id: "s1" });
    const url = "https://wma.fal.run/session/heartbeat";
    const at = (ms) => refuseCappedSession(url, body, { env: {}, clock, now: () => ms });

    expect(at(0)).toBeNull();
    expect(at(60_000)).toBeNull();
  });

  it("stops forwarding the beat once the session has run past the cap", async () => {
    const clock = createSessionClock();
    const body = JSON.stringify({ session_id: "s1" });
    const url = "https://wma.fal.run/session/heartbeat";
    // A short cap so the test says what it means rather than simulating 20 min.
    const cfg = { env: { MAX_SESSION_SECONDS: 30 }, clock };

    expect(refuseCappedSession(url, body, { ...cfg, now: () => 0 })).toBeNull();
    const refused = refuseCappedSession(url, body, { ...cfg, now: () => 31_000 });
    expect(refused.status).toBe(403);
    const json = await refused.json();
    expect(json.code).toBe("session_limit");
    expect(json.elapsedS).toBe(31);
  });

  it("meters each session separately", () => {
    const clock = createSessionClock();
    const url = "https://wma.fal.run/session/heartbeat";
    const cfg = { env: { MAX_SESSION_SECONDS: 30 }, clock };
    refuseCappedSession(url, JSON.stringify({ session_id: "old" }), { ...cfg, now: () => 0 });
    // A session that started later is not capped by an older one's clock.
    expect(
      refuseCappedSession(url, JSON.stringify({ session_id: "new" }), { ...cfg, now: () => 31_000 }),
    ).toBeNull();
  });

  it("meters nothing but the heartbeat", () => {
    const clock = createSessionClock();
    const cfg = { env: { MAX_SESSION_SECONDS: 0 }, clock, now: () => 1_000_000 };
    expect(refuseCappedSession("https://wma.fal.run/ice", "{}", cfg)).toBeNull();
    expect(refuseCappedSession("https://queue.fal.run/x", "{}", cfg)).toBeNull();
  });

  it("does not meter a beat it cannot identify", () => {
    // Not our call to make: the bridge rejects it on its own merits.
    const clock = createSessionClock();
    expect(
      refuseCappedSession("https://wma.fal.run/session/heartbeat", "{}", {
        env: { MAX_SESSION_SECONDS: 0 }, clock, now: () => 1_000_000,
      }),
    ).toBeNull();
  });
});

describe("heartbeatSessionId", () => {
  it("reads the one identifier that lives as long as the session", () => {
    expect(heartbeatSessionId(JSON.stringify({ session_id: "abc" }))).toBe("abc");
    expect(heartbeatSessionId("{}")).toBeUndefined();
    expect(heartbeatSessionId("not json")).toBeUndefined();
    expect(heartbeatSessionId(undefined)).toBeUndefined();
  });
});

describe("falAuthorization", () => {
  it("sends fal's own scheme, which a bare key is not", () => {
    // The bare key comes back as 401 "unrecognized auth scheme" — found live,
    // after every test that asserted the shape this code produced had passed.
    expect(falAuthorization("abc")).toBe("Key abc");
  });

  it("leaves a key that already carries the scheme alone", () => {
    expect(falAuthorization("Key abc")).toBe("Key abc");
    expect(falAuthorization("key abc")).toBe("key abc");
  });

  it("has nothing to send when there is no key", () => {
    expect(falAuthorization("")).toBeUndefined();
    expect(falAuthorization(undefined)).toBeUndefined();
  });
});
