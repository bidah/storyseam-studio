// The Film job's writing stages after the World (#66): Reference sheets, Shot
// list, Cue sheet — run against a FAKE writing model and a fake fal, on a real
// in-memory D1 and R2, asserting what gets SAVED for a canned World.
import { describe, it, expect, vi } from "vitest";
import { makeEnv } from "./_fakes.js";
import { FILM_STAGES } from "../../worker/src/lib/film-job.js";
import { planSheets, runSheetsStage, SHEET_MODEL } from "../../worker/src/lib/film-stages/sheets.js";
import { runShotlistStage } from "../../worker/src/lib/film-stages/shotlist.js";
import { runCueSheetStage } from "../../worker/src/lib/film-stages/cuesheet.js";
import { saveWorld } from "../../worker/src/routes/world.js";
import { readIndex, readSeries } from "../../worker/src/lib/director.js";
import { readDoc } from "../../worker/src/lib/docs.js";
import { planFilm } from "../../worker/src/lib/film-plan.ts";
import { MAX_DIRECTIONS } from "../../worker/src/lib/series.ts";
import { SHEET_FORM, SHOTLIST_FIELDS } from "../../worker/src/lib/auto-prompts.generated.js";

const PID = "p1";

const WORLD = {
  title: "The Last Lamp",
  logline: "A cat, a dark lighthouse, and one night to save the fleet.",
  characters: [
    { name: "Mote", role: "Protagonist", appearance: "Grey tabby, one white paw" },
    { name: "Old Ada", archetype: "Mentor", appearance: "Keeper in oilskins" },
  ],
  locations: [
    { name: "Lamp room", description: "Brass and glass, lit orange" },
    { name: "Storm cliffs", description: "Black rock, white spray" },
  ],
};

// The art department's answer: two styles, Mote and the Lamp room, and a
// machine — but it FORGOT Old Ada and the Storm cliffs.
const SHEETS_ANSWER = {
  renderClause: "Painterly 2D, limited teal and amber palette, soft grain.",
  styles: [
    { name: "House style", prompt: "A style frame: palette swatches, grain, lamp-light." },
    { name: "Night palette", prompt: "Night variant: deep teal, amber highlights." },
  ],
  sheets: [
    { kind: "location", name: "Lamp room", prompt: "Lamp room, three views, brass and glass." },
    { kind: "character", name: "Mote", prompt: "Mote turnaround, grey tabby, no black fur." },
    { kind: "character", name: "The Fog Engine", prompt: "A clanking fog machine, four views." },
  ],
};

const shotsAnswer = (n, dur) => ({
  shots: Array.from({ length: n }, (_, i) => ({
    beat: `B${1 + Math.floor(i / 5)}`,
    beatTitle: "Night",
    location: i % 2 ? "lamp-room" : "storm-cliffs",
    dur,
    characters: ["Mote"],
    camera: i % 2 ? "Close-up, push-in" : "Wide, static",
    action: `Shot ${i + 1}: Mote climbs.`,
    dialogue: "(no dialogue)",
    audioSync: `wind ${i + 1}`,
    prompt: `Mote climbs, shot ${i + 1}.`,
  })),
});

/** A writing model that answers by which room is asking. */
function fakeModel({ shots = shotsAnswer(30, 4) } = {}) {
  return {
    json: vi.fn(async ({ messages }) => {
      const sys = messages[0].content;
      if (sys.includes("art department")) return SHEETS_ANSWER;
      if (sys.includes("SHOT LIST")) return shots;
      throw new Error("unexpected prompt");
    }),
  };
}

/** fal, the image fetch and R2 — faked at the stage's own seams. */
function fakeImages() {
  let n = 0;
  const submitted = [];
  const fal = {
    submit: vi.fn(async (key, endpoint, input) => {
      n += 1;
      submitted.push({ key, endpoint, input, id: `req-${n}` });
      return { requestId: `req-${n}` };
    }),
    poll: vi.fn(async (_key, _endpoint, requestId) => ({ done: true, url: `https://v3.fal.media/files/${requestId}.png` })),
  };
  const fetch = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
  return { deps: { fal, fetch, sleep: async () => {} }, submitted };
}

