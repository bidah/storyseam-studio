// Visual World endpoints (/api/visual-world*). The VISUAL counterpart of the
// (written) World tab: a chat-style image generator to explore how the series'
// characters and places look, plus a reference-lineage canvas. Prompt-engineered,
// bulk image generation via the Higgsfield MCP (Nano Banana Pro by default).
//
// Backed by the R2 doc `state/<pid>/visual-world.json` (whole-document
// read-modify-write, like world.json) and R2 image bytes under the `visual`
// media kind (served at `/visual-media/<file>`). Two writers share the store:
//   1. the in-app composer (this file's /generate + /poll), and
//   2. the flue agent (the /image attach route, like /api/storyboard/image),
// so agent-generated images land on the tab live via the data-channel broadcast.
//
// Generation is ASYNC and spans two requests, exactly like a Higgsfield job:
// POST /generate starts one job per image (status "processing"); GET /poll asks
// job_status for each pending job and, on completion, downloads the bytes into R2
// and flips the record to "ready". The client polls /poll every ~3s while any
// card is processing (mirrors idea-mural's VideoGenView).
import { readDoc, updateDoc, normalizeProjectId } from "../lib/docs.js";
import { putMedia, mediaKey } from "../lib/media.js";
import {
  getHiggsfieldToken,
  forceRefreshHiggsfieldToken,
  mcpToolCall,
  isAllowedMediaUrl,
  HiggsfieldAuthError,
} from "../lib/higgsfield.js";

/* ------------------------------------------------------------------ *
 * Store shape                                                         *
 * ------------------------------------------------------------------ */

const str = (v) => (v == null ? "" : String(v));
const clampCount = (n) => Math.min(4, Math.max(1, Math.floor(Number(n) || 1)));

// The user's 2D prompt (adapted for stills — style/palette/composition kept, the
// Seedance camera-motion clauses moved to the `video` field). Seeds the library
// so the composer has a real preset to choose from on first use.
const SEED_PROMPTS = [
  {
    id: "preset-2d",
    name: "2D storybook (Whistlewood)",
    builtin: true,
    image:
      "Flat 2D hand-drawn animation, clean confident vector linework, strictly " +
      "limited muted palette of teal, mustard yellow and dusty rose, " +
      "gouache-textured flat painterly backgrounds with subtle paper grain, " +
      "Scandinavian folklore storybook illustration style, soft diffused morning " +
      "light, flat ambient shading with no gradients, minimalist rounded " +
      "character design with simple sparse facial features, strong graphic " +
      "composition with generous negative space. Split of panes when needed " +
      "between front, middle and backgrounds. Cozy, adventurous, slightly " +
      "melancholic Nordic atmosphere. No 3D rendering, no photorealism, no CGI " +
      "shading, no volumetric depth, no oversaturation.",
    video:
      "Slow gentle dolly-in with subtle layered parallax on background planes, " +
      "camera stays flat and 2D-friendly with no orbiting or perspective shifts. " +
      "Smooth hand-drawn 2D animated motion. No hand held camera.",
  },
];

function emptyVisualWorld() {
  return {
    generatedAt: null,
    source: null,
    settings: { model: "", aspectRatio: "16:9", count: 1, cinematic: false, presetId: "preset-2d" },
    prompts: structuredClone(SEED_PROMPTS),
    generations: [],
    board: { nodes: [], edges: [], viewport: null },
  };
}

function normalizePrompt(p, i = 0) {
  const o = p || {};
  return {
    id: str(o.id) || `prompt-${Date.now().toString(36)}-${i}`,
    name: str(o.name) || "Untitled prompt",
    image: str(o.image),
    video: str(o.video),
    builtin: !!o.builtin,
  };
}

function normalizeRef(r) {
  const o = r || {};
  const kind = o.kind === "generation" ? "generation" : "library";
  return {
    kind,
    rel: kind === "library" ? str(o.rel) : "",
    genId: kind === "generation" ? str(o.genId) : "",
    url: str(o.url),
  };
}

function normalizeGeneration(g, i = 0) {
  const o = g || {};
  const status = ["processing", "ready", "error"].includes(o.status) ? o.status : "ready";
  return {
    id: str(o.id) || `gen-${Date.now().toString(36)}-${i}`,
    status,
    prompt: str(o.prompt),
    assembledPrompt: str(o.assembledPrompt),
    model: str(o.model),
    aspectRatio: str(o.aspectRatio) || "16:9",
    presetId: str(o.presetId),
    jobId: str(o.jobId),
    source: str(o.source),
    file: str(o.file),
    thumb: str(o.thumb),
    error: str(o.error),
    refs: Array.isArray(o.refs) ? o.refs.map(normalizeRef) : [],
    ts: o.ts || null,
  };
}

