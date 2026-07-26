import { describe, it, expect } from "vitest";
import { makeEnv } from "./_fakes.js";
import { writeDoc } from "../../worker/src/lib/docs.js";
import { mediaKey } from "../../worker/src/lib/media.js";
import { pickTake, buildBundleIndex, readStillsContext } from "../../worker/src/lib/stills.js";

describe("pickTake", () => {
  const present = new Set(["a.png", "b.png", "sel.png"]);

  it("returns null when the entry is empty / has no usable take", () => {
    expect(pickTake(null, present)).toBeNull();
    expect(pickTake([], present)).toBeNull();
    expect(pickTake([{ file: "gone.png" }], present)).toBeNull(); // bytes absent → slate
  });

  it("picks the newest present take by default (list is newest-last)", () => {
    expect(pickTake([{ file: "a.png" }, { file: "b.png" }], present).file).toBe("b.png");
  });

  it("prefers an explicitly selected take over the newest", () => {
    const take = pickTake([{ file: "sel.png", selected: true }, { file: "b.png" }], present);
    expect(take.file).toBe("sel.png");
  });

  it("tolerates the legacy single-object (pre-takes) shape", () => {
    expect(pickTake({ file: "a.png" }, present).file).toBe("a.png");
  });

  it("skips a selected-but-missing take and falls back to a present one", () => {
    const take = pickTake([{ file: "a.png" }, { file: "gone.png", selected: true }], present);
    expect(take.file).toBe("a.png");
  });
});

// Seed a project's episode manifest so shot→bundle resolves from the
// authoritative side.
async function seedManifest(env, pid, bundles) {
  await writeDoc(env, pid, "episode-manifest", { bundles });
}

describe("buildBundleIndex", () => {
  it("resolves a shot to its manifest bundle (authoritative source)", async () => {
    const env = makeEnv();
    await seedManifest(env, "p1", [{ id: "MS-01", shots: [{ id: "01" }, { id: "02" }] }]);
    const index = await buildBundleIndex(env, "p1", []);
    expect(index.hasManifest).toBe(true);
    expect(index.lookup("01")).toEqual({ bundle: "MS-01", source: "manifest" });
  });

  it("first manifest bundle wins for a duplicated shot id", async () => {
    const env = makeEnv();
    await seedManifest(env, "p1", [
      { id: "MS-01", shots: [{ id: "07" }] },
      { id: "MS-09", shots: [{ id: "07" }] },
    ]);
    const index = await buildBundleIndex(env, "p1", []);
    expect(index.lookup("07").bundle).toBe("MS-01");
  });

  it("falls back to packPreview ids for shots the manifest never heard of", async () => {
    const env = makeEnv(); // no manifest
    const shots = [{ id: "01", dur: 5, location: "school-clearing", beat: "b1" }];
    const index = await buildBundleIndex(env, "p1", shots);
    expect(index.hasManifest).toBe(false);
    const hit = index.lookup("01");
    expect(hit).toMatchObject({ source: "packs" });
    expect(hit.bundle).toMatch(/^MS-\d+$/);
  });

  it("returns null for a shot in neither the manifest nor the packs", async () => {
    const env = makeEnv();
    await seedManifest(env, "p1", [{ id: "MS-01", shots: [{ id: "01" }] }]);
    const index = await buildBundleIndex(env, "p1", []);
    expect(index.lookup("999")).toBeNull();
  });
});

describe("readStillsContext.resolve", () => {
  it("joins a shot to its on-screen take when the bytes exist in R2", async () => {
    const env = makeEnv();
    await seedManifest(env, "p1", [{ id: "MS-01", shots: [{ id: "01" }] }]);
    // selections doc holds the stills map keyed [bundle][shot] → takes
    await writeDoc(env, "p1", "selections", {
      stills: { "MS-01": { "01": [{ file: "take1.png" }] } },
    });
    // and the storyboard bytes must be present
    await env.BUCKET.put(mediaKey("p1", "storyboard", "take1.png"), "png-bytes");

    const ctx = await readStillsContext(env, "p1", []);
    const r = ctx.resolve("01");
    expect(r).toMatchObject({ bundle: "MS-01", shot: "01", source: "manifest" });
    expect(r.take.file).toBe("take1.png");
  });

  it("yields a null take (a slate) when the shot has no usable still", async () => {
    const env = makeEnv();
    await seedManifest(env, "p1", [{ id: "MS-01", shots: [{ id: "01" }] }]);
    const ctx = await readStillsContext(env, "p1", []);
    const r = ctx.resolve("01");
    expect(r.bundle).toBe("MS-01");
    expect(r.take).toBeNull();
  });

  it("returns null for a shot that belongs to no bundle", async () => {
    const env = makeEnv();
    await seedManifest(env, "p1", [{ id: "MS-01", shots: [{ id: "01" }] }]);
    const ctx = await readStillsContext(env, "p1", []);
    expect(ctx.resolve("nope")).toBeNull();
  });
});
