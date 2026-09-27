// The story engines' segment prompts — what film-1fd51691 (2026-09-27) taught
// about what a video model does with a prompt: it speaks what it can read as
// speech, it plays every place a prompt names, and H3 re-enacts a reference
// video. So: a voice bound only for who has a line; no title in the prompt;
// the segment's own direction, never a film-wide note naming another place;
// and on H3 the seam is the previous segment's LAST FRAME, not its tail.
import { describe, it, expect } from "vitest";
import { namesOtherPlace, placeWords, segmentDirection } from "../../worker/src/lib/film-stages/story-flow/direction.js";
import { segmentSpeakers, stageLines } from "../../worker/src/lib/film-stages/story-flow/lines.js";
import { compileSegment as seedance, segmentErrors as seedanceErrors } from "../../worker/src/lib/film-stages/story-flow/prompts.js";
import { compileSegment as h3, segmentErrors as h3Errors, segmentRegistry } from "../../worker/src/lib/film-stages/h3/prompts.js";
import { segmentInput } from "../../worker/src/lib/film-stages/h3/run.js";
import { cutScript } from "../../worker/src/lib/film-stages/story-flow/media.js";

const LOOK = { id: "3d-pixar", look: "Stylized 3D CG animation.", lock: "[LOOK LOCK] 3D CG at every second." };
const REFS = [
  { kind: "character", view: "body", subject: "Leo", name: "Leo — turnaround", imageUrl: "/director-media/leo-body.png", inherit: "Lean 12-year-old boy in a teal hoodie" },
  { kind: "character", view: "face", subject: "Leo", name: "Leo — face", imageUrl: "/director-media/leo-face.png", inherit: "Lean 12-year-old boy in a teal hoodie" },
  { kind: "character", view: "body", subject: "Sal", name: "Sal — turnaround", imageUrl: "/director-media/sal-body.png", inherit: "Round vendor in a yellow shirt" },
  { kind: "character", view: "face", subject: "Sal", name: "Sal — face", imageUrl: "/director-media/sal-face.png", inherit: "Round vendor in a yellow shirt" },
  { kind: "location", view: "plate", subject: "Leo's Apartment", name: "Leo's Apartment — plate", imageUrl: "/director-media/apt.png", inherit: "Brick walls, big window" },
  { kind: "location", view: "plate", subject: "The Street", name: "The Street — plate", imageUrl: "/director-media/street.png", inherit: "" },
  { kind: "location", view: "plate", subject: "The Skate Spot", name: "The Skate Spot — plate", imageUrl: "/director-media/spot.png", inherit: "" },
];
const VOICES = [
  { name: "Leo", url: "/director-media/voice-leo.mp3", seconds: 4 },
  { name: "Sal", url: "/director-media/voice-sal.mp3", seconds: 4 },
];
// The film-wide direction the writer gave film-1fd51691: a narrated journey.
const JOURNEY = {
  environment: "Daylight, vibrant New York City. The film moves from the soft light of a Brooklyn apartment to the harsh daylight of a busy street and a smooth concrete skate spot.",
  camera: "Handheld and intimate. Starts static in the apartment, moving to tracking shots in the street, settling at the skate spot.",
  sound: "Naturalistic. A quiet apartment, then the roar of a street, then skateboard wheels mixed with vendor calls.",
};
const CONSTANT = { environment: "Autumn, late afternoon.", camera: "Handheld, kinetic, intimate.", sound: "Naturalistic and close." };

/** Segment 3 of that film: Leo and Sal at the skate spot; only Sal has a line. */
const SETBACK = {
  index: 2, dur: 15, title: "The Setback", goal: "Leo fails at the skate spot but decides to try again.",
  location: "The Skate Spot", characters: ["Leo", "Sal"],
  stages: [
    { name: "The Fall", seconds: 7, initial: "Leo approaches a concrete ledge.", event: "Leo hits the ledge and slams into the concrete.", camera: "Medium shot.",
      audio: 'The crack of impact. Sal calls out in a loud, cheerful voice: "Hot dogs! Two for one!"', end: "Leo sits on the ground; Sal works nearby." },
    { name: "The Resolve", seconds: 8, initial: "Leo sits on the ground.", event: "Leo wipes his knee and stands.", camera: "Close-up.",
      audio: "The scrape of the board.", end: "Leo stands at the base of the ledge." },
  ],
};
const PREVIOUS = { ...SETBACK, index: 1, title: "The Surge", location: "The Street", characters: ["Leo"] };