function normalizeBoard(b) {
  const o = b || {};
  const nodes = Array.isArray(o.nodes)
    ? o.nodes.map((n) => ({
        id: str(n?.id),
        genId: str(n?.genId),
        x: Number(n?.x) || 0,
        y: Number(n?.y) || 0,
        w: n?.w != null ? Number(n.w) : null,
        h: n?.h != null ? Number(n.h) : null,
      })).filter((n) => n.id && n.genId)
    : [];
  const edges = Array.isArray(o.edges)
    ? o.edges.map((e) => ({ id: str(e?.id), source: str(e?.source), target: str(e?.target) }))
        .filter((e) => e.id && e.source && e.target)
    : [];
  return { nodes, edges, viewport: o.viewport ?? null };
}

function normalizeVisualWorld(raw) {
  const base = emptyVisualWorld();
  const w = raw || {};
  base.generatedAt = w.generatedAt ?? null;
  base.source = w.source ?? null;
  if (w.settings && typeof w.settings === "object") {
    base.settings = {
      model: str(w.settings.model),
      aspectRatio: str(w.settings.aspectRatio) || "16:9",
      count: clampCount(w.settings.count),
      cinematic: !!w.settings.cinematic,
      presetId: str(w.settings.presetId) || "preset-2d",
    };
  }
  base.prompts = Array.isArray(w.prompts) && w.prompts.length
    ? w.prompts.map(normalizePrompt)
    : structuredClone(SEED_PROMPTS);
  base.generations = Array.isArray(w.generations) ? w.generations.map(normalizeGeneration) : [];
  base.board = normalizeBoard(w.board);
  return base;
}

const FALLBACK = emptyVisualWorld();
const readVW = async (env, pid) => normalizeVisualWorld(await readDoc(env, pid, "visual-world", null));
const updateVW = (env, pid, mutate) => updateDoc(env, pid, "visual-world", FALLBACK, mutate);

// Add the serve URL (`/visual-media/<file>`) to a ready generation for the client.
function withUrls(gen) {
  return { ...gen, url: gen.file ? `/visual-media/${gen.file}` : "" };
}

/* ------------------------------------------------------------------ *
 * Higgsfield MCP helpers                                             *
 * ------------------------------------------------------------------ */

// Call an MCP tool, retrying once with a forced token refresh — an expired bearer
// surfaces as a generic tool error, not a 401 (same net as /api/higgsfield/images).
async function mcp(env, userId, token, name, args) {
  try {
    return await mcpToolCall(env, token, name, args);
  } catch (e) {
    if (e instanceof HiggsfieldAuthError) throw e;
    const fresh = await forceRefreshHiggsfieldToken(env, userId);
    if (!fresh) throw e;
    return await mcpToolCall(env, fresh, name, args);
  }
}

