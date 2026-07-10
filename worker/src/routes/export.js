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
    //    computes the required CRC32). Pipe through a TransformStream so nothing
    //    buffers on either side.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const zip = new Zip((err, chunk, final) => {
      if (err) { writer.abort(err); return; }
      writer.write(chunk);
      if (final) writer.close();
    });

    const addText = (name, text) => {
      const f = new ZipPassThrough(name);
      zip.add(f);
      f.push(new TextEncoder().encode(text), true);
    };

    // Fill the zip asynchronously; MUST NOT be awaited before returning the
    // Response (that would buffer the whole archive). Entries are added strictly
    // one after another — a zip's layout requires sequential entries.
    const fill = (async () => {
      addText("project.fcpxml", xml);
      addText("README.txt", README);
      for (const { key, zipName } of resolved) {
        const obj = await c.env.BUCKET.get(key);
        const f = new ZipPassThrough(`media/${zipName}`);
        zip.add(f);
        if (obj && obj.body) {
          const reader = obj.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            f.push(value);
          }
        }
        f.push(new Uint8Array(0), true); // finalize this entry
      }
      zip.end();
    })();
    c.executionCtx.waitUntil(fill.catch((e) => { try { writer.abort(e); } catch { /* ignore */ } }));

    const zipFilename = `shot-studio-${zipSlug(timeline)}-resolve.zip`;
    return new Response(readable, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${zipFilename}"`,
        "cache-control": "no-store",
      },
    });
  });
}
