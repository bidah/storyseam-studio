// Link a Film's drawn sheets onto its World, so the Bible (/world) shows the
// cast, the places and the props with their pictures.
//
// The sheets stages file every sheet on the Film's Director Series
// (`/director-media/…`), which is what the video run binds — but the World's
// `sheetImage` slots are LIBRARY images (`rel` under `media/<pid>/asset/`):
// that is what the Bible renders, what pack.js checks for `available`, and
// what the author can swap from the MediaPicker. So each sheet is copied into
// the library under FILM_SHEETS_DIR and linked by name (routes/world.js
// `linkWorldSheets`). A failure here never fails the stage: the Film renders
// from the Series either way.
import { mediaKey } from "../media.js";
import { FILM_SHEETS_DIR, linkWorldSheets } from "../../routes/world.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "sheet";

/** `/director-media/<file>` → `<file>`, or null for anything else. */
const directorFile = (url) => {
  const m = /^\/director-media\/(.+)$/.exec(str(url));
  return m ? decodeURIComponent(m[1]) : null;
};

/**
 * Copy one Director sheet into the project library. → { rel, url, thumb, name } | null
 */
export async function copySheetToLibrary(env, pid, imageUrl, name) {
  const file = directorFile(imageUrl);
  if (!file || !env?.BUCKET) return null;
  const obj = await env.BUCKET.get(mediaKey(pid, "director", file));
  if (!obj) return null;
  const ext = (/\.([a-z0-9]+)$/i.exec(file) || [, "png"])[1].toLowerCase();
  const rel = `${FILM_SHEETS_DIR}/${slug(name)}.${ext}`;
  await env.BUCKET.put(mediaKey(pid, "asset", rel), obj.body, {
    httpMetadata: { contentType: obj.httpMetadata?.contentType || "image/png" },
  });
  return { rel, url: `/asset/${rel}`, thumb: `/thumb/${rel}`, name: str(name) || rel };
}

/**
 * sheets = [{ kind: "character"|"location"|"prop", subject, field, name, imageUrl }]
 * → the number of World slots linked (0 when nothing could be).
 */
export async function linkSheetsToWorld(env, pid, sheets) {
  try {
    const links = [];
    for (const s of sheets || []) {
      if (!s?.imageUrl || !["character", "location", "prop"].includes(s.kind)) continue;
      const image = await copySheetToLibrary(env, pid, s.imageUrl, s.name || s.subject);
      if (image) links.push({ kind: s.kind, name: s.subject, field: s.field || "sheetImage", image });
    }
    return await linkWorldSheets(env, pid, links);
  } catch (err) {
    console.warn(`[film] linking sheets onto the World failed: ${err?.message || err}`);
    return 0;
  }
}