const publicBase = (env) => String(env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");

// Ungated, project-encoded reference URL a generator can fetch (same trick as
// storyboard.js refUrl / radio.js voiceRef.refUrl — the key carries the pid, so
// an anonymous Higgsfield fetch resolves the right object).
function filesUrl(env, key) {
  const base = publicBase(env);
  return base ? `${base}/files/${key}` : "";
}

// Pull a media id out of whatever shape the MCP tool returned.
function pickId(data, ...keys) {
  if (!data) return "";
  if (typeof data === "string") return data;
  for (const k of keys) if (data[k]) return String(data[k]);
  // one level of nesting (e.g. { media: { id } } / { result: { id } })
  for (const nest of ["media", "result", "data", "job"]) {
    const inner = data[nest];
    if (inner && typeof inner === "object") {
      for (const k of keys) if (inner[k]) return String(inner[k]);
    }
  }
  return "";
}

// Import a reference URL into Higgsfield → a media_id usable in generate_image
// medias[].value.
async function importRef(env, userId, token, url) {
  const data = await mcp(env, userId, token, "media_import_url", { url });
  const id = pickId(data, "media_id", "mediaId", "id");
  if (!id) throw new Error(`Higgsfield media import returned no id for ${url}`);
  return id;
}

// Resolve the image-model catalog (id + label) via models_explore, marking the
// Nano Banana Pro default. Cached briefly in KV. Defensive about the shape.
const NANO_RE = /nano\s*banana\s*pro/i;
async function resolveModels(env, userId, token) {
  const cacheKey = "visual:image-models:v1";
  try {
    const cached = await env.AUTH_KV.get(cacheKey, "json");
    if (cached?.models?.length) return cached;
  } catch { /* ignore cache miss */ }

  const data = await mcp(env, userId, token, "models_explore", { action: "list", type: "image" });
  const raw = Array.isArray(data)
    ? data
    : data?.models || data?.items || data?.image_models || data?.results || [];
  const models = raw
    .map((m) => ({
      id: str(m?.id || m?.model || m?.slug || m?.model_id),
      label: str(m?.name || m?.title || m?.label || m?.display_name || m?.id),
    }))
    .filter((m) => m.id);
  // Prefer Nano Banana Pro; else the first image model.
  const nano = models.find((m) => NANO_RE.test(m.label) || NANO_RE.test(m.id));
  const defaultId = nano?.id || models[0]?.id || "";
  const out = { models, defaultId };
  try { await env.AUTH_KV.put(cacheKey, JSON.stringify(out), { expirationTtl: 3600 }); } catch { /* best effort */ }
  return out;
}

/* ------------------------------------------------------------------ *
 * Routes                                                              *
 * ------------------------------------------------------------------ */

export function registerVisualWorld(app) {
  // Read the whole visual world (seeds an empty skeleton on first use). Ready
  // generations carry a `/visual-media/<file>` url.
  app.get("/api/visual-world", async (c) => {
    const pid = c.get("projectId");
    const vw = await readVW(c.env, pid);
    return c.json({ ...vw, generations: vw.generations.map(withUrls) });
  });

  // The image-model catalog for the composer's model selector (real Higgsfield
  // ids so /generate gets a valid model). 401 if not signed in to Higgsfield.
  app.get("/api/visual-world/models", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const token = await getHiggsfieldToken(c.env, userId);
    if (!token) return c.json({ error: "no_higgsfield_token" }, 401);
    try {
      return c.json(await resolveModels(c.env, userId, token));
    } catch (e) {
      if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
      return c.json({ error: `Higgsfield: ${e.message || e}` }, 502);
    }
  });

  // Start N image jobs. Body: { prompt, model?, count?, aspectRatio?, refs?,
  // presetId?, cinematic? }. Appends N "processing" records; the client then
  // polls /poll. References are imported into Higgsfield as media_ids.
  app.post("/api/visual-world/generate", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const pid = c.get("projectId");
    const token = await getHiggsfieldToken(c.env, userId);
    if (!token) return c.json({ error: "no_higgsfield_token" }, 401);

    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const prompt = str(body.prompt).trim();
    if (!prompt) return c.json({ error: "Missing 'prompt'" }, 400);
    const count = clampCount(body.count);
    const aspectRatio = str(body.aspectRatio) || "16:9";
    const presetId = str(body.presetId);
    const inputRefs = Array.isArray(body.refs) ? body.refs.map(normalizeRef) : [];

    try {
      // Resolve the model (explicit id from the selector, else Nano Banana Pro).
      let model = str(body.model);
      if (!model) model = (await resolveModels(c.env, userId, token)).defaultId;
      if (!model) return c.json({ error: "Could not resolve an image model" }, 502);

      // Assemble the final prompt: preset style prefix (if chosen) + the scene.
      const vw = await readVW(c.env, pid);
      const preset = presetId ? vw.prompts.find((p) => p.id === presetId) : null;
      const assembledPrompt = preset?.image ? `${preset.image}\n\n${prompt}` : prompt;

      // Resolve every reference to an ungated /files URL, then import → media_id.
      const medias = [];
      for (const r of inputRefs) {
        let url = r.url;
        if (!url && r.kind === "library" && r.rel) {
          url = filesUrl(c.env, `media/${normalizeProjectId(pid)}/asset/${r.rel}`);
        } else if (!url && r.kind === "generation" && r.genId) {
          const g = vw.generations.find((x) => x.id === r.genId);
          if (g?.file) url = filesUrl(c.env, mediaKey(pid, "visual", g.file));
        }
        if (!url) continue;
        const mediaId = await importRef(c.env, userId, token, url);
        medias.push({ role: "image_references", value: mediaId });
      }

      // Fire one job per requested image.
      const started = [];
      for (let i = 0; i < count; i++) {
        const data = await mcp(c.env, userId, token, "generate_image", {
          params: { model, prompt: assembledPrompt, aspect_ratio: aspectRatio, medias },
        });
        const jobId = pickId(data, "jobId", "job_id", "id");
        if (!jobId) throw new Error("Higgsfield generate_image returned no job id");
        started.push({ jobId });
      }

      // Append the processing records.
      const ts = new Date().toISOString();
      const created = started.map((s, i) =>
        normalizeGeneration({
          id: `gen-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}-${i}`,
          status: "processing",
          prompt,
          assembledPrompt,
          model,
          aspectRatio,
          presetId,
          jobId: s.jobId,
          refs: inputRefs,
          ts,
        }),
      );
      await updateVW(c.env, pid, (v) => {
        v.generations.unshift(...created);
        v.settings = { ...v.settings, model, aspectRatio, count, presetId };
        v.generatedAt = ts;
        v.source = "app";
      });
      return c.json({ ok: true, generations: created.map(withUrls) });
    } catch (e) {
      if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
      return c.json({ error: `Higgsfield: ${e.message || e}` }, 502);
    }
  });

  // Poll every pending job; on completion download bytes into R2 and flip the
  // record to "ready". Network work happens BEFORE updateDoc (mutate may re-run).
  app.get("/api/visual-world/poll", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const pid = c.get("projectId");
    const token = await getHiggsfieldToken(c.env, userId);
    if (!token) return c.json({ error: "no_higgsfield_token" }, 401);

    const vw = await readVW(c.env, pid);
    const pending = vw.generations.filter((g) => g.status === "processing" && g.jobId);
    if (!pending.length) return c.json({ generations: vw.generations.map(withUrls) });

    const updates = {}; // id -> partial
    for (const g of pending) {
      try {
        const st = await mcp(c.env, userId, token, "job_status", { jobId: g.jobId, sync: true });
        const status = str(st?.status || st?.state).toLowerCase();
        const rawUrl =
          st?.result_url || st?.results?.rawUrl || st?.results?.raw?.url || st?.result?.url || "";
        if (status === "completed" || status === "succeeded" || status === "done" || rawUrl) {
          if (!isAllowedMediaUrl(rawUrl)) {
            updates[g.id] = { status: "error", error: "No downloadable result URL" };
            continue;
          }
          const res = await fetch(rawUrl);
          if (!res.ok) {
            updates[g.id] = { status: "error", error: `Image fetch failed (${res.status})` };
            continue;
          }
          const ct = res.headers.get("content-type") || "image/png";
          const ext = /webp/.test(ct) ? "webp" : /jpe?g/.test(ct) ? "jpg" : "png";
          const file = `${g.id}.${ext}`;
          await putMedia(c.env, pid, "visual", file, await res.arrayBuffer(), ct);
          updates[g.id] = { status: "ready", file, source: rawUrl };
        } else if (status === "failed" || status === "error" || status === "canceled") {
          updates[g.id] = { status: "error", error: str(st?.error) || "Generation failed" };
        }
        // else: still processing — leave as-is.
      } catch (e) {
        if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
        // Transient poll error — keep the record processing, try again next tick.
      }
    }

    if (Object.keys(updates).length) {
      await updateVW(c.env, pid, (v) => {
        for (const g of v.generations) {
          const u = updates[g.id];
          if (u) Object.assign(g, u);
        }
      });
    }
    const fresh = await readVW(c.env, pid);
    return c.json({ generations: fresh.generations.map(withUrls) });
  });

  // Agent attach route (parallels /api/storyboard/image): the flue agent already
  // ran generate_image itself and POSTs the result URL here so it lands live on
  // the Visual tab. Downloads the bytes into R2 immediately.
  app.post("/api/visual-world/image", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const url = str(body.url);
    if (!url) return c.json({ error: "Missing 'url'" }, 400);

    const id = `gen-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    let file = "";
    let source = url;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const ct = res.headers.get("content-type") || "image/png";
        const ext = /webp/.test(ct) ? "webp" : /jpe?g/.test(ct) ? "jpg" : "png";
        file = `${id}.${ext}`;
        await putMedia(c.env, pid, "visual", file, await res.arrayBuffer(), ct);
      }
    } catch { /* record source url; an /ingest can land bytes later */ }

    const gen = normalizeGeneration({
      id,
      status: file ? "ready" : "error",
      error: file ? "" : "Image download failed",
      prompt: str(body.prompt),
      assembledPrompt: str(body.assembledPrompt) || str(body.prompt),
      model: str(body.model),
      aspectRatio: str(body.aspectRatio) || "16:9",
      presetId: str(body.presetId),
      file,
      source,
      refs: Array.isArray(body.refs) ? body.refs : [],
      ts: new Date().toISOString(),
    });
    await updateVW(c.env, pid, (v) => { v.generations.unshift(gen); });
    return c.json({ ok: true, generation: withUrls(gen) });
  });

  // Delete a generation record + its R2 object.
  app.delete("/api/visual-world/generation/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let file = "";
    const result = await updateVW(c.env, pid, (v) => {
      const g = v.generations.find((x) => x.id === id);
      if (!g) return { abort: true, notFound: true };
      file = g.file;
      v.generations = v.generations.filter((x) => x.id !== id);
      // Drop any board node/edges referencing it.
      v.board.nodes = v.board.nodes.filter((n) => n.genId !== id);
      const nodeIds = new Set(v.board.nodes.map((n) => n.id));
      v.board.edges = v.board.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    });
    if (result?.notFound) return c.json({ error: `no generation ${id}` }, 404);
    if (file) { try { await c.env.BUCKET.delete(mediaKey(pid, "visual", file)); } catch { /* ignore */ } }
    return c.json({ ok: true });
  });

  // Replace the prompt library (add/edit/delete presets).
  app.put("/api/visual-world/prompts", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const list = Array.isArray(body.prompts) ? body.prompts : Array.isArray(body) ? body : null;
    if (!list) return c.json({ error: "Expected { prompts: [...] }" }, 400);
    const prompts = list.map(normalizePrompt);
    await updateVW(c.env, pid, (v) => { v.prompts = prompts; });
    return c.json({ ok: true, prompts });
  });

  // Merge-patch the composer's remembered defaults.
  app.put("/api/visual-world/settings", async (c) => {
    const pid = c.get("projectId");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    await updateVW(c.env, pid, (v) => {
      if (typeof patch.model === "string") v.settings.model = patch.model;
      if (typeof patch.aspectRatio === "string") v.settings.aspectRatio = patch.aspectRatio;
      if (patch.count != null) v.settings.count = clampCount(patch.count);
      if (typeof patch.cinematic === "boolean") v.settings.cinematic = patch.cinematic;
      if (typeof patch.presetId === "string") v.settings.presetId = patch.presetId;
    });
    return c.json({ ok: true });
  });

  // Persist the reference-lineage canvas (nodes / edges / viewport).
  app.put("/api/visual-world/board", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const board = normalizeBoard(body.board || body);
    await updateVW(c.env, pid, (v) => { v.board = board; });
    return c.json({ ok: true, board });
  });

  // Promote a generation into the shared asset library so it can be linked as a
  // character sheet on the written World tab. Copies the R2 bytes to the asset
  // key; returns the library `rel`.
  app.post("/api/visual-world/save-to-library", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const id = str(body.id);
    const vw = await readVW(c.env, pid);
    const gen = vw.generations.find((x) => x.id === id);
    if (!gen || !gen.file) return c.json({ error: `no ready generation ${id}` }, 404);

    const obj = await c.env.BUCKET.get(mediaKey(pid, "visual", gen.file));
    if (!obj) return c.json({ error: "Image bytes missing" }, 404);
    const dir = str(body.folder).replace(/[^a-zA-Z0-9._/-]/g, "").replace(/^\/+|\/+$/g, "");
    const base = (str(body.name).replace(/[^a-zA-Z0-9._-]/g, "") || gen.file).replace(/\.[^.]*$/, "");
    const ext = (/\.([^.]+)$/.exec(gen.file) || [, "png"])[1];
    const rel = `${dir ? dir + "/" : ""}${base}.${ext}`;
    const safePid = normalizeProjectId(pid);
    await c.env.BUCKET.put(`media/${safePid}/asset/${rel}`, obj.body, {
      httpMetadata: { contentType: obj.httpMetadata?.contentType || "image/png" },
    });
    return c.json({ ok: true, rel, name: `${base}.${ext}`, folder: dir || ".", url: `/asset/${rel}` });
  });
}
