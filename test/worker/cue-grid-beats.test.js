// The Auto cue sheet's grid beats. They are read twice: by the Director (the
// beat's text) and by the shot sheet, which draws one still per beat from the
// same text. So: a shot is ACTED once; every beat ENDS on the frame of the shot
// playing at its last second (the still's picture); the place and cast are
// named as their model sheets are, so the sheet can tag them; and every beat
// carries the Film's sound lock — its language, and no music.
import { describe, expect, it } from "vitest";
import { beatsOnGrid } from "../../worker/src/lib/cue-derive.js";
import { filmSoundLock } from "../../worker/src/lib/film-sound.js";
import { endBrief, referencesOf, slotsOf, tagReferences, visibleText } from "../../worker/src/lib/shot-sheet.ts";

const SHOTS = [
  {
    id: "s1", location: "hollow-home", characters: ["Mika", "Toru"], dur: 8, camera: "Low angle wide shot",
    action: "Mika and Toru race across the clearing.", dialogue: "Race you!", audioSync: "footsteps on moss",
    prompt: "Two boys sprint over dewy moss toward the treeline. Lanterns glow behind them.",
  },
  {
    id: "s2", location: "fountain", characters: ["Mika"], dur: 4, camera: "Close-up",
    action: "Mika leaps into the basin.", prompt: "Mika mid-air above dark water, arms wide.",
  },
];
const PLACES = { "hollow-home": "Hollow Home", fountain: "Fountain of First Light" };

describe("beatsOnGrid (Auto)", () => {
  const { beats } = beatsOnGrid(SHOTS, { seconds: 12, spacing: 4, sound: filmSoundLock(), places: PLACES });
  const count = (text, needle) => text.split(needle).length - 1;

  it("acts a shot once: the beat it continues into holds it", () => {
    expect(beats[0].prompt.scene).toContain("Mika and Toru race across the clearing.");
    expect(beats[0].prompt.scene).toContain("Dialogue: Race you!");
    expect(beats[0].prompt.score).toBe("footsteps on moss");
    expect(beats[1].prompt.scene).toMatch(/^The shot continues: hold it, do not restart the action\./);
    expect(beats[1].prompt.scene).not.toContain("Mika and Toru race across the clearing.");
    expect(beats[1].prompt.scene).not.toContain("Race you");
    expect(beats[1].prompt.score).toBeUndefined();
    expect(count(beats[2].prompt.scene, "Mika leaps into the basin.")).toBe(1);
  });

  it("every still is the frame of the shot it pins — never the hold line", () => {
    expect(endBrief(visibleText(beats[1].prompt))).toBe(
      "End on Low angle wide shot, Hollow Home — Mika, Toru: Two boys sprint over dewy moss toward the treeline; Lanterns glow behind them.",
    );
    const series = { directions: beats, imageUrl: null, prompts: {} };
    const slots = slotsOf(series);
    expect(slots[0].brief).toBe(
      "Low angle wide shot, Hollow Home — Mika, Toru: Two boys sprint over dewy moss toward the treeline; Lanterns glow behind them.",
    );
    for (const slot of slots.slice(1)) {
      expect(slot.brief).toMatch(/^End on /);
      expect(slot.brief).not.toMatch(/continues/);
    }
    // The last beat closes on the shot playing at its end — the leap.
    expect(endBrief(visibleText(beats[2].prompt))).toBe(
      "End on Close-up, Fountain of First Light — Mika: Mika mid-air above dark water, arms wide.",
    );
  });

  it("names the place and the cast as their sheets are filed, so the sheet tags them", () => {
    const series = {
      modelSheets: [
        { kind: "style", name: "House", imageUrl: "https://x/style.png" },
        { kind: "character", name: "Toru", imageUrl: "https://x/toru.png" },
        { kind: "character", name: "Mika", imageUrl: "https://x/mika.png" },
        { kind: "location", name: "Hollow Home", imageUrl: "https://x/home.png" },
      ],
    };
    const text = endBrief(visibleText(beats[1].prompt));
    const refs = referencesOf(series, [{ text }]);
    const tagged = tagReferences(text, refs);
    for (const name of ["Hollow Home", "Mika", "Toru"]) {
      expect(tagged).toContain(`${name} (Image ${refs.findIndex((r) => r.name === name) + 1})`);
    }
  });

  it("carries the sound lock on every beat, and never draws it", () => {
    for (const beat of beats) {
      expect(beat.prompt.sound).toMatch(/in English only/);
      expect(beat.prompt.sound).toMatch(/No music/);
      expect(visibleText(beat.prompt)).not.toMatch(/No music/);
    }
  });
});
