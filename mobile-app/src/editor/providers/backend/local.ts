// Local in-memory backend — the reference EditorBackend impl for running the
// editor fully offline on-device (no server), used for the demo/tests. It is the
// native analogue of web-editor/src/providers/storage/cloudflare.js: same
// contract, different transport. A production app swaps this for an impl that
// calls the shared Cloudflare Worker (the exact same HTTP API the web editor
// uses) — nothing else in the editor changes.
// Web reference: /docs/connectors/storage-client ↔ this: /docs/react-native/storage
import type { VideoSource } from "expo-video";
import { FPS, type Timeline } from "@/editor/core/timeline";
import type { EditorBackend, Pool, PoolItem, Still } from "./types";

// Bundled sample assets. `require()` paths must be static literals for Metro.
const ASSETS: Record<string, number> = {
  "media/clip-sunset.mp4": require("../../../../assets/media/clip-sunset.mp4"),
  "media/clip-ocean.mp4": require("../../../../assets/media/clip-ocean.mp4"),
  "media/clip-forest.mp4": require("../../../../assets/media/clip-forest.mp4"),
  "media/music-bed.m4a": require("../../../../assets/media/music-bed.m4a"),
};

const POOL: Pool = {
  video: [
    { id: "p-sunset", mediaType: "video", name: "Sunset", src: "media/clip-sunset.mp4", durationSec: 6 },
    { id: "p-ocean", mediaType: "video", name: "Ocean", src: "media/clip-ocean.mp4", durationSec: 5 },
    { id: "p-forest", mediaType: "video", name: "Forest", src: "media/clip-forest.mp4", durationSec: 7 },
  ],
  audio: [
    { id: "p-music", mediaType: "audio", name: "Music bed", src: "media/music-bed.m4a", durationSec: 12 },
  ],
};

// A starter cut so the editor opens on something playable (two clips + a bed).
function starterTimeline(): Timeline {
  return {
    fps: FPS,
    width: 1280,
    height: 720,
    tracks: [
      {
        id: "video",
        name: "Video",
        type: "video",
        items: [
          {
            id: "c1",
            src: "media/clip-sunset.mp4",
            name: "Sunset",
            from: 0,
            durationInFrames: 6 * FPS,
            sourceDurationInFrames: 6 * FPS,
            volume: 1,
          },
          {
            id: "c2",
            src: "media/clip-ocean.mp4",
            name: "Ocean",
            from: 6 * FPS,
            durationInFrames: 5 * FPS,
            sourceDurationInFrames: 5 * FPS,
            volume: 1,
          },
        ],
      },
      {
        id: "music",
        name: "Music",
        type: "audio",
        items: [
          {
            id: "m1",
            src: "media/music-bed.m4a",
            name: "Music bed",
            from: 0,
            durationInFrames: 11 * FPS,
            sourceDurationInFrames: 12 * FPS,
            volume: 0.4,
            fadeInFrames: 12,
            fadeOutFrames: 24,
          },
        ],
      },
    ],
  };
}

export function createLocalBackend(): EditorBackend {
  let saved: Timeline = starterTimeline();
  const stills: Still[] = [];
  let uploadSeq = 0;

  return {
    async loadTimeline() {
      return { timeline: saved, cuts: [] };
    },
    async saveTimeline(timeline) {
      saved = timeline;
      return { ok: true, timeline };
    },
    async loadCut() {
      return { timeline: saved };
    },
    async loadPool() {
      return POOL;
    },
    async uploadMedia(file) {
      // On-device import: register the picked file uri under a fresh key so
      // resolveSource can return {uri}. (A real backend would upload to R2.)
      const id = `u-${++uploadSeq}`;
      const key = file.uri;
      const item: PoolItem = {
        id,
        mediaType: file.mediaType || "video",
        name: file.name || `Clip ${uploadSeq}`,
        src: key,
      };
      (file.mediaType === "audio" ? POOL.audio : POOL.video).push(item);
      return item;
    },
    async listStills() {
      return stills;
    },
    async grabStill(image, meta) {
      const still: Still = { id: `s-${stills.length + 1}`, src: image, name: String(meta?.name || "Still") };
      stills.push(still);
      return still;
    },
    async deleteStill(id) {
      const i = stills.findIndex((s) => s.id === id);
      if (i >= 0) stills.splice(i, 1);
    },
    async render() {
      // No local renderer; a real backend proxies to the shared Worker /api/render.
      return { ok: false, error: "Rendering requires a server backend (see /docs/connectors/render)." };
    },
    async pollRender() {
      return { status: "error", error: "not-implemented" };
    },
    exportResolveUrl() {
      return "";
    },
    mediaUrl(src) {
      return src;
    },
    previewUrl(src) {
      return src;
    },
    resolveSource(src): VideoSource {
      if (ASSETS[src] != null) return ASSETS[src];
      if (/^(file|https?|content|asset):/.test(src)) return { uri: src };
      return { uri: src };
    },
    subscribeTimeline() {
      // No live multi-client sync in the local backend.
      return () => {};
    },
  };
}
