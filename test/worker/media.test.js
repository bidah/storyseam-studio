import { describe, it, expect } from "vitest";
import { makeEnv } from "./_fakes.js";
import {
  mediaKey,
  proxyKey,
  kindForPrefix,
  filesUrl,
  assetRefUrl,
  mediaExists,
  listMedia,
  listMediaSet,
  putMedia,
  streamKey,
} from "../../worker/src/lib/media.js";

describe("mediaKey", () => {
  it("namespaces by project + kind + file", () => {
    expect(mediaKey("p1", "gen", "MS-01.mp4")).toBe("media/p1/gen/MS-01.mp4");
  });

  it("falls back to p_default for a blank project id", () => {
    expect(mediaKey("", "gen", "a.mp4")).toBe("media/p_default/gen/a.mp4");
  });

  it("strips leading slashes and blocks path traversal", () => {
    expect(mediaKey("p1", "gen", "/leading.mp4")).toBe("media/p1/gen/leading.mp4");
    expect(mediaKey("p1", "gen", "../../etc/passwd")).not.toContain("..");
  });
});

describe("proxyKey", () => {
  it("nests under a proxy/ segment so listMedia never sees proxies", () => {
    expect(proxyKey("p1", "gen", "a.mp4")).toBe("media/p1/proxy/gen/a.mp4");
  });
});

describe("kindForPrefix", () => {
  it("maps serving URL prefixes to storage kinds", () => {
    expect(kindForPrefix("gen")).toBe("gen");
    expect(kindForPrefix("media")).toBe("shots");
    expect(kindForPrefix("storyboard-media")).toBe("storyboard");
    expect(kindForPrefix("multishot-media")).toBe("multishot");
  });

  it("returns null for an unknown prefix", () => {
    expect(kindForPrefix("nope")).toBeNull();
  });
});

describe("filesUrl / assetRefUrl", () => {
  it("builds an absolute ungated /files/ URL when WORKER_PUBLIC_URL is set", () => {
    const env = { WORKER_PUBLIC_URL: "https://w.example.com/" };
    expect(filesUrl(env, "media/p1/gen/a.mp4")).toBe("https://w.example.com/files/media/p1/gen/a.mp4");
  });

  it('returns "" (no absolute URL) when WORKER_PUBLIC_URL is unset', () => {
    expect(filesUrl({}, "media/p1/gen/a.mp4")).toBe("");
    expect(filesUrl({ WORKER_PUBLIC_URL: "https://x" }, "")).toBe("");
  });

  it("assetRefUrl points at the asset library path and blocks traversal", () => {
    const env = { WORKER_PUBLIC_URL: "https://w.example.com" };
    expect(assetRefUrl(env, "p1", "char/sara.png")).toBe(
      "https://w.example.com/files/media/p1/asset/char/sara.png",
    );
    expect(assetRefUrl(env, "p1", "")).toBe("");
  });
});

describe("mediaExists / listMedia against R2", () => {
  it("finds a put object and lists basenames under a kind", async () => {
    const env = makeEnv();
    await putMedia(env, "p1", "gen", "MS-01.mp4", "bytes", "video/mp4");
    await putMedia(env, "p1", "gen", "MS-02.mp4", "bytes");
    expect(await mediaExists(env, "p1", "gen", "MS-01.mp4")).toBe(true);
    expect(await mediaExists(env, "p1", "gen", "missing.mp4")).toBe(false);
    const files = await listMedia(env, "p1", "gen");
    expect(files.sort()).toEqual(["MS-01.mp4", "MS-02.mp4"]);
  });

  it("rejects unknown kinds", async () => {
    const env = makeEnv();
    expect(await mediaExists(env, "p1", "bogus", "x")).toBe(false);
    expect(await listMedia(env, "p1", "bogus")).toEqual([]);
  });

  it("does not leak proxy/* objects into a kind listing", async () => {
    const env = makeEnv();
    await putMedia(env, "p1", "gen", "real.mp4", "b");
    await env.BUCKET.put(proxyKey("p1", "gen", "prox.mp4"), "b");
    expect(await listMedia(env, "p1", "gen")).toEqual(["real.mp4"]);
  });

  it("listMediaSet gives O(1) membership", async () => {
    const env = makeEnv();
    await putMedia(env, "p1", "storyboard", "s1.png", "b");
    const set = await listMediaSet(env, "p1", "storyboard");
    expect(set.has("s1.png")).toBe(true);
    expect(set.has("nope.png")).toBe(false);
  });
});

describe("streamKey", () => {
  it("streams a full object with etag, accept-ranges and immutable cache", async () => {
    const env = makeEnv();
    await putMedia(env, "p1", "gen", "a.mp4", "hello world", "video/mp4");
    const res = await streamKey(env, mediaKey("p1", "gen", "a.mp4"));
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  it("honors a Range request with a 206 + content-range", async () => {
    const env = makeEnv();
    await putMedia(env, "p1", "gen", "a.mp4", "0123456789");
    const res = await streamKey(env, mediaKey("p1", "gen", "a.mp4"), "bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
  });

  it("returns 304 when if-none-match matches the etag", async () => {
    const env = makeEnv();
    await putMedia(env, "p1", "final", "editor-render.mp4", "bytes");
    const key = mediaKey("p1", "final", "editor-render.mp4");
    const first = await streamKey(env, key);
    const etag = first.headers.get("etag");
    const res = await streamKey(env, key, undefined, { ifNoneMatch: etag });
    expect(res.status).toBe(304);
  });

  it("gives the overwritable final/* family a revalidating cache policy", async () => {
    const env = makeEnv();
    await putMedia(env, "p1", "final", "editor-render.mp4", "bytes");
    const res = await streamKey(env, mediaKey("p1", "final", "editor-render.mp4"));
    expect(res.headers.get("cache-control")).toContain("no-cache");
  });

  it("404s a missing key", async () => {
    const env = makeEnv();
    const res = await streamKey(env, "media/p1/gen/ghost.mp4");
    expect(res.status).toBe(404);
  });
});
