import { describe, it, expect } from "vitest";
import { isVoiceTrack, attachableVoices } from "../../flue-agent/src/lib/voices";

describe("isVoiceTrack", () => {
  it("honors an explicit kind flag", () => {
    expect(isVoiceTrack({ kind: "voice" })).toBe(true);
    expect(isVoiceTrack({ kind: "sfx" })).toBe(false);
    expect(isVoiceTrack({ kind: "music" })).toBe(false);
  });

  it("infers a voice track from the v1 prompt heuristic (@audioN / voice-act)", () => {
    expect(isVoiceTrack({ versions: [{ v: 1, prompt: "@audio1 warm narrator" }] })).toBe(true);
    expect(
      isVoiceTrack({ versions: [{ v: 1, prompt: "Use a seed audio voice reference to voice-act Sara" }] }),
    ).toBe(true);
    expect(isVoiceTrack({ versions: [{ v: 1, prompt: "rain on a tin roof" }] })).toBe(false);
  });

  it("uses v1 (or the first version) as the prompt sample", () => {
    expect(
      isVoiceTrack({ versions: [{ v: 2, prompt: "@audio1 x" }, { v: 1, prompt: "birdsong" }] }),
    ).toBe(false); // v1 is birdsong, not a voice
  });

  it("is null-safe", () => {
    expect(isVoiceTrack(null)).toBe(false);
    expect(isVoiceTrack({})).toBe(false);
  });
});

describe("attachableVoices", () => {
  it("flattens liked+rendered voice takes into pickable options", () => {
    const tracks = [
      {
        id: "t1",
        name: "Sara",
        kind: "voice",
        versions: [
          { v: 1, liked: true, url: "/sound-media/a.mp3" },
          { v: 2, liked: false, url: "/sound-media/b.mp3" }, // not liked → excluded
          { v: 3, liked: true, url: null }, // no url → excluded
        ],
      },
      { id: "t2", kind: "sfx", versions: [{ v: 1, liked: true, url: "/x.mp3" }] }, // not a voice
    ];
    expect(attachableVoices(tracks)).toEqual([
      { trackId: "t1", v: 1, name: "Sara", url: "/sound-media/a.mp3" },
    ]);
  });

  it("falls back to the version name then a default label", () => {
    const tracks = [
      { id: "t1", kind: "voice", versions: [{ v: 1, liked: true, url: "/a.mp3", name: "take-name" }] },
    ];
    expect(attachableVoices(tracks)[0].name).toBe("take-name");
    const unnamed = [{ id: "t2", kind: "voice", versions: [{ v: 1, liked: true, url: "/b.mp3" }] }];
    expect(attachableVoices(unnamed)[0].name).toBe("Untitled voice");
  });

  it("returns [] for empty / nullish input", () => {
    expect(attachableVoices([])).toEqual([]);
    expect(attachableVoices(null as any)).toEqual([]);
  });
});
