// Episode registry (/api/episodes*). A SERIES project is a list of episodes;
// each episode has its own script, shot list, animatic, editor and cut, while the
// world bible is shared (see routes/world.js). This registry is the list of
// episodes and their titles — a single series-level `episodes` doc, NOT itself
// episode-scoped (it's the thing that names the episodes).
//
// The FIRST episode is `DEFAULT_EPISODE` ("ep1") and its per-episode documents
// are UNSUFFIXED — that's what makes a feature film / a pre-series project Just
// Work: it already is the default episode, it just never shows a switcher.
// Episodes 2+ get `:<id>`-suffixed docs (lib/docs.js). Creating an episode also
// seeds its bible (blank story depth + the anchored characters) so the new
// episode's roster is frozen at creation, independent of later anchor changes.
import { readDoc, updateDoc, DEFAULT_EPISODE } from "../lib/docs.js";
import { readWorld, editEpisodeBible } from "./world.js";

const str = (v) => (v == null ? "" : String(v));
const now = () => new Date().toISOString();

// The active episode is PER (user, project) — two projects have independent
// "current episodes", and two collaborators can be looking at different ones.
// Stored in the same `secrets` k/v the active PROJECT uses. Media element loads
// (`<img>`/`<video>`, which can't send the `x-episode-id` header) resolve through
// this fallback, exactly as they resolve the active project. Missing = the
// default episode, so a feature film / pre-series project needs no row.
const activeKey = (userId, pid) => `active-episode:${userId || "_"}:${pid || "_"}`;

export async function getActiveEpisode(env, userId, pid) {
  try {
    const row = await env.DB.prepare("SELECT value FROM secrets WHERE key = ?")
      .bind(activeKey(userId, pid)).first();
    if (row && row.value) return row.value;
  } catch { /* fall through */ }
  return null;
}