describe("direction.js — the direction one segment is prompted with", () => {
  it("names a place by the significant words of its name", () => {
    expect(placeWords("Leo's Apartment")).toEqual(["leo", "apartment"]);
    expect(placeWords("The Skate Spot")).toEqual(["skate", "spot"]);
    expect(namesOtherPlace(JOURNEY.environment, "The Skate Spot", ["Leo's Apartment", "The Street", "The Skate Spot"])).toBe(true);
    expect(namesOtherPlace("A smooth concrete skate spot under hard light.", "The Skate Spot", ["Leo's Apartment", "The Street", "The Skate Spot"])).toBe(false);
    // A word shared with the segment's own place never counts against it; a word only the other place has does.
    expect(namesOtherPlace("A skate trick lands.", "The Skate Spot", ["The Skate Shop", "The Skate Spot"])).toBe(false);
    expect(namesOtherPlace("The skate shop is closed.", "The Skate Spot", ["The Skate Shop", "The Skate Spot"])).toBe(true);
  });

  it("drops a film-wide field that names another place and keeps a constant one", () => {
    const dropped = segmentDirection(SETBACK, JOURNEY, REFS);
    expect(dropped).toEqual({ environment: "", camera: "", sound: "" });
    expect(segmentDirection(SETBACK, CONSTANT, REFS)).toEqual(CONSTANT);
  });

  it("prefers the segment's own environment and sound", () => {
    const own = { ...SETBACK, environment: "Hard noon light on concrete.", sound: "Wheels, a grill hissing." };
    const d = segmentDirection(own, CONSTANT, REFS);
    expect(d.environment).toBe("Hard noon light on concrete.");
    expect(d.sound).toBe("Wheels, a grill hissing.");
    expect(d.camera).toBe(CONSTANT.camera);
  });
});

describe("lines.js — who has a line", () => {
  it("reads speakers out of quoted audio prose, and out of H3's lines", () => {
    expect(segmentSpeakers(SETBACK)).toEqual(["Sal"]);
    const lines = { ...SETBACK, stages: [{ ...SETBACK.stages[0], audio: "The crack of impact.", lines: [{ speaker: "leo", delivery: "quiet", text: "Ow." }] }] };
    expect(segmentSpeakers(lines)).toEqual(["Leo"]);
    expect(stageLines(SETBACK.stages[0], ["Leo", "Sal"])).toEqual([{ speaker: "Sal", delivery: "in a loud cheerful voice", text: "Hot dogs! Two for one!" }]);
  });
});

