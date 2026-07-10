// "Export for Resolve" — GET /api/export/resolve streams a ZIP containing an
// FCPXML 1.9 timeline + all referenced media, so a user can unzip it anywhere and
// import the cut into DaVinci Resolve (File → Import → Timeline → project.fcpxml)
// with media relinking by relative path (./media/<file>).
//
// GET (not POST) so a plain <a href download> can trigger it and the browser
// streams the ZIP straight to disk — no in-memory blob on either side. The UI
// saves the live timeline first, so the saved db.editorTimeline is authoritative.
//
// See docs/davinci-resolve-export.md for the full spec. Mirrors registerRender's
// timeline-read + 400 shape (worker/src/routes/render.js).

import { readDoc } from "../lib/docs.js";
import { kindForPrefix, mediaKey } from "../lib/media.js";
import { timelineToFcpxml } from "../lib/fcpxml.js";
import { Zip, ZipPassThrough } from "fflate";

const MAX_ZIP_BYTES = 3.8 * 1024 * 1024 * 1024; // fflate has no Zip64 (~4 GB ceiling)

const README = `Shot Studio → DaVinci Resolve export
====================================

1. Unzip this archive anywhere (keep project.fcpxml next to the media folder).
2. In DaVinci Resolve, open your project, then:
   File → Import → Timeline… → select project.fcpxml
3. Resolve links the clips via the relative paths in the XML. If any clip
   shows as offline (red), right-click it in the Media Pool →
   "Relink Selected Clips…" → point it at the media folder from this zip.

Notes
- The timeline is 24 fps, 1280×720. Set your Resolve project to match
  (or let Resolve create the timeline with these settings on import).
- Audio fades and clip volumes from the Shot Studio editor are carried over.
`;

// Derive a human project name for the FCPXML <project> from the cut it came from.
function projectNameFor(timeline) {
  const s = timeline?.source;
  if (s && s.kind) return `shot-studio ${s.kind} v${s.v}`;
  return "shot-studio timeline";
}

// slug for the download filename (mirrors render.js sanitize).
function zipSlug(timeline) {
  const s = timeline?.source;
  const raw = s && s.kind ? `${s.kind}-v${s.v}` : "timeline";
  return String(raw).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function registerExport(app) {
  app.get("/api/export/resolve", async (c) => {
    const pid = c.get("projectId");
    const db = await readDoc(c.env, pid, "selections", {});
    const timeline = db.editorTimeline;
    if (!timeline || !Array.isArray(timeline.tracks)) {
      return c.json({ error: "No timeline to export — load a cut into the editor first" }, 400);
    }

    // 1. Generate XML + media manifest (pure).
    const { xml, media } = timelineToFcpxml(timeline, { projectName: projectNameFor(timeline) });
    if (!media.length) {
      return c.json({ error: "Timeline is empty — nothing to export" }, 400);
    }

    // 2. Resolve each manifest src → R2 key, HEAD-check existence up front.
    const missing = [];
    const resolved = []; // { zipName, key, head }
    for (const { src, zipName } of media) {
      const m = /^\/([^/]+)\/(.+)$/.exec(src);
      const kind = m && kindForPrefix(m[1]);
      if (!kind) { missing.push(zipName); continue; }
      const key = mediaKey(pid, kind, decodeURIComponent(m[2]));
      resolved.push({ zipName, key });
    }
    const heads = await Promise.all(
      resolved.map((r) => c.env.BUCKET.head(r.key).catch(() => null)),
    );
    let totalBytes = 0;
    resolved.forEach((r, i) => {
      const h = heads[i];
      if (!h) missing.push(r.zipName);
      else totalBytes += h.size || 0;
    });
    if (missing.length) {
      return c.json({ error: `Missing media: ${missing.join(", ")}` }, 400);
    }
    if (totalBytes > MAX_ZIP_BYTES) {
      const gb = (totalBytes / 1024 / 1024 / 1024).toFixed(1);
      return c.json({ error: `Export too large for zip (${gb}GB) — trim the timeline` }, 400);
    }

    // 3. Stream a STORE-only zip (media is already compressed; fflate still
    //    computes the required CRC32) via a PULL-based ReadableStream.
    //
    // Architecture note (this is the crux): the producer — reading R2 objects and
    // feeding them to fflate — MUST run inside the ReadableStream's `pull()`, not
    // in a side promise handed to `ctx.waitUntil`. Two Workers-platform reasons:
    //   • `waitUntil` work is capped (~30s after the response). A large archive
    //     streamed to a distant/slow client takes longer than that, so a waitUntil
    //     producer gets killed mid-stream and the central directory (emitted last
    //     by zip.end()) never lands → a truncated, corrupt zip. Driving the work
    //     from `pull` ties it to the response body's own lifetime, which has no
    //     such cap while the client keeps reading.
    //   • I/O (R2 reads) performed in `pull` runs "on behalf of" the response, so
    //     it stays legal after the handler returns.
    // Backpressure is automatic: `pull` is only invoked when the consumer wants
    // more, so nothing buffers — memory stays flat regardless of archive size.
    //
    // fflate is push-based (it emits chunks through a callback); we bridge push→pull
    // with a small `outbox` queue that `pull` drains one chunk at a time, advancing
    // the producer only when the outbox runs dry.
    const zipFilename = `shot-studio-${zipSlug(timeline)}-resolve.zip`;

    const outbox = [];          // chunks emitted by fflate, awaiting enqueue
    let finalSeen = false;      // fflate signalled the last chunk (central dir)
    let zipErr = null;
    const zip = new Zip((err, chunk, final) => {
      if (err) { zipErr = err; return; }
      if (chunk && chunk.length) outbox.push(chunk);
      if (final) finalSeen = true;
    });

    const addText = (name, text) => {
      const f = new ZipPassThrough(name);
      zip.add(f);
      f.push(new TextEncoder().encode(text), true);
    };

    // Producer state, advanced one unit at a time by step().
    let idx = 0;                // index into `resolved`
    let current = null;         // { f, reader } for the entry in progress
    let ended = false;          // zip.end() has been called
    addText("project.fcpxml", xml);
    addText("README.txt", README);

    // One unit of producer work; returns false once everything (incl. zip.end)
    // has been emitted. Each call pushes at most one media chunk into fflate.
    const step = async () => {
      if (idx >= resolved.length) {
        if (!ended) { ended = true; zip.end(); }
        return false;
      }
      if (!current) {
        const { key, zipName } = resolved[idx];
        const obj = await c.env.BUCKET.get(key);
        const f = new ZipPassThrough(`media/${zipName}`);
        zip.add(f);
        const reader = obj && obj.body ? obj.body.getReader() : null;
        if (!reader) { f.push(new Uint8Array(0), true); idx++; return true; }
        current = { f, reader };
      }
      const { done, value } = await current.reader.read();
      if (done) { current.f.push(new Uint8Array(0), true); current = null; idx++; return true; }
      current.f.push(value); // fflate emits the STORE'd chunk into `outbox`
      return true;
    };

    const body = new ReadableStream({
      async pull(controller) {
        try {
          // Advance the producer until there's a chunk to emit (or we're done).
          while (outbox.length === 0 && !finalSeen) {
            if (zipErr) throw zipErr;
            await step();
          }
          if (zipErr) throw zipErr;
          if (outbox.length) controller.enqueue(outbox.shift());
          if (outbox.length === 0 && finalSeen) controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
      cancel() { try { current?.reader?.cancel(); } catch { /* ignore */ } },
    });

    return new Response(body, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${zipFilename}"`,
        "cache-control": "no-store",
      },
    });
  });
}
