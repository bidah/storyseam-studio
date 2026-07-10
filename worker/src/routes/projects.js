// Frontend-facing project registry API (/api/projects*), ported from the Express
// server's /api/projects* endpoints. Backed by the D1 `projects` table (same as
// the legacy /projects routes in index.js) plus a server-side "active project"
// stored in D1 — media requests (<img>/<video>, no header) and the eve agent
// (calls the API without x-project-id) resolve to the active project.

const DEFAULT_PROJECT_ID = "p_default";

const newProjectId = () => `p_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

// The active project is PER USER (so two users don't share one). Falls back to
// the user's most-recently-updated owned project.
const activeKey = (userId) => `active-project:${userId || "_"}`;

export async function getActiveProject(env, userId) {
  try {
    const row = await env.DB.prepare("SELECT value FROM secrets WHERE key = ?").bind(activeKey(userId)).first();
    if (row && row.value) return row.value;
    if (userId) {
      const p = await env.DB.prepare(
        "SELECT id FROM projects WHERE owner_user_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 1",
      ).bind(userId).first();
      if (p) return p.id;
    }
  } catch { /* fall through */ }
  return null;
}
async function setActiveProject(env, userId, id) {
  const ts = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(activeKey(userId), id, ts).run();
}

// Does `projectId` belong to `userId`? (Unowned projects — e.g. a not-yet-
// claimed p_default — are treated as accessible; the first /api/projects load
// claims them.)
export async function userCanAccessProject(env, userId, projectId) {
  if (!projectId) return true;
  const row = await env.DB.prepare("SELECT owner_user_id FROM projects WHERE id = ?").bind(projectId).first();
  if (!row) return true; // unknown id → let the route 404 naturally
  return !row.owner_user_id || row.owner_user_id === userId;
}

// Confirm a project belongs to the signed-in user (per-user isolation).
async function ownsProject(env, userId, id) {
  const row = await env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND owner_user_id = ? AND archived = 0",
  ).bind(id, userId).first();
  return !!row;
}

export function registerProjects(app) {
  app.get("/api/projects", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    // First login: give the user projects. The very first user to sign in
    // claims the legacy p_default (the Whistlewood data); everyone else starts
    // with a fresh blank project.
    let { results } = await c.env.DB.prepare(
      "SELECT id, name, created_at, updated_at FROM projects WHERE owner_user_id = ? AND archived = 0 ORDER BY updated_at DESC",
    ).bind(userId).all();
    if (!results || !results.length) {
      const orphan = await c.env.DB.prepare(
        "SELECT id FROM projects WHERE id = ? AND owner_user_id IS NULL",
      ).bind(DEFAULT_PROJECT_ID).first();
      if (orphan) {
        await c.env.DB.prepare("UPDATE projects SET owner_user_id = ? WHERE id = ?").bind(userId, DEFAULT_PROJECT_ID).run();
      } else {
        const id = newProjectId();
        const ts = new Date().toISOString();
        await c.env.DB.prepare(
          "INSERT INTO projects (id, name, created_at, updated_at, archived, owner_user_id) VALUES (?, 'My Project', ?, ?, 0, ?)",
        ).bind(id, ts, ts, userId).run();
      }
      ({ results } = await c.env.DB.prepare(
        "SELECT id, name, created_at, updated_at FROM projects WHERE owner_user_id = ? AND archived = 0 ORDER BY updated_at DESC",
      ).bind(userId).all());
    }
    return c.json({ projects: results || [], activeId: await getActiveProject(c.env, userId) });
  });

  app.post("/api/projects", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const name = (body?.name || "").toString().trim() || "Untitled project";
    const id = newProjectId();
    const ts = new Date().toISOString();
    await c.env.DB.prepare(
      "INSERT INTO projects (id, name, created_at, updated_at, archived, owner_user_id) VALUES (?, ?, ?, ?, 0, ?)",
    ).bind(id, name, ts, ts, userId).run();
    return c.json({ project: { id, name, created_at: ts, updated_at: ts } });
  });

  app.patch("/api/projects/:id", async (c) => {
    const userId = c.get("userId");
    if (!userId || !(await ownsProject(c.env, userId, c.req.param("id")))) return c.json({ error: "Not found" }, 404);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const name = (body?.name || "").toString().trim();
    if (!name) return c.json({ error: "Name is required" }, 400);
    const ts = new Date().toISOString();
    await c.env.DB.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").bind(name, ts, c.req.param("id")).run();
    return c.json({ project: { id: c.req.param("id"), name, updated_at: ts } });
  });

  app.delete("/api/projects/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!userId || !(await ownsProject(c.env, userId, id))) return c.json({ error: "Not found" }, 404);
    const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_user_id = ? AND archived = 0").bind(userId).first();
    if ((row?.n ?? 0) <= 1) return c.json({ error: "Cannot delete your last project" }, 409);
    const ts = new Date().toISOString();
    await c.env.DB.prepare("UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?").bind(ts, id).run();
    if ((await getActiveProject(c.env, userId)) === id) await setActiveProject(c.env, userId, "");
    return c.json({ ok: true });
  });

  // Set the user's active project (verifies ownership).
  app.post("/api/projects/:id/activate", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!userId || !(await ownsProject(c.env, userId, id))) return c.json({ error: "Not found" }, 404);
    await setActiveProject(c.env, userId, id);
    return c.json({ ok: true, activeId: id });
  });
}
