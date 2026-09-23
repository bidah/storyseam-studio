// The Series model — the ceilings, the reel cut, and the message that goes on
// the wire.
//
// Every number checked here is one the Director endpoint enforces by refusing
// the WHOLE session at `configure`, after the cue sheet was saved and after the
// frames were drawn. That is the most expensive possible way to find out, which
// is why the form, the Worker and the agent all check the same list first —
// and why the list gets a test.
import { describe, expect, it } from "vitest";
import {
  MAX_END_IMAGES,
  MIN_END_IMAGE_GAP_SECONDS,
  MIN_OPENING_END_IMAGE_SECONDS,
  artSettings,
  beatText,
  mediaRef,
  recipe,
  reels,
  screening,
  script,
  seriesFields,
  seriesInput,
} from "@/lib/series";

/** A Series with just enough on it to be valid. */
const base = (over = {}) =>
  seriesFields.parse({
    title: "Test",
    prompt: "a corridor, handheld",
    imageUrl: "/visual-media/open.png",
    aspectRatio: "16:9",
    ...over,
  });

describe("mediaRef", () => {
  it("takes an absolute url", () => {
    expect(mediaRef.parse("https://example.com/a.png")).toBe("https://example.com/a.png");
  });

  it("takes one of this project's own media paths", () => {
    expect(mediaRef.parse("/sound-media/take_3.mp3")).toBe("/sound-media/take_3.mp3");
    expect(mediaRef.parse("/director-media/sitting.mp4")).toBe("/director-media/sitting.mp4");
    expect(mediaRef.parse("/asset/refs/kai.png")).toBe("/asset/refs/kai.png");
  });

  it("refuses a path under a prefix the Worker does not serve", () => {
    // The failure this prevents: a pin that points at nothing, discovered when
    // the frame comes back wrong rather than when it was saved.
    expect(() => mediaRef.parse("/made-up/x.png")).toThrow();
    expect(() => mediaRef.parse("sound-media/x.mp3")).toThrow();
  });
});

describe("beatText", () => {
  it("passes a string prompt through", () => {
    expect(beatText("push in")).toBe("push in");
  });

  it("sends only the sections the Series includes, in the list's order", () => {
    const sections = { scene: "the bay", style: "16mm", score: "strings enter" };
    expect(beatText(sections, ["style", "scene"])).toBe("16mm\n\nthe bay");
  });

  it("drops a whole section by editing one list, not forty-eight beats", () => {
    const sections = { scene: "the bay", score: "strings enter" };
    expect(beatText(sections, ["scene"])).toBe("the bay");
  });
});

describe("the ceilings", () => {
  it("refuses two pins closer than the endpoint's spacing", () => {
    const series = base({
      directions: [
        { offset: 6, endImageUrl: "/visual-media/a.png" },
        { offset: 6 + MIN_END_IMAGE_GAP_SECONDS - 1, endImageUrl: "/visual-media/b.png" },
      ],
    });
    const result = seriesInput.safeParse(series);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error.issues)).toContain("closer than");
  });

  it("refuses a first pin inside the opening chunk", () => {
    const series = base({
      directions: [
        { offset: MIN_OPENING_END_IMAGE_SECONDS - 1, endImageUrl: "/visual-media/a.png" },
      ],
    });
    const result = seriesInput.safeParse(series);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error.issues)).toContain("opening chunk");
  });

  // A sheet of MAX_END_IMAGES + 1 pins, with a prompt-only beat at `cutAt` for
  // a reel to open on, and the next pin far enough past it to clear the second
  // reel's opening chunk.
  const overlong = () => {
    const directions = [];
    for (let i = 0; i < 8; i++) {
      directions.push({ offset: 5 + i * MIN_END_IMAGE_GAP_SECONDS, endImageUrl: `/visual-media/a${i}.png` });
    }
    const cutAt = 5 + 8 * MIN_END_IMAGE_GAP_SECONDS;
    directions.push({ offset: cutAt, prompt: "second act" });
    for (let i = 0; i <= MAX_END_IMAGES - 8; i++) {
      directions.push({
        offset: cutAt + MIN_OPENING_END_IMAGE_SECONDS + 1 + i * MIN_END_IMAGE_GAP_SECONDS,
        endImageUrl: `/visual-media/b${i}.png`,
      });
    }
    return { directions, cutAt };
  };

  it("counts pins PER REEL, so a sheet too long whole is legal cut in two", () => {
    const { directions, cutAt } = overlong();
    expect(directions.filter((d) => d.endImageUrl)).toHaveLength(MAX_END_IMAGES + 1);

    expect(seriesInput.safeParse(base({ directions })).success).toBe(false);

    // The same sheet, cut. The beat that opens the second reel gives up its
    // pin — which is the whole cost of the cut, and why this now fits.
    expect(seriesInput.safeParse(base({ directions, reelChanges: [cutAt] })).success).toBe(true);
  });

  it("applies the opening-chunk rule to an appended reel too", () => {
    // The trap: a cut made anywhere convenient. Reel two opens a script of its
    // own, so its first pin is measured from ITS zero — and a pin three seconds
    // in is refused there for exactly the reason it is refused at the top of
    // the piece. The sheet was legal; the cut point was not.
    const directions = [];
    for (let i = 0; i <= MAX_END_IMAGES; i++) {
      directions.push({ offset: 5 + i * MIN_END_IMAGE_GAP_SECONDS, endImageUrl: `/visual-media/${i}.png` });
    }
    const badCut = directions[8].offset;
    const result = seriesInput.safeParse(base({ directions, reelChanges: [badCut] }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error.issues)).toContain("reel 2");
  });

  it("refuses a reel change that lands where no beat does", () => {
    const series = base({
      directions: [{ offset: 0, prompt: "open" }],
      reelChanges: [7],
    });
    const result = seriesInput.safeParse(series);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error.issues)).toContain("no beat at 7s");
  });

  it("refuses a published Series with no first frame", () => {
    const result = seriesInput.safeParse(base({ imageUrl: "", status: "published" }));
    expect(result.success).toBe(false);
  });
});

