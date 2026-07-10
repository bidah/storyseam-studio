// Standalone Vercel function: render the shot-studio editor's Remotion "Editor"
// composition on a Vercel Sandbox and store the result in Cloudflare R2.
//
// The Cloudflare Hono Worker (the new backend) can't run @remotion/bundler
// (webpack) or headless Chrome, so it POSTs the timeline here. We bundle the
// vendored composition (../remotion/RemotionRoot.jsx), render it detached on a
// Vercel Sandbox writing to Vercel Blob, poll to done, then copy the mp4 into
// R2 under `outputKey`. Returns { ok, url, bytes }.
//
// This mirrors the input contract of server/index.js's /api/render + reuses the
// renderVercel() flow from server/lib/remotion-render.js verbatim.
//
// Request  (POST application/json):
//   {
//     timeline: { tracks, fps, width, height },  // media srcs MUST be public URLs
//     codec?:   "h264" | "h265",                 // default h264
//     crf?:     number,                          // 1..51, default 18
//     scale?:   0.5 | 1 | 2,                     // default 1
//     compositionId?: string,                    // default "Editor"
//     outputKey: string                          // R2 object key for the mp4
//   }
// Response: { ok: true, url, bytes, blobUrl, backend, storage } | { ok:false, error }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { putToR2, r2Configured } from "../lib/r2.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Absolute path to the vendored Remotion entry point that gets bundled.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = path.join(__dirname, "..", "remotion", "RemotionRoot.jsx");

// Bundle once per warm lambda; cold starts re-bundle (a few seconds).
let _bundlePromise: Promise<string> | null = null;
function getBundle(): Promise<string> {
  if (!_bundlePromise) {
    _bundlePromise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({ entryPoint: ENTRY_POINT });
    })().catch((e) => {
      _bundlePromise = null;
      throw e;
    });
  }
  return _bundlePromise;
}

type RenderBody = {
  timeline?: { tracks?: unknown[]; fps?: number; width?: number; height?: number };
  codec?: string;
  crf?: number;
  scale?: number;
  compositionId?: string;
  outputKey?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Use POST" });
    return;
  }

  try {
    // Vercel parses JSON bodies automatically; tolerate a raw string too.
    const body: RenderBody =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const timeline = body.timeline;
    if (!timeline || !Array.isArray(timeline.tracks)) {
      res.status(400).json({ ok: false, error: "Missing timeline.tracks" });
      return;
    }
    const outputKey = String(body.outputKey || "").trim();
    if (!outputKey) {
      res.status(400).json({ ok: false, error: "Missing outputKey (R2 object key)" });
      return;
    }

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      res.status(500).json({
        ok: false,
        error: "BLOB_READ_WRITE_TOKEN is required (renders are staged in Vercel Blob)",
      });
      return;
    }

    // Same normalization as server/index.js's /api/render handler.
    const compositionId = String(body.compositionId || "Editor");
    const codec = body.codec === "h265" ? "h265" : "h264";
    const crf = Number.isFinite(+(body.crf as number))
      ? Math.min(51, Math.max(1, Math.round(+(body.crf as number))))
      : 18;
    const scale = [0.5, 1, 2].includes(+(body.scale as number)) ? +(body.scale as number) : 1;

    // NOTE: media srcs must already be PUBLIC absolute URLs — the Worker is
    // responsible for absolutizing /gen, /sound-media, … before POSTing (the
    // remote sandbox browser fetches them over the network). We pass tracks
    // through untouched.
    const inputProps = {
      tracks: timeline.tracks,
      fps: timeline.fps || 24,
      width: timeline.width || 1280,
      height: timeline.height || 720,
    };

    // --- Bundle + render on a Vercel Sandbox (reused from remotion-render.js) --
    const serveUrl = await getBundle();
    const { createSandbox, addBundleToSandbox, renderMediaOnVercel, getRenderProgress } =
      await import("@remotion/vercel");
    const { Sandbox } = await import("@vercel/sandbox");

    const sandbox = await createSandbox({
      onProgress: (p: any) =>
        process.stdout.write(`[vercel sandbox] ${p?.type || p?.stage || "…"}\n`),
    });

    let sandboxId: string | undefined;
    let blobUrl: string;
    try {
      await addBundleToSandbox({ sandbox, bundleDir: serveUrl });

      const started = await renderMediaOnVercel({
        sandbox,
        compositionId,
        inputProps,
        codec,
        crf,
        scale,
        detached: true,
        vercelBlob: { blobToken, access: "public" },
      });
      sandboxId = started.sandboxId;
      const { cmdId } = started;

      // Poll until the Blob upload finishes (or errors). Guard with a deadline.
      // NB: a serverless function must outlive this loop — see README (set a high
      // maxDuration / Fluid Compute, or split start/poll across two calls).
      const deadline = Date.now() + 30 * 60 * 1000; // 30 min
      let progress: any;
      for (;;) {
        progress = await getRenderProgress({ sandboxId, cmdId });
        if (progress.stage === "done") break;
        if (progress.stage === "error") throw new Error(`Remotion render failed: ${progress.message}`);
        if (progress.stage === "expired") throw new Error("Remotion render expired before completing");
        if (Date.now() > deadline) throw new Error("Remotion render timed out (30 min)");
        await sleep(2000);
      }
      blobUrl = progress.url;
    } finally {
      // Always stop the sandbox so it isn't billed idle.
      try {
        if (sandboxId) {
          await Sandbox.get({ sandboxId })
            .then((s: any) => s.stop())
            .catch(() => undefined);
        } else if (typeof (sandbox as any).stop === "function") {
          await (sandbox as any).stop().catch(() => undefined);
        }
      } catch {
        /* best effort */
      }
    }

    // --- Store the result --------------------------------------------------
    // If R2 is configured, copy Blob → R2 under outputKey and return the R2 URL.
    // Otherwise fall back to returning the Vercel Blob URL for the Worker to copy.
    const resp = await fetch(blobUrl);
    if (!resp.ok) {
      res.status(502).json({ ok: false, error: `Failed to fetch render from Blob (${resp.status})` });
      return;
    }
    const buf = Buffer.from(await resp.arrayBuffer());

    if (r2Configured()) {
      const url = await putToR2(outputKey, buf, "video/mp4");
      res.status(200).json({ ok: true, url, bytes: buf.length, blobUrl, backend: "vercel", storage: "r2" });
      return;
    }

    // R2 not configured here — hand the Blob URL back; the Worker copies it.
    res.status(200).json({
      ok: true,
      url: blobUrl,
      bytes: buf.length,
      blobUrl,
      backend: "vercel",
      storage: "blob",
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
