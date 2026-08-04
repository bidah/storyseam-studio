// The EditorBackend contract — the CLIENT "connector" seam. This is a faithful
// copy of web-editor/src/providers/storage's public contract so the mobile
// editor talks to backends through the SAME interface (swap one impl to retarget
// at the Cloudflare Worker, a local store, or anything else). The ONE native
// addition is `resolveSource`, which turns a model `src` string into an
// `expo-video` VideoSource (the web builds a URL string instead).
// Web reference: /docs/connectors/storage-client ↔ this: /docs/react-native/storage
import type { VideoSource } from "expo-video";
import type { Timeline } from "@/editor/core/timeline";

export interface PoolItem {
  id: string;
  mediaType: "video" | "audio";
  name: string;
  src: string;
  /** Natural length in seconds, when known (drives the added clip's duration). */
  durationSec?: number;
  bundle?: string;
}

export interface Pool {
  video: PoolItem[];
  audio: PoolItem[];
}

export interface Still {
  id: string;
  src: string;
  name?: string;
}

export interface RenderResult {
  ok: boolean;
  jobId?: string;
  url?: string;
  error?: string;
}

export interface EditorBackend {
  loadTimeline(): Promise<{ timeline: Timeline; cuts: unknown[] }>;
  saveTimeline(timeline: Timeline): Promise<{ ok: boolean; timeline: Timeline }>;
  loadCut(v: number): Promise<{ timeline: Timeline }>;
  /**
   * Replace the working timeline with an EMPTY one — the "New project" path,
   * the only way into the editor that isn't derived from a cut, a radio pass or
   * an animatic. The edit gets built from the media pool instead.
   */
  newProject(name?: string): Promise<{ timeline: Timeline }>;
  loadPool(): Promise<Pool>;
  uploadMedia(file: { uri: string; name?: string; mediaType?: "video" | "audio" }): Promise<PoolItem>;
  listStills(): Promise<Still[]>;
  grabStill(image: string, meta?: Record<string, unknown>): Promise<Still>;
  deleteStill(id: string): Promise<void>;
  render(options?: Record<string, unknown>): Promise<RenderResult>;
  pollRender(jobId: string): Promise<{ status: string; url?: string; error?: string }>;
  exportResolveUrl(): string;
  /** Web returns a URL string; kept for parity. */
  mediaUrl(src: string): string;
  previewUrl(src: string): string;
  /** NATIVE: resolve a model `src` into an expo-video source (require() / uri). */
  resolveSource(src: string): VideoSource;
  subscribeTimeline(onForeignEdit: () => void): () => void;
  /**
   * Write this timeline's realized pacing back to the Shot list's `dur` values,
   * so the animatic and the episode video generation inherit it. Only
   * meaningful on a radio/animatic timeline, and only offered by a backend that
   * has a Shot list at all — the offline demo backend leaves it undefined, and
   * the Editor hides the control when it's missing.
   */
  commitPacing?(): Promise<{ source: string; updated: number; untouched: number }>;
}