describe("script", () => {
  it("sorts by offset, because offset is the beat's identity to the Director", () => {
    const series = base({
      directions: [
        { offset: 12, prompt: "later" },
        { offset: 0, prompt: "open" },
      ],
    });
    expect(script(series).map((b) => b.offset)).toEqual([0, 12]);
  });

  it("rides the selected audio on the first beat, unless that beat has its own", () => {
    const withTarget = base({
      directions: [{ offset: 0, prompt: "open" }],
      audioVersion: { prompt: "the mix", audioUrl: "/sound-media/mix.mp3" },
    });
    expect(script(withTarget)[0].audio_url).toBe("/sound-media/mix.mp3");

    const beatWins = base({
      directions: [{ offset: 0, prompt: "open", audioUrl: "/sound-media/own.mp3" }],
      audioVersion: { prompt: "the mix", audioUrl: "/sound-media/mix.mp3" },
    });
    expect(script(beatWins)[0].audio_url).toBe("/sound-media/own.mp3");
  });
});

describe("reels", () => {
  const series = base({
    directions: [
      { offset: 0, prompt: "open" },
      { offset: 10, prompt: "middle", endImageUrl: "/visual-media/m.png" },
      { offset: 30, prompt: "second act", endImageUrl: "/visual-media/s.png" },
      { offset: 45, prompt: "close" },
    ],
    reelChanges: [30],
  });

  it("is one reel, byte for byte the old script, when nothing is cut", () => {
    const uncut = base({ directions: [{ offset: 0, prompt: "open" }] });
    expect(reels(uncut)).toEqual([script(uncut)]);
  });

  it("rebases each reel onto its own clock", () => {
    const [, second] = reels(series);
    expect(second.map((b) => b.offset)).toEqual([0, 15]);
  });

  it("takes the pin off the beat that opens an appended reel", () => {
    // No chunk ends at second zero, so there is no final frame for a pin there
    // to be. One frame per reel change is the real cost of a cut.
    const [, second] = reels(series);
    expect(second[0].end_image_url).toBeNull();
  });
});

describe("recipe", () => {
  it("nulls the top-level bed and end image once there is a script", () => {
    // The endpoint refuses them beside a script — "place them in the script".
    const series = base({
      directions: [{ offset: 0, prompt: "open" }],
      audioUrl: "/sound-media/bed.mp3",
      endImageUrl: "/visual-media/last.png",
    });
    const out = recipe(series);
    expect(out.audio_url).toBeNull();
    expect(out.end_image_url).toBeNull();
    expect(out.script).toHaveLength(1);
  });

  it("keeps them when there is no script at all", () => {
    const series = base({ audioUrl: "/sound-media/bed.mp3" });
    expect(recipe(series).audio_url).toBe("/sound-media/bed.mp3");
    expect(recipe(series).script).toBeNull();
  });

  it("names only the keys the endpoint knows", () => {
    // `configure` forbids additional properties, so a row that grows a field
    // must not grow the message.
    expect(Object.keys(recipe(base())).sort()).toEqual([
      "aspect_ratio", "audio_url", "end_image_url", "image_url", "memory",
      "prompt", "prompt_version", "protocol_version", "resolution", "script",
      "seed", "type",
    ]);
  });
});

describe("screening", () => {
  it("numbers the appended reels from 2, because configure is 1", () => {
    const series = base({
      directions: [
        { offset: 0, prompt: "open" },
        { offset: 30, prompt: "second act" },
      ],
      reelChanges: [30],
    });
    const out = screening(series);
    expect(out.configure.prompt_version).toBe(1);
    expect(out.reels.map((r) => r.prompt_version)).toEqual([2]);
    expect(out.reels[0].script_mode).toBe("append");
  });

  it("measures the film on the AUTHORED clock, not the rebased one", () => {
    const series = base({
      directions: [
        { offset: 0, prompt: "open" },
        { offset: 30, prompt: "second act" },
      ],
      reelChanges: [30],
    });
    // 30s to the last beat plus the tail a text beat runs for — not 0 + tail,
    // which is where the rebased reel's last offset would have put it.
    expect(screening(series).filmSeconds).toBeGreaterThan(30);
  });
});

describe("artSettings", () => {
  it("draws sheets at 16:9 whatever shape the Series is", () => {
    // A turnaround spends its width on four or five views; the same pixels in
    // 9:16 leave each view too small to reference, which is all a sheet is for.
    expect(artSettings({ aspectRatio: "9:16", resolution: "480p" }).sheets.aspectRatio).toBe("16:9");
  });

  it("draws stills in the Series' own shape", () => {
    // A pinned frame is the EXACT frame the Director continues from — a 9:16
    // frame on a 16:9 Series is a different opening image, not a cropped one.
    expect(artSettings({ aspectRatio: "9:16", resolution: "480p" }).stills.aspectRatio).toBe("9:16");
  });
});