async function setActiveEpisode(env, userId, pid, id) {
  await env.DB.prepare(
    "INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(activeKey(userId, pid), id, now()).run();
}

// The synthesized first episode for a project that has never created one. Its
// title tracks the world title so a freshly-flipped series reads sensibly.
const defaultEpisode = (world, ts) => ({
  id: DEFAULT_EPISODE,
  number: 1,
  title: str(world?.title).trim() || "Episode 1",
  createdAt: ts,
  updatedAt: ts,
});

// Coerce the stored registry to a well-formed `{ episodes, nextNumber }`. Always
// contains at least the default episode; `nextNumber` is monotonic so a deleted
// episode's number is never reused (which would collide with its orphaned docs).
function normalizeEpisodes(raw, world, ts) {
  const list = Array.isArray(raw?.episodes) ? raw.episodes : [];
  const episodes = list
    .filter((e) => e && str(e.id))
    .map((e, i) => ({
      id: str(e.id),
      number: Number.isFinite(Number(e.number)) ? Number(e.number) : i + 1,
      title: str(e.title).trim() || `Episode ${i + 1}`,
      createdAt: e.createdAt ?? null,
      updatedAt: e.updatedAt ?? null,
    }));
  if (!episodes.length) episodes.push(defaultEpisode(world, ts));
  const maxNumber = episodes.reduce((m, e) => Math.max(m, e.number), 0);
  const nextNumber = Math.max(Number(raw?.nextNumber) || 0, maxNumber + 1, 2);
  return { episodes, nextNumber };
}

// The registry as the GUI/agent read it, synthesizing ep1 when nothing's stored.
export async function readEpisodes(env, pid) {
  const raw = await readDoc(env, pid, "episodes", null);
  const world = raw ? null : await readWorld(env, pid);
  return normalizeEpisodes(raw, world, null);
}

export function registerEpisodes(app) {
  app.get("/api/episodes", async (c) => {
    const pid = c.get("projectId");
    const world = await readWorld(c.env, pid);
    const { episodes } = await readEpisodes(c.env, pid);
    const activeId = (await getActiveEpisode(c.env, c.get("userId"), pid)) || DEFAULT_EPISODE;
    // The format rides along so the client can gate the episode switcher on it
    // without a second round-trip to /api/world.
    return c.json({ episodes, activeId, format: world.format, defaultEpisodeId: DEFAULT_EPISODE });
  });

  // Set the user's active episode for this project. The client also sends
  // `x-episode-id` on its own fetches (which wins), but persisting it here is what
  // lets header-less media element loads resolve to the right episode's bytes.
  app.post("/api/episodes/:id/activate", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const { episodes } = await readEpisodes(c.env, pid);
    if (!episodes.some((e) => e.id === id)) return c.json({ error: `no episode ${id}` }, 404);
    await setActiveEpisode(c.env, c.get("userId"), pid, id);
    return c.json({ ok: true, activeId: id });
  });

  // Create the next episode. Appends to the registry with a monotonic number/id
  // and seeds its bible (anchored cast + blank depth).
  app.post("/api/episodes", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const world = await readWorld(c.env, pid);
    const ts = now();
    const seed = normalizeEpisodes(null, world, ts);
    let created = null;
    await updateDoc(c.env, pid, "episodes", seed, (doc) => {
      const reg = normalizeEpisodes(doc, world, ts);
      const number = reg.nextNumber;
      created = {
        id: `ep${number}`,
        number,
        title: str(body?.title).trim() || `Episode ${number}`,
        createdAt: ts,
        updatedAt: ts,
      };
      reg.episodes.push(created);
      reg.nextNumber = number + 1;
      doc.episodes = reg.episodes;
      doc.nextNumber = reg.nextNumber;
    });
    // Freeze the new episode's roster (anchored characters) + blank depth now, so
    // it doesn't drift if anchors change later. A no-op mutate writes the seed.
    await editEpisodeBible(c.env, pid, () => ({}), created.id);
    const { episodes } = await readEpisodes(c.env, pid);
    return c.json({ ok: true, episode: created, episodes });
  });

  // Rename an episode.
  app.patch("/api/episodes/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const title = str(body?.title).trim();
    if (!title) return c.json({ error: "Title is required" }, 400);
    const world = await readWorld(c.env, pid);
    const ts = now();
    const res = await updateDoc(c.env, pid, "episodes", normalizeEpisodes(null, world, ts), (doc) => {
      const reg = normalizeEpisodes(doc, world, ts);
      const ep = reg.episodes.find((e) => e.id === id);
      if (!ep) return { abort: true, missing: true };
      ep.title = title;
      ep.updatedAt = ts;
      doc.episodes = reg.episodes;
      doc.nextNumber = reg.nextNumber;
      return { episode: ep };
    });
    if (res.missing) return c.json({ error: `no episode ${id}` }, 404);
    const { episodes } = await readEpisodes(c.env, pid);
    return c.json({ ok: true, episode: res.episode, episodes });
  });

  // Remove an episode from the registry. The first episode can't be deleted (its
  // unsuffixed docs are the project's baseline), nor the last one. The episode's
  // own documents are left in place — orphaned but recoverable — rather than
  // hard-deleted here.
  app.delete("/api/episodes/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    if (id === DEFAULT_EPISODE) return c.json({ error: "Cannot delete the first episode" }, 409);
    const world = await readWorld(c.env, pid);
    const ts = now();
    const res = await updateDoc(c.env, pid, "episodes", normalizeEpisodes(null, world, ts), (doc) => {
      const reg = normalizeEpisodes(doc, world, ts);
      const remaining = reg.episodes.filter((e) => e.id !== id);
      if (remaining.length === reg.episodes.length) return { abort: true, missing: true };
      if (remaining.length === 0) return { abort: true, last: true };
      doc.episodes = remaining;
      doc.nextNumber = reg.nextNumber;
    });
    if (res.missing) return c.json({ error: `no episode ${id}` }, 404);
    if (res.last) return c.json({ error: "Cannot delete the last episode" }, 409);
    // If the deleted episode was active, fall back to the default so the next
    // header-less request doesn't resolve to a now-missing episode.
    if ((await getActiveEpisode(c.env, c.get("userId"), pid)) === id) {
      await setActiveEpisode(c.env, c.get("userId"), pid, DEFAULT_EPISODE);
    }
    const { episodes } = await readEpisodes(c.env, pid);
    return c.json({ ok: true, episodes });
  });
}
