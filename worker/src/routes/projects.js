// Frontend-facing project registry API (/api/projects*), ported from the Express
// server's /api/projects* endpoints. Backed by the D1 `projects` table (same as
// the legacy /projects routes in index.js) plus a server-side "active project"
// stored in D1 — media requests (<img>/<video>, no header) and the eve agent
// (calls the API without x-project-id) resolve to the active project.
//
// Multi-tenant: a project belongs to an organization (its creator's), and the
// list a user sees is every project they can reach across ALL their orgs, not
// just the ones they own. Access decisions live in lib/orgs.js; this file only
// bootstraps the user's personal org and lists/creates within it.

import {
  ensurePersonalOrg,
  listAccessibleProjects,
  canAccessProject,
  canManageOrg,
} from "../lib/orgs.js";

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
      // Prefer the user's own most-recent project; an invited-only user (no
      // projects of their own) falls back to the most-recent project they can
      // reach across the orgs they belong to.
      const p = await env.DB.prepare(
        "SELECT id FROM projects WHERE owner_user_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 1",
      ).bind(userId).first();
      if (p) return p.id;
      const accessible = await listAccessibleProjects(env, userId);
      if (accessible.length) return accessible[0].id;
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

// Confirm a project belongs to the signed-in user (per-user isolation).
async function ownsProject(env, userId, id) {
  const row = await env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND owner_user_id = ? AND archived = 0",
  ).bind(id, userId).first();
  return !!row;
}

// May `userId` administer `id` — rename, delete, move? The creator, or an
// owner/admin of the org the project lives in. (Access to USE a project is the
// broader lib/orgs.js#canAccessProject; this is the narrower "manage" gate.)
async function canManageProject(env, userId, id) {
  const row = await env.DB.prepare(
    "SELECT owner_user_id, organization_id, archived FROM projects WHERE id = ?",
  ).bind(id).first();
  if (!row || row.archived) return false;
  if (row.owner_user_id === userId) return true;
  return row.organization_id ? canManageOrg(env, row.organization_id, userId) : false;
}

/**
 * Create a project owned by `userId`, in their personal org (or `organizationId`
 * when they may manage it). The ONE way a project is made — POST /api/projects
 * and the Auto Film start (routes/auto.js, a project per Film) both come here.
 * → { project } | { error: "Forbidden" }
 */
export async function createProject(env, userId, { name, organizationId } = {}) {
  const clean = (name || "").toString().trim() || "Untitled project";
  let orgId = await ensurePersonalOrg(env, userId);
  if (organizationId && organizationId !== orgId) {
    if (await canManageOrg(env, organizationId, userId)) orgId = organizationId;
    else return { error: "Forbidden" };
  }
  const id = newProjectId();
  const ts = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO projects (id, name, created_at, updated_at, archived, owner_user_id, organization_id) VALUES (?, ?, ?, ?, 0, ?, ?)",
  ).bind(id, clean, ts, ts, userId, orgId).run();
  return { project: { id, name: clean, created_at: ts, updated_at: ts, organization_id: orgId, access: "owner" } };
}

/** Archive a project (the soft delete DELETE /api/projects/:id does). */
export async function archiveProject(env, id) {
  const ts = new Date().toISOString();
  await env.DB.prepare("UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?").bind(ts, id).run();
}

export function registerProjects(app) {
  app.get("/api/projects", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    // Ensure the user has a personal org (and their pre-org projects are
    // backfilled into it), then list everything they can reach across all orgs.
    const orgId = await ensurePersonalOrg(c.env, userId);
    let projects = await listAccessibleProjects(c.env, userId);

    // First login with nothing to show: the very first user to sign in claims
    // the legacy p_default (the Whistlewood data); everyone else — including an
    // invited-only user who somehow lands here empty — gets a fresh project in
    // their personal org so they always have a workspace of their own.
    if (!projects.length) {
      const ts = new Date().toISOString();
      const orphan = await c.env.DB.prepare(
        "SELECT id FROM projects WHERE id = ? AND owner_user_id IS NULL",
      ).bind(DEFAULT_PROJECT_ID).first();
      if (orphan) {
        await c.env.DB.prepare(
          "UPDATE projects SET owner_user_id = ?, organization_id = ? WHERE id = ?",
        ).bind(userId, orgId, DEFAULT_PROJECT_ID).run();
      } else {
        const id = newProjectId();
        await c.env.DB.prepare(
          "INSERT INTO projects (id, name, created_at, updated_at, archived, owner_user_id, organization_id) VALUES (?, 'My Project', ?, ?, 0, ?, ?)",
        ).bind(id, ts, ts, userId, orgId).run();
      }
      projects = await listAccessibleProjects(c.env, userId);
    }
    return c.json({ projects, activeId: await getActiveProject(c.env, userId) });
  });

  app.post("/api/projects", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const res = await createProject(c.env, userId, { name: body?.name, organizationId: body?.organizationId });
    if (res.error) return c.json({ error: res.error }, 403);
    return c.json({ project: res.project });
  });

  app.patch("/api/projects/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!userId || !(await canManageProject(c.env, userId, id))) return c.json({ error: "Not found" }, 404);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const name = (body?.name || "").toString().trim();
    if (!name) return c.json({ error: "Name is required" }, 400);
    const ts = new Date().toISOString();
    await c.env.DB.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").bind(name, ts, id).run();
    return c.json({ project: { id, name, updated_at: ts } });
  });

  app.delete("/api/projects/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!userId || !(await canManageProject(c.env, userId, id))) return c.json({ error: "Not found" }, 404);
    // Don't strand the owner with no workspace of their own.
    if (await ownsProject(c.env, userId, id)) {
      const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_user_id = ? AND archived = 0").bind(userId).first();
      if ((row?.n ?? 0) <= 1) return c.json({ error: "Cannot delete your last project" }, 409);
    }
    await archiveProject(c.env, id);
    if ((await getActiveProject(c.env, userId)) === id) await setActiveProject(c.env, userId, "");
    return c.json({ ok: true });
  });

  // Set the user's active project (any project they can reach — including one
  // shared with them through an org).
  app.post("/api/projects/:id/activate", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!userId || !(await canAccessProject(c.env, userId, id))) return c.json({ error: "Not found" }, 404);
    await setActiveProject(c.env, userId, id);
    return c.json({ ok: true, activeId: id });
  });
}