describe("the Seedance compiler", () => {
  const opts = { refs: REFS, look: LOOK, direction: JOURNEY, total: 4, voices: VOICES, previous: PREVIOUS };

  it("binds a voice only for a character who has a line in the segment", () => {
    const c = seedance(SETBACK, opts);
    expect(c.audioRefs.map((a) => a.name)).toEqual(["Sal"]);
    expect(c.prompt).toContain("@Audio1 defines Sal's voice");
    expect(c.prompt).toContain("Leo does not speak at all");
    const silent = seedance(PREVIOUS, { ...opts, previous: null });
    expect(silent.audioRefs).toEqual([]);
    expect(silent.prompt).toContain("Nobody speaks in this generation");
  });

  it("carries no title, a scope lock, and none of a journey-narrating direction", () => {
    const c = seedance(SETBACK, opts);
    expect(c.prompt).not.toMatch(/short film "/);
    expect(c.prompt).toContain("stays in The Skate Spot throughout");
    expect(c.prompt).not.toContain("apartment");
    expect(c.prompt).not.toContain("Environment:");
    const constant = seedance(SETBACK, { ...opts, direction: CONSTANT });
    expect(constant.prompt).toContain("Environment: Autumn, late afternoon.");
    expect(seedanceErrors({ ...c, index: 2, dur: 15 })).toEqual([]);
  });
});

describe("the H3 compiler — the seam is a still", () => {
  const opts = { refs: REFS, look: LOOK, direction: JOURNEY, total: 4, voices: VOICES, previous: PREVIOUS };

  it("binds the previous segment's last frame as one more image, after the plate, and no Video 1", () => {
    const c = h3(SETBACK, opts);
    expect(c.hasFrame).toBe(true);
    expect(c.hasVideo).toBe(false);
    expect(c.imageRefs.map((r) => `${r.token}=${r.name}`)).toEqual([
      "Image 1=Leo — turnaround", "Image 2=Leo — face", "Image 3=Sal — turnaround", "Image 4=Sal — face",
      "Image 5=The Skate Spot — plate", "Image 6=Previous shot — last frame",
    ]);
    expect(c.imageRefs[5]).toMatchObject({ seam: true, imageUrl: null });
    expect(c.prompt).toContain("Image 6 is the exact last frame of the previous shot");
    expect(c.prompt).toContain("The shot begins on Image 6 exactly");
    expect(c.prompt).not.toContain("Video 1");
    expect(c.prompt).not.toContain("video continuation");
    expect(h3Errors({ ...c, index: 2, dur: 15 })).toEqual([]);
  });

  it("keeps Video 1 only as the fallback seam, and no seam at all for the first segment or in no-video mode", () => {
    const video = h3(SETBACK, { ...opts, seam: "video" });
    expect(video.hasVideo).toBe(true);
    expect(video.hasFrame).toBe(false);
    expect(video.imageRefs.some((r) => r.seam)).toBe(false);
    expect(video.prompt).toContain("<Video 1> is the last 3 seconds");
    expect(h3Errors({ ...video, index: 2, dur: 15 })).toEqual([]);
    const first = h3({ ...SETBACK, index: 0 }, { ...opts, previous: null });
    expect(first.hasFrame).toBe(false);
    expect(first.imageRefs.some((r) => r.seam)).toBe(false);
    const words = h3(SETBACK, { ...opts, mode: "no-video" });
    expect(words.hasFrame).toBe(false);
    expect(words.prompt).toContain("opens on the moment the previous shot ended");
  });

  it("keeps the plate and the seam when the cast would overflow the images", () => {
    const crowd = { ...SETBACK, characters: ["Leo", "Sal", "Leo", "Sal", "Leo"] };
    const reg = segmentRegistry(crowd, REFS, { people: true, maxImages: 4, seam: true });
    expect(reg.map((r) => r.ref.view)).toEqual(["body", "face", "plate", "frame"]);
  });

  it("drops a journey-narrating direction and binds a voice only for who speaks", () => {
    const c = h3(SETBACK, opts);
    expect(c.prompt).not.toContain("apartment");
    expect(c.audioRefs.map((a) => a.name)).toEqual(["Sal"]);
    const own = h3({ ...SETBACK, environment: "Hard noon light on concrete.", sound: "A grill hissing." }, opts);
    expect(own.prompt).toContain("Hard noon light on concrete.");
    expect(own.prompt).toContain("A grill hissing.");
  });

  it("fills the frame's URL at submit time and sends no reference video for it", () => {
    const c = h3(SETBACK, opts);
    const env = { WORKER_PUBLIC_URL: "https://x.test" };
    const input = segmentInput(env, "p1", c, { h3Resolution: "480P", aspectRatio: "16:9", frameUrl: "https://x.test/files/frame.jpg", tailUrl: "https://x.test/files/tail.mp4" });
    expect(input.reference_image_urls.at(-1)).toBe("https://x.test/files/frame.jpg");
    expect(input.reference_image_urls).toHaveLength(6);
    expect(input.reference_video_urls).toBeUndefined();
    expect(input.reference_audio_urls).toHaveLength(1);
    const video = h3(SETBACK, { ...opts, seam: "video" });
    const vin = segmentInput(env, "p1", video, { h3Resolution: "480P", aspectRatio: "16:9", frameUrl: null, tailUrl: "https://x.test/files/tail.mp4" });
    expect(vin.reference_video_urls).toEqual(["https://x.test/files/tail.mp4"]);
  });
});

describe("the box cut", () => {
  it("cuts the last frame beside the tail when asked, and neither for the last segment", () => {
    const env = { WORKER_PUBLIC_URL: "https://x.test", INGEST_TOKEN: "t" };
    const both = cutScript(env, { sourceUrl: "https://fal.test/seg.mp4", clipKey: "media/p1/director/seg.mp4", tailKey: "media/p1/director/tail.mp4", frameKey: "media/p1/director/last.jpg" });
    expect(both).toMatch(/-sseof -1 -i \S+clip\.mp4 -an -update 1 -q:v 2 \S+frame\.jpg/);
    expect(both).toContain("upload_r2 ");
    expect(both).toContain("'media/p1/director/last.jpg'");
    expect(both).toContain("'media/p1/director/tail.mp4'");
    const last = cutScript(env, { sourceUrl: "https://fal.test/seg.mp4", clipKey: "media/p1/director/seg.mp4", tailKey: null, frameKey: null });
    expect(last).not.toContain("frame.jpg");
    expect(last).not.toContain("tail.mp4");
  });
});