async function setup({ prompt = "a cat saves a lighthouse", env = makeEnv({ FAL_KEY: "platform-key" }) } = {}) {
  await saveWorld(env, PID, { ...WORLD, source: "auto" });
  const job = { id: "film-1", prompt, projectId: PID, userId: "u1", steps: [] };
  const results = { world: { idea: "A cat relights the lamp before the storm ships arrive.", title: WORLD.title } };
  return { env, job, results };
}

describe("the Film stages after the World", () => {
  it("appends sheets → shotlist → cuesheet after world, one card each", () => {
    expect(FILM_STAGES.map((s) => [s.key, s.label])).toEqual([
      ["look", "Look"],
      ["world", "Idea + World"],
      ["sheets", "Reference sheets"],
      ["shotlist", "Shot list"],
      ["cuesheet", "Cue sheet"],
      ["run", "Shot sheet run"],
      ["stills", "Stills"],
      ["sitting", "Sitting"],
      ["score", "Score"],
    ]);
  });

  it("Reference sheets: ≤9, style first, every World subject covered, drawn on the platform key and filed on the Film's Series", async () => {
    const { env, job, results } = await setup();
    const model = fakeModel();
    const { deps, submitted } = fakeImages();

    const out = await runSheetsStage({ job, results, env, model }, deps);

    // The model was prompted with the model-sheets playbook and the World.
    const { messages } = model.json.mock.calls[0][0];
    expect(messages[0].content).toContain(SHEET_FORM);
    expect(messages[1].content).toContain("Old Ada");

    // Filed on a Series made for THIS Film, which is now the open one.
    const { seriesId } = out.result;
    const index = await readIndex(env, PID);
    expect(index.seriesIds).toEqual([seriesId]);
    expect(index.selectedId).toBe(seriesId);
    const series = await readSeries(env, PID, seriesId);
    expect(series.filmId).toBe("film-1");
    expect(series.title).toBe("The Last Lamp");

    const sheets = series.modelSheets;
    expect(sheets.length).toBeLessThanOrEqual(9);
    expect(sheets.map((s) => [s.kind, s.name])).toEqual([
      ["style", "House style"],
      ["style", "Night palette"],
      ["character", "Mote"],
      ["character", "Old Ada"], // forgotten by the model, covered from the World
      ["location", "Lamp room"],
      ["location", "Storm cliffs"], // likewise
      ["character", "The Fog Engine"], // the extra recurring machine fits
    ]);
    for (const s of sheets) {
      expect(s.imageUrl).toMatch(/^\/director-media\/auto-film-1-.+\.png$/);
      expect(s.model).toBe(SHEET_MODEL.label);
      expect(s.prompt).toContain(SHEETS_ANSWER.renderClause); // one render clause, held identical
    }
    // Subjects were drawn WITH the style sheets as references; styles from prose.
    const styleUrls = sheets.filter((s) => s.kind === "style").map((s) => s.imageUrl);
    expect(sheets.find((s) => s.name === "Mote").refs).toEqual(styleUrls);
    expect(sheets.find((s) => s.name === "House style").refs).toEqual([]);

    // Every image went to fal on the PLATFORM key, 16:9, styles to text-to-image
    // first and subjects to /edit with the styles' fal urls.
    expect(submitted).toHaveLength(7);
    for (const s of submitted) {
      expect(s.key).toBe("platform-key");
      expect(s.input.image_size).toBe("landscape_16_9");
    }
    expect(submitted.slice(0, 2).map((s) => s.endpoint)).toEqual([SHEET_MODEL.endpoint, SHEET_MODEL.endpoint]);
    for (const s of submitted.slice(2)) {
      expect(s.endpoint).toBe(SHEET_MODEL.editEndpoint);
      expect(s.input.image_urls).toEqual(["https://v3.fal.media/files/req-1.png", "https://v3.fal.media/files/req-2.png"]);
    }
    // The bytes are in R2 under this project's Director media.
    const keys = [...env.BUCKET._store.keys()].filter((k) => k.startsWith(`media/${PID}/director/`));
    expect(keys).toHaveLength(7);

    // The card: names, and the thumbnails in the result.
    expect(out.summary).toBe("7 reference sheets — House style, Night palette, Mote, Old Ada, Lamp room, Storm cliffs, The Fog Engine · 4 linked in the Bible");
    expect(out.result.sheets.map((s) => s.imageUrl)).toEqual(sheets.map((s) => s.imageUrl));
  });

  it("a re-run reuses the Film's Series and does not redraw a filed sheet", async () => {
    const { env, job, results } = await setup();
    const first = fakeImages();
    const a = await runSheetsStage({ job, results, env, model: fakeModel() }, first.deps);
    const again = fakeImages();
    const b = await runSheetsStage({ job, results, env, model: fakeModel() }, again.deps);
    expect(b.result.seriesId).toBe(a.result.seriesId);
    expect((await readIndex(env, PID)).seriesIds).toHaveLength(1);
    expect(again.submitted).toHaveLength(0);
  });

  it("refuses to draw without the platform fal key", async () => {
    const { env, job, results } = await setup({ env: makeEnv() });
    await expect(runSheetsStage({ job, results, env, model: fakeModel() }, fakeImages().deps)).rejects.toThrow(/FAL_KEY/);
  });

  it("caps at nine: one style gives way, then extras, then the tail", () => {
    const big = {
      characters: Array.from({ length: 6 }, (_, i) => ({ name: `C${i}`, appearance: "x" })),
      locations: Array.from({ length: 4 }, (_, i) => ({ name: `L${i}`, description: "y" })),
    };
    const plan = planSheets(SHEETS_ANSWER, big);
    expect(plan).toHaveLength(9);
    expect(plan[0]).toMatchObject({ kind: "style", name: "House style" });
    expect(plan.filter((s) => s.kind === "style")).toHaveLength(1);
    expect(plan.map((s) => s.name)).not.toContain("The Fog Engine");

    const small = planSheets({ styles: [], sheets: [] }, { characters: [{ name: "A" }], locations: [] });
    expect(small.map((s) => s.kind)).toEqual(["style", "character"]);
  });

  it("Shot list: the playbook's rules, the plan's length, saved through saveShotlist", async () => {
    const { env, job, results } = await setup({ prompt: "a three minute film about a cat" });
    const model = fakeModel({ shots: shotsAnswer(45, 4) });
    const out = await runShotlistStage({ job, results, env, model });

    const { messages } = model.json.mock.calls[0][0];
    expect(messages[0].content).toContain(SHOTLIST_FIELDS);
    expect(messages[0].content).toContain("3:00 (180 seconds)");
    expect(messages[1].content).toContain("lamp-room");

    const doc = await readDoc(env, PID, "shotlist", { shots: [] });
    expect(doc.shots).toHaveLength(45);
    expect(doc.source).toBe("auto");
    expect(doc.shots[0]).toMatchObject({ id: "01", location: "storm-cliffs", characters: ["Mote"], dur: 4 });
    expect(out.summary).toBe("45 shots, 3:00 as written");
    expect(out.result.count).toBe(45);
  });

  it("Shot list: the music cue layer comes back in the same answer, repaired, in the stage result", async () => {
    const { env, job, results } = await setup({ prompt: "a three minute film about a cat" });
    const answer = {
      ...shotsAnswer(45, 4),
      music: [
        { startShot: 40, cue: "tender", energy: 9, note: "home again" },
        { startShot: 1, cue: "wonder", energy: 2, note: "the cliffs at night" },
        { startShot: 10, cue: "Suspense", energy: 3 },
        { startShot: 20, cue: "silence" },
        { startShot: 22, cue: "action", energy: 5, note: "the storm hits" },
        { startShot: 30, cue: "kazoo" }, // not in the vocabulary
      ],
    };
    const model = fakeModel({ shots: answer });
    const out = await runShotlistStage({ job, results, env, model });

    const sys = model.json.mock.calls[0][0].messages[0].content;
    expect(sys).toContain('"music": [{ "startShot": number, "cue": string, "energy": number, "note": string }]');
    expect(sys).toContain("  suspense (tension)");
    expect(sys).toContain("  silence — no music at all");
    expect(sys).toMatch(/5–8 cues for this film/);

    expect(out.result.music).toEqual([
      { startShot: 1, cue: "wonder", energy: 2, note: "the cliffs at night", startSec: 0, shotId: "01" },
      { startShot: 10, cue: "suspense", energy: 3, note: "", startSec: 36, shotId: "10" },
      { startShot: 20, cue: "silence", energy: 1, note: "", startSec: 76, shotId: "20" },
      { startShot: 22, cue: "action", energy: 5, note: "the storm hits", startSec: 84, shotId: "22" },
      { startShot: 40, cue: "tender", energy: 5, note: "home again", startSec: 156, shotId: "40" },
    ]);
    expect(out.summary).toBe("45 shots, 3:00 as written · 5 music cues");

    // No music in the answer: the stage still succeeds, with no cues.
    const plain = await runShotlistStage({ job, results, env, model: fakeModel({ shots: shotsAnswer(45, 4) }) });
    expect(plain.result.music).toBeUndefined();
    expect(plain.summary).toBe("45 shots, 3:00 as written");
  });

  it.each([
    ["a cat saves a lighthouse", 120, 4, 30],
    ["a three minute film", 180, 4, 45],
    ["a four and a half minute epic", 270, 5, 54], // 4s would be 68 — past the Series' 64
  ])("Cue sheet for %j: %is at %is → %i beats on the Series, matching the plan", async (prompt, seconds, spacing, beats) => {
    const { env, job, results } = await setup({ prompt });
    const sheets = await runSheetsStage({ job, results, env, model: fakeModel() }, fakeImages().deps);
    // A shot list whose durations do NOT add up to the Film — the grid fixes that.
    await runShotlistStage({ job, results, env, model: fakeModel({ shots: shotsAnswer(20, 3) }) });

    const out = await runCueSheetStage({ job, results: { ...results, sheets: sheets.result }, env });

    const plan = planFilm({ prompt });
    expect([plan.seconds, plan.spacing, plan.beats]).toEqual([seconds, spacing, beats]);

    const series = await readSeries(env, PID, sheets.result.seriesId);
    const dirs = series.directions;
    expect(dirs).toHaveLength(beats);
    expect(dirs.length).toBeLessThanOrEqual(MAX_DIRECTIONS);
    expect(dirs.map((d) => d.offset)).toEqual(Array.from({ length: beats }, (_, i) => i * spacing));
    expect(dirs.at(-1).prompt.range).toBe(`Seconds ${(beats - 1) * spacing}–${seconds} of the film.`);
    expect(dirs[0].prompt.scene).toContain("Shot 1: Mote climbs.");
    expect(dirs.every((d) => !d.endImageUrl)).toBe(true); // pins are a later stage's
    // The model sheets survived the cue-sheet write.
    expect(series.modelSheets.length).toBe(7);

    expect(out.result).toMatchObject({ seriesId: sheets.result.seriesId, beats, spacing, seconds, pins: plan.pins });
    expect(out.summary).toBe(`${beats} beats every ${spacing}s over ${plan.length} · ${plan.pins} pins planned`);
  });

  it("Cue sheet fails plainly without a Series or a shot list", async () => {
    const { env, job, results } = await setup();
    await expect(runCueSheetStage({ job, results, env })).rejects.toThrow(/no Series/);
    await expect(runCueSheetStage({ job, results: { sheets: { seriesId: "s_x" } }, env })).rejects.toThrow(/no shot list/);
  });
});
