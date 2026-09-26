// The Auto cue sheet's grid beats: a shot is ACTED once, the place and cast are
// named as their model sheets are (so the shot sheet can tag them), and every
// beat carries the Film's sound lock — its language, and no music.
import { describe, expect, it } from "vitest";
import { beatsOnGrid } from "../../worker/src/lib/cue-derive.js";
import { filmSoundLock } from "../../worker/src/lib/film-sound.js";
import { referencesOf, tagReferences, visibleText } from "../../worker/src/lib/shot-sheet.ts";

const SHOTS = [
  { id: "s1", location: "hollow-home", characters: ["Mika", "Toru"], dur: 8, action: "Mika and Toru race across the clearing.", dialogue: "Race you!", audioSync: "footsteps on moss" },
  { id: "s2", location: "fountain", characters: ["Mika"], dur: 4, action: "Mika leaps into the basin." },
];
const PLACES = { "hollow-home": "Hollow Home", fountain: "Fountain of First Light" };

describe("beatsOnGrid (Auto)", () => {
  const { beats } = beatsOnGrid(SHOTS, { seconds: 12, spacing: 4, sound: filmSoundLock(), places: PLACES });

  it("acts a shot in the beat where it starts, and only holds it after", () => {
    expect(beats[0].prompt.scene).toContain("race across the clearing");
    expect(beats[0].prompt.scene).toContain("Dialogue: Race you!");
    expect(beats[0].prompt.score).toBe("footsteps on moss");
    expect(beats[1].prompt.scene).not.toContain("race across");
    expect(beats[1].prompt.scene).not.toContain("Race you");
    expect(beats[1].prompt.scene).toMatch(/same shot continues on Mika, Toru.*do not restart or repeat/);
    expect(beats[1].prompt.score).toBeUndefined();
    expect(beats[2].prompt.scene).toContain("leaps into the basin");
  });

  it("names the place and the cast as their sheets are filed", () => {
    expect(beats[0].prompt.scene).toMatch(/^At Hollow Home\. Mika, Toru\./);
    expect(beats[2].prompt.scene).toMatch(/^At Fountain of First Light\. Mika\./);
    const series = {
      modelSheets: [
        { kind: "style", name: "House", imageUrl: "https://x/style.png" },
        { kind: "character", name: "Toru", imageUrl: "https://x/toru.png" },
        { kind: "character", name: "Mika", imageUrl: "https://x/mika.png" },
        { kind: "location", name: "Hollow Home", imageUrl: "https://x/home.png" },
      ],
    };
    const text = visibleText(beats[0].prompt);
    const refs = referencesOf(series, [{ text }]);
    expect(refs.map((r) => r.name).sort()).toEqual(["Hollow Home", "House", "Mika", "Toru"]);
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
