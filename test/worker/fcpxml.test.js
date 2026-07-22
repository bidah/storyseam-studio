import { describe, it, expect } from "vitest";
import { timelineToFcpxml } from "../../worker/src/lib/fcpxml.js";

const clip = (o) => ({ from: 0, durationInFrames: 24, ...o });

describe("timelineToFcpxml", () => {
  it("emits a well-formed FCPXML 1.9 document with a gap-backbone spine", () => {
    const tl = {
      fps: 24,
      width: 1280,
      height: 720,
      tracks: [{ type: "video", items: [clip({ src: "/gen/MS-01.mp4", durationInFrames: 48 })] }],
    };
    const { xml, media } = timelineToFcpxml(tl, { projectName: "My Cut" });
    expect(xml).toContain('<fcpxml version="1.9">');
    expect(xml).toContain('<project name="My Cut">');
    expect(xml).toContain("<spine>");
    expect(xml).toContain('<gap name="Timeline"');
    expect(xml).toContain('<asset-clip ref="a1"');
    expect(media).toEqual([{ src: "/gen/MS-01.mp4", zipName: "MS-01.mp4" }]);
  });

  it("drops disabled clips and clips without a src (nothing to relink)", () => {
    const tl = {
      tracks: [
        {
          type: "video",
          items: [
            clip({ src: "/gen/a.mp4" }),
            clip({ src: "/gen/b.mp4", disabled: true }),
            clip({ src: null }), // slate
          ],
        },
      ],
    };
    const { media } = timelineToFcpxml(tl);
    expect(media.map((m) => m.src)).toEqual(["/gen/a.mp4"]);
  });

  it("flags a still image asset as hasAudio=0 (no phantom audio track)", () => {
    const tl = {
      tracks: [{ type: "video", items: [clip({ src: "/storyboard-media/shot.png", kind: "image" })] }],
    };
    const { xml } = timelineToFcpxml(tl);
    expect(xml).toMatch(/<asset id="a1"[^>]*hasVideo="1" hasAudio="0"/);
  });

  it("flags a /sound-media/ asset as audio-only", () => {
    const tl = { tracks: [{ type: "audio", items: [clip({ src: "/sound-media/score.mp3" })] }] };
    const { xml } = timelineToFcpxml(tl);
    expect(xml).toMatch(/<asset id="a1"[^>]*hasVideo="0" hasAudio="1"/);
  });

  it("XML-escapes special characters in names", () => {
    const tl = { tracks: [{ type: "video", items: [clip({ src: "/gen/a.mp4", name: 'A & B <c>' })] }] };
    const { xml } = timelineToFcpxml(tl);
    expect(xml).toContain("A &amp; B &lt;c&gt;");
    expect(xml).not.toContain("A & B <c>");
  });

  it("puts video on positive lanes and audio on negative lanes", () => {
    const tl = {
      tracks: [
        { type: "video", items: [clip({ src: "/gen/v.mp4" })] },
        { type: "audio", items: [clip({ src: "/sound-media/a.mp3" })] },
      ],
    };
    const { xml } = timelineToFcpxml(tl);
    expect(xml).toMatch(/ref="a1" lane="1"/); // video → lane 1
    expect(xml).toMatch(/ref="a2" lane="-1"/); // audio → lane -1
  });

  it("spills overlapping clips in one track to a fresh lane (never overlaps)", () => {
    const tl = {
      tracks: [
        {
          type: "video",
          items: [
            clip({ src: "/gen/a.mp4", from: 0, durationInFrames: 48 }),
            clip({ src: "/gen/b.mp4", from: 24, durationInFrames: 48 }), // overlaps a
          ],
        },
      ],
    };
    const { xml } = timelineToFcpxml(tl);
    const lanes = [...xml.matchAll(/lane="(-?\d+)"/g)].map((m) => m[1]);
    expect(new Set(lanes).size).toBe(2); // two distinct lanes, no stacking
  });

  it("disambiguates a zip-name collision between two different srcs", () => {
    const tl = {
      tracks: [
        {
          type: "video",
          items: [clip({ src: "/gen/clip.mp4" }), clip({ src: "/multishot-media/clip.mp4", from: 48 })],
        },
      ],
    };
    const { media } = timelineToFcpxml(tl);
    const names = media.map((m) => m.zipName);
    expect(new Set(names).size).toBe(2); // collision resolved
    expect(names).toContain("clip.mp4");
  });

  it("writes an <adjust-volume> for a muted clip", () => {
    const tl = { tracks: [{ type: "audio", items: [clip({ src: "/sound-media/a.mp3", muted: true })] }] };
    const { xml } = timelineToFcpxml(tl);
    expect(xml).toContain("<adjust-volume");
    expect(xml).toContain('amount="-96dB"');
  });

  it("writes linear fade-in/out for an audio clip with fades", () => {
    const tl = {
      tracks: [{ type: "audio", items: [clip({ src: "/sound-media/a.mp3", fadeInFrames: 12, fadeOutFrames: 24 })] }],
    };
    const { xml } = timelineToFcpxml(tl);
    expect(xml).toContain('<fadeIn type="linear"');
    expect(xml).toContain('<fadeOut type="linear"');
  });

  it("an empty timeline still produces a valid 1-frame sequence", () => {
    const { xml, media } = timelineToFcpxml({ tracks: [] });
    expect(xml).toContain("<fcpxml");
    expect(media).toEqual([]);
  });
});
