// Cuts-backed EditorBackend — the PRODUCTION transport that wires the ported
// mobile editor to the shared Cloudflare Worker. Same EditorBackend contract as
// the offline demo backend (local.ts); different transport. It loads the
// frame-based Timeline the Worker builds from a "complete cut" and autosaves
// edits back. The web editor (src/routes/editor.jsx) talks to the SAME HTTP API
// (GET/POST /api/timeline, POST /api/timeline/from-cut, GET /api/pool), so the
// two editors stay in lock-step on one timeline document.
//
// The one seam the app rewires when opening the editor: pass { fromCutV } to
// build a fresh timeline from a specific cut version (Cuts tab → "Open in
// editor"); omit it to resume whatever timeline is currently saved.
import type { VideoSource } from "expo-video";
import {
  apiFetch,
  apiJson,
  deleteJson,
  mediaUrl,
  postJson,
  toPreviewSrc,
  uploadFile,
} from "@/lib/api";
import { CLIENT_ID } from "@/lib/client-id";
import { emptyTimeline, type Timeline } from "@/editor/core/timeline";
import type { EditorBackend, Pool, PoolItem, Still } from "./types";

// The Worker's /api/pool video items are shot mp4s without a natural length;
// addPoolClip needs *some* duration for a tapped-in clip. 4s ≈ a typical shot.
const DEFAULT_POOL_DURATION_SEC = 4;

type PoolRaw = { id: string; name?: string; src: string; bundle?: string; durationSec?: number };
type PoolResponse = { video?: PoolRaw[]; audio?: PoolRaw[] };

export function createCutsBackend(opts: { fromCutV?: number } = {}): EditorBackend {
  const { fromCutV } = opts;

  const toItem = (raw: PoolRaw, mediaType: "video" | "audio"): PoolItem => ({
    id: raw.id,
    mediaType,
    name: raw.name || raw.id,
    src: raw.src,
    durationSec: raw.durationSec ?? DEFAULT_POOL_DURATION_SEC,
    bundle: raw.bundle,
  });

  return {
    async loadTimeline() {
      // Opening on a specific cut version → build a fresh timeline from it
      // server-side. POST /api/timeline/from-cut saves it as THE editor timeline
      // and returns it. Otherwise resume whatever timeline is currently saved.
      if (fromCutV != null) {
        const res = await postJson<{ ok: boolean; timeline: Timeline }>("/api/timeline/from-cut", {
          v: fromCutV,
          clientId: CLIENT_ID,
        });
        return { timeline: res.timeline || emptyTimeline(), cuts: [] };
      }
      const res = await apiJson<{ timeline: Timeline | null; cuts?: unknown[] }>("/api/timeline");
      return { timeline: res.timeline || emptyTimeline(), cuts: res.cuts || [] };
    },

    async saveTimeline(timeline) {
      const res = await postJson<{ ok: boolean; timeline: Timeline }>("/api/timeline", {
        timeline,
        clientId: CLIENT_ID,
      });
      return { ok: !!res.ok, timeline: res.timeline || timeline };
    },

    async loadCut(v) {
      const res = await postJson<{ ok: boolean; timeline: Timeline }>("/api/timeline/from-cut", {
        v,
        clientId: CLIENT_ID,
      });
      return { timeline: res.timeline || emptyTimeline() };
    },

    async loadPool() {
      const res = await apiJson<PoolResponse>("/api/pool");
      return {
        video: (res.video || []).map((v) => toItem(v, "video")),
        audio: (res.audio || []).map((a) => toItem(a, "audio")),
      } satisfies Pool;
    },

    async uploadMedia(file) {
      const name = file.name || "clip";
      const mime = file.mediaType === "audio" ? "audio/mp4" : "video/mp4";
      const up = await uploadFile(file.uri, name, mime);
      return {
        id: up.key || up.url,
        mediaType: file.mediaType || "video",
        name,
        src: up.url,
      };
    },

    async listStills() {
      try {
        const res = await apiJson<{ stills?: Still[] }>("/api/stills");
        return res.stills || [];
      } catch {
        return [];
      }
    },
    async grabStill(image, meta) {
      const res = await postJson<{ still: Still }>("/api/stills", { image, meta });
      return res.still;
    },
    async deleteStill(id) {
      await deleteJson(`/api/stills/${encodeURIComponent(id)}`);
    },

    async render() {
      // On mobile, rendering/export is dispatched THROUGH the agent chat (like
      // stitch / score on the Cuts tab), not a direct Worker call.
      return { ok: false, error: "Export runs through the agent chat on mobile." };
    },
    async pollRender() {
      return { status: "error", error: "not-implemented" };
    },
    exportResolveUrl() {
      return "";
    },

    mediaUrl(src) {
      return mediaUrl(src) || src;
    },
    previewUrl(src) {
      return mediaUrl(toPreviewSrc(src)) || src;
    },
    // expo-video plays the 720p proxy (lighter than full-res /gen mp4s). mediaUrl
    // injects ?projectId= because native players can't send headers. Local/picked
    // uris (file/content/asset) pass straight through.
    resolveSource(src): VideoSource {
      if (/^(file|content|asset):/.test(src)) return { uri: src };
      const url = mediaUrl(toPreviewSrc(src));
      return { uri: url || src };
    },

    subscribeTimeline(onForeignEdit) {
      // Live-sync: the web editor or the agent's /api/timeline/edit ops may
      // replace the saved timeline. The fetch shim routes /api/timeline/events
      // through expo/fetch (streaming), so hand-parse the SSE frames and fire
      // onForeignEdit for edits that aren't ours (echo-suppressed by clientId).
      let disposed = false;
      const controller = new AbortController();
      (async () => {
        try {
          const res = await apiFetch("/api/timeline/events", {
            headers: { accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) return;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n\n")) !== -1) {
              const frame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const data = frame
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .join("\n");
              if (!data) continue;
              try {
                const evt = JSON.parse(data);
                if (!disposed && evt?.clientId !== CLIENT_ID) onForeignEdit();
              } catch {
                /* heartbeat / malformed frame */
              }
            }
          }
        } catch {
          /* aborted or network drop — editor keeps its local state */
        }
      })();
      return () => {
        disposed = true;
        controller.abort();
      };
    },
  };
}
