/**
 * Import a Director Series from another deployment into a Shot Studio project.
 *
 *   node scripts/import-series.mjs \
 *     --source https://…/api/series/<id>        (or a local .json)
 *     --assets /path/to/bundle                  (dir with manifest.tsv + assets/)
 *     --name "Mecha Launch" \
 *     --api https://storyseam.app
 *
 * Credential, one of two:
 *   SHOT_STUDIO_COOKIE  the Better Auth session cookie, copied from a signed-in
 *                       browser. This is the one to use against a real
 *                       deployment: the import is exactly what the author could
 *                       do by hand, so it needs exactly what the author has.
 *   SHOT_STUDIO_AGENT   a signed `x-flue-agent-user` assertion, the same
 *                       credential the flue agent's tools carry. Minted with the
 *                       deployment's FLUE_PROXY_SECRET — which is how this gets
 *                       verified against a local `wrangler dev` where there is
 *                       no browser to sign in with.
 * No ingest token, either way: the bytes go through `/api/upload`, the same
 * door a drag-and-drop uses.
 *
 * ── Why the assets are COPIED and not linked ────────────────────────────────
 * A Series points at pictures, and where those pictures live decides whether it
 * still plays next month. Of Mecha Launch's 36 assets, 22 sit on a provider CDN
 * — Higgsfield's and fal's. That is scratch space: a url there is a lease, not
 * an address. So every asset is pulled down, uploaded into THIS project, and
 * the row is rewritten to point at the copy. A Series imported by reference is
 * a Series that breaks quietly, one frame at a time, and looks like the model
 * drifting when it does.
 *
 * ── Why it resumes ─────────────────────────────────────────────────────────
 * Thirty-six uploads is enough that one will fail, and re-running from zero
 * would leave duplicates in the Library. Each completed step is written to
 * `<assets>/import-state.json`, keyed by the source url, so a second run picks
 * up where the first stopped and uploads nothing twice.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const SOURCE = arg("source");
const ASSETS = arg("assets");
const NAME = arg("name", "Imported Series");
const API = (arg("api", "http://localhost:8787") || "").replace(/\/+$/, "");
const FOLDER = arg("folder", "mecha-launch");
const DRY = has("dry-run");
const COOKIE = process.env.SHOT_STUDIO_COOKIE || "";
const AGENT = process.env.SHOT_STUDIO_AGENT || "";

if (!SOURCE || !ASSETS) {
  console.error("usage: import-series.mjs --source <url|file> --assets <dir> [--name N] [--api ORIGIN] [--dry-run]");
  process.exit(2);
}
if (!COOKIE && !AGENT && !DRY) {
  console.error(
    "A credential is required — one of:\n" +
      "  SHOT_STUDIO_COOKIE  sign in at the target, devtools → Application → Cookies,\n" +
      "                      and copy the whole cookie header.\n" +
      "  SHOT_STUDIO_AGENT   a signed agent assertion (see scripts/mint-agent-token.mjs).",
  );
  process.exit(2);
}

const STATE_FILE = path.join(ASSETS, "import-state.json");
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));

async function api(pathname, { method = "GET", body, headers = {}, raw } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      ...(COOKIE ? { cookie: COOKIE } : {}),
      ...(AGENT ? { "x-flue-agent-user": AGENT } : {}),
      ...(state.projectId ? { "x-project-id": state.projectId } : {}),
      ...(raw ? {} : body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status}: ${data.error || data.raw || text.slice(0, 200)}`);
  }
  return data;
}

// ── 1. The Series, live ─────────────────────────────────────────────────────
// Read from the source rather than from a snapshot beside it. A saved
// `*.series.json` goes stale within the hour, and a stale one has already cost
// an afternoon by reporting that a Series had no pinned frames when it had eight.
async function readSource() {
  if (/^https?:\/\//.test(SOURCE)) {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`source → ${res.status}`);
    const json = await res.json();
    return json.series ?? json;
  }
  const json = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  return json.series ?? json;
}

/** Every url the Series points at, in the order they are rewritten. */
function assetUrls(series) {
  const out = new Set();
  const add = (u) => { if (u && /^https?:\/\//.test(u)) out.add(u); };
  add(series.imageUrl);
  add(series.endImageUrl);
  add(series.audioUrl);
  for (const beat of series.directions || []) {
    add(beat.endImageUrl);
    add(beat.audioUrl);
    for (const r of beat.endImageRefs || []) add(r);
  }
  for (const sheet of series.modelSheets || []) {
    add(sheet.imageUrl);
    for (const r of sheet.refs || []) add(r);
  }
  for (const piece of series.audioPieces || []) add(piece.audioUrl);
  if (series.audioVersion) add(series.audioVersion.audioUrl);
  for (const v of series.pastAudioVersions || []) add(v.audioUrl);
  return [...out];
}

/** The row with every url swapped for the copy in this project. */
function rewrite(series, map) {
  const m = (u) => (u && map[u]) || u;
  const list = (a) => (Array.isArray(a) ? a.map(m) : a);
  return {
    ...series,
    imageUrl: m(series.imageUrl),
    endImageUrl: series.endImageUrl ? m(series.endImageUrl) : series.endImageUrl,
    audioUrl: series.audioUrl ? m(series.audioUrl) : series.audioUrl,
    directions: (series.directions || []).map((beat) => ({
      ...beat,
      endImageUrl: beat.endImageUrl ? m(beat.endImageUrl) : beat.endImageUrl,
      audioUrl: beat.audioUrl ? m(beat.audioUrl) : beat.audioUrl,
      endImageRefs: beat.endImageRefs ? list(beat.endImageRefs) : beat.endImageRefs,
    })),
    modelSheets: (series.modelSheets || []).map((sheet) => ({
      ...sheet,
      imageUrl: sheet.imageUrl ? m(sheet.imageUrl) : sheet.imageUrl,
      refs: list(sheet.refs || []),
    })),
    audioPieces: (series.audioPieces || []).map((p) => ({ ...p, audioUrl: p.audioUrl ? m(p.audioUrl) : p.audioUrl })),
    audioVersion: series.audioVersion
      ? { ...series.audioVersion, audioUrl: m(series.audioVersion.audioUrl) }
      : series.audioVersion,
    pastAudioVersions: (series.pastAudioVersions || []).map((v) => ({ ...v, audioUrl: m(v.audioUrl) })),
  };
}

/** A readable, collision-free name for the copy — `beat-042.png`, `sheet-kai.png`. */
function assetName(url, series, i) {
  const ext = (path.extname(new URL(url).pathname) || ".png").toLowerCase();
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  if (url === series.imageUrl) return `first-frame${ext}`;
  const beat = (series.directions || []).find((b) => b.endImageUrl === url);
  if (beat) return `beat-${String(beat.offset).padStart(3, "0")}${ext}`;
  const sheet = (series.modelSheets || []).find((s) => s.imageUrl === url);
  if (sheet) return `sheet-${sheet.kind}-${slug(sheet.name)}${ext}`;
  const piece = (series.audioPieces || []).find((p) => p.audioUrl === url);
  if (piece) return `audio-${slug(piece.name || piece.kind)}${ext}`;
  return `asset-${String(i).padStart(3, "0")}${ext}`;
}

async function main() {
  const source = await readSource();
  const urls = assetUrls(source);
  const beats = (source.directions || []).length;
  const pins = (source.directions || []).filter((b) => b.endImageUrl).length;

  console.log(`source   ${source.title}`);
  console.log(`         ${source.aspectRatio} · ${beats} beats · ${pins} pins · ${(source.modelSheets || []).length} sheets`);
  console.log(`assets   ${urls.length} to copy`);
  console.log(`target   ${API}  project "${NAME}"`);

  // The local bundle, keyed by source url.
  const manifest = Object.fromEntries(
    fs.readFileSync(path.join(ASSETS, "manifest.tsv"), "utf8")
      .split("\n").filter(Boolean)
      .map((line) => { const [file, url] = line.split(/\s+/, 2); return [url, file]; }),
  );
  const missing = urls.filter((u) => !manifest[u] || !fs.existsSync(path.join(ASSETS, "assets", manifest[u])));
  if (missing.length) {
    console.error(`\n${missing.length} assets are not in the bundle. Fetch them first:`);
    for (const u of missing.slice(0, 5)) console.error(`  ${u}`);
    process.exit(1);
  }

  if (DRY) {
    console.log("\n--dry-run: nothing written. The rewritten row would carry:");
    for (const u of urls.slice(0, 4)) console.log(`  ${assetName(u, source, 0).padEnd(28)} ← ${u.slice(0, 70)}`);
    console.log(`  … and ${Math.max(0, urls.length - 4)} more`);
    return;
  }

  // ── 2. The project ────────────────────────────────────────────────────────
  if (!state.projectId) {
    const { project } = await api("/api/projects", { method: "POST", body: { name: NAME } });
    state.projectId = project.id;
    save();
    console.log(`\nproject  ${project.id} created`);
  } else {
    console.log(`\nproject  ${state.projectId} (resumed)`);
  }

  // ── 3. The plugins this project needs ─────────────────────────────────────
  // Installed explicitly rather than left to seeding: these four are not
  // seedable, by design — no project predates them.
  if (!state.plugins) {
    const current = await api("/api/plugins");
    const want = new Set([...(current.enabled || []), "director", "stage", "shotsheet", "musicalized", "library"]);
    await api("/api/plugins", { method: "PUT", body: { enabled: [...want] } });
    state.plugins = [...want];
    save();
    console.log(`plugins  ${state.plugins.join(", ")}`);
  }

  // ── 4. The assets ─────────────────────────────────────────────────────────
  // Two hops, both session-authed: `/api/upload` parks the bytes, then
  // `/api/library/import` copies them into this project's Library — which is
  // also what puts them where the Images tab and `attach_character_sheet` can
  // reach them, rather than in a Director-only corner.
  state.assets = state.assets || {};
  let done = Object.keys(state.assets).length;
  for (const [i, url] of urls.entries()) {
    if (state.assets[url]) continue;
    const file = path.join(ASSETS, "assets", manifest[url]);
    const name = assetName(url, source, i);
    const bytes = fs.readFileSync(file);
    const type = name.endsWith(".mp4") ? "video/mp4"
      : name.endsWith(".mp3") ? "audio/mpeg"
      : name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg"
      : "image/png";

    const up = await api("/api/upload", {
      method: "POST", raw: true, body: bytes,
      headers: { "content-type": type, "x-filename": name },
    });
    const imported = await api("/api/library/import", {
      method: "POST", body: { key: up.key, folder: FOLDER, name },
    });
    state.assets[url] = imported.url; // `/asset/<folder>/<name>`
    save();
    done++;
    process.stdout.write(`\rassets   ${done}/${urls.length}  ${name.padEnd(34)}`);
  }
  console.log(`\rassets   ${done}/${urls.length} copied into /asset/${FOLDER}/` + " ".repeat(20));

  // ── 5. The Series ─────────────────────────────────────────────────────────
  const row = rewrite(source, state.assets);
  if (!state.seriesId) {
    const made = await api("/api/director/series", {
      method: "POST",
      body: {
        title: NAME,
        prompt: row.prompt,
        aspectRatio: row.aspectRatio,
        resolution: row.resolution,
        imageUrl: row.imageUrl,
      },
    });
    state.seriesId = made.series.id;
    save();
    console.log(`series   ${state.seriesId} created`);
  }

  // The rest as one patch. `status` last-ish: publishing needs the first frame,
  // which the create already set.
  const patch = {
    prompt: row.prompt,
    imageUrl: row.imageUrl,
    endImageUrl: row.endImageUrl ?? null,
    audioUrl: row.audioUrl ?? null,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    memory: row.memory,
    seed: row.seed ?? null,
    order: row.order ?? 0,
    reelChanges: row.reelChanges || [],
    modelSheets: row.modelSheets || [],
    audioPieces: row.audioPieces || [],
    prompts: row.prompts || {},
    audioVersion: row.audioVersion ?? null,
    pastAudioVersions: row.pastAudioVersions || [],
    status: row.status || "draft",
  };
  const saved = await api(`/api/director/series/${state.seriesId}`, { method: "PUT", body: patch });
  console.log(`series   fields written`);

  // The cue sheet through its own route, so the per-reel ceilings are checked
  // as the sheet the endpoint will actually see rather than as a bare field.
  const cue = await api(`/api/director/series/${state.seriesId}/cue`, {
    method: "POST",
    body: { mode: "replace", beats: row.directions || [] },
  });
  console.log(`cue      ${(cue.series.directions || []).length} beats, ${(cue.series.directions || []).filter((b) => b.endImageUrl).length} pinned`);

  const issues = Object.entries(cue.issues || {});
  if (issues.length) {
    console.log(`\n⚠  the Director would refuse this Series:`);
    for (const [field, message] of issues) console.log(`   ${field}: ${message}`);
  } else {
    console.log(`\n✓  ready — ${cue.screening?.filmSeconds ?? 0}s of film across ${cue.reels?.length ?? 1} reel(s)`);
  }
  console.log(`   ${API}/director  ·  project ${state.projectId}`);
  void saved;
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
