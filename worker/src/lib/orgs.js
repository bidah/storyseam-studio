// Teams & multi-tenancy — the tenant model and the ONE access predicate.
//
// A project lives in exactly one organization. Access to it is decided in a
// single place, `canAccessProject`, which the middleware in index.js applies to
// BOTH credentials (the Better Auth session cookie AND the flue agent's signed
// header) — so the agent inherits a user's team access for free, and there is no
// second copy of the rule to drift.
//
// The rule, in words:
//   • the project's creator (owner_user_id) always has full access;
//   • an org owner/admin sees EVERY project in the org;
//   • a plain org member sees a project ONLY if their membership is marked
//     all_projects, OR they hold a project_member grant for it — a bare
//     membership grants nothing on its own;
//   • a project_member grant of role "viewer" is read-only.
//
// Every user gets a PERSONAL org on first sign-in (`ensurePersonalOrg`), and any
// project they own with no org yet is backfilled into it — so the legacy
// single-owner world keeps working while the org layer grows over it.

const newOrgId = () => `o_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
const newInviteId = () => `inv_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

// 128-bit random hex — the credential an invitee presents to accept. Same shape
// as the share-link secret (lib/share-token.js); not a signed assertion.
export function newInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare so a mismatch can't leak where it diverged (same shape
// as shareTokensMatch / the MCP bearer check).
export async function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";

function personalOrgName(user) {
  const base = (user?.name || user?.email || "").toString().trim();
  if (!base) return "Personal workspace";
  const first = base.split(/[@\s]/)[0];
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}'s workspace`;
}

// ─── The predicate ──────────────────────────────────────────────────────────

// Can `userId` reach `projectId`? Pass { write: true } for a mutation so a
// read-only ("viewer") grant is rejected on writes but still allows reads.
export async function canAccessProject(env, userId, projectId, opts = {}) {
  const write = !!opts.write;
  if (!projectId) return true; // nothing to scope (parity with the old check)
  const proj = await env.DB
    .prepare("SELECT owner_user_id, organization_id FROM projects WHERE id = ?")
    .bind(projectId)
    .first();
  if (!proj) return true; // unknown id → let the route 404 naturally
  if (!proj.owner_user_id) return true; // legacy unclaimed (e.g. p_default)
  if (proj.owner_user_id === userId) return true; // creator: full access
  if (!userId) return false;

  const orgId = proj.organization_id;
  const [memberRes, grantRes] = await env.DB.batch([
    orgId
      ? env.DB
          .prepare("SELECT role, all_projects FROM org_members WHERE organization_id = ? AND user_id = ?")
          .bind(orgId, userId)
      : // No org on the project → no membership can match; a query that yields
        // zero rows keeps the batch shape uniform.
        env.DB.prepare("SELECT NULL AS role, 0 AS all_projects WHERE 0 = 1"),
    env.DB
      .prepare("SELECT role FROM project_member WHERE project_id = ? AND user_id = ?")
      .bind(projectId, userId),
  ]);

  const m = memberRes.results?.[0];
  if (m && (m.role === "owner" || m.role === "admin" || m.all_projects)) return true;

  const g = grantRes.results?.[0];
  if (g) return write ? g.role !== "viewer" : true;

  return false; // member without a grant, or a stranger
}

// ─── Personal org bootstrap / backfill ──────────────────────────────────────

export async function ensurePersonalOrg(env, userId) {
  if (!userId) return null;
  const existing = await env.DB
    .prepare("SELECT id FROM organizations WHERE owner_user_id = ? AND personal = 1 LIMIT 1")
    .bind(userId)
    .first();
  let orgId = existing?.id;
  const ts = new Date().toISOString();
  if (!orgId) {
    orgId = newOrgId();
    const user = await env.DB.prepare('SELECT name, email FROM "user" WHERE id = ?').bind(userId).first();
    const name = personalOrgName(user);
    await env.DB.batch([
      env.DB
        .prepare(
          "INSERT INTO organizations (id, name, slug, owner_user_id, personal, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(orgId, name, slugify(name), userId, ts, ts),
      env.DB
        .prepare(
          "INSERT OR IGNORE INTO org_members (organization_id, user_id, role, all_projects, created_at) VALUES (?, ?, 'owner', 1, ?)",
        )
        .bind(orgId, userId, ts),
    ]);
  }
  // Any project this user created before orgs existed belongs in their personal
  // org. Cheap and idempotent — the WHERE only ever matches un-orged rows.
  await env.DB
    .prepare("UPDATE projects SET organization_id = ? WHERE owner_user_id = ? AND organization_id IS NULL")
    .bind(orgId, userId)
    .run();
  return orgId;
}

// ─── Org membership helpers ─────────────────────────────────────────────────

// The caller's role in an org, or null if they aren't a member.
export async function orgRole(env, orgId, userId) {
  if (!orgId || !userId) return null;
  const row = await env.DB
    .prepare("SELECT role FROM org_members WHERE organization_id = ? AND user_id = ?")
    .bind(orgId, userId)
    .first();
  return row?.role || null;
}

// owner/admin may invite, manage members and see every project.
export async function canManageOrg(env, orgId, userId) {
  const role = await orgRole(env, orgId, userId);
  return role === "owner" || role === "admin";
}

// Orgs the user belongs to (their personal one + any they were invited into),
// with their role and whether they own it.
export async function listUserOrgs(env, userId) {
  if (!userId) return [];
  const { results } = await env.DB
    .prepare(
      `SELECT o.id, o.name, o.slug, o.personal, o.owner_user_id, m.role, m.all_projects
         FROM org_members m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ?
        ORDER BY o.personal DESC, o.created_at ASC`,
    )
    .bind(userId)
    .all();
  return (results || []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    personal: !!r.personal,
    role: r.role,
    isOwner: r.owner_user_id === userId,
    allProjects: !!r.all_projects,
  }));
}

// ─── Project listing ────────────────────────────────────────────────────────

// Every non-archived project the user can reach, across all their orgs, tagged
// with the access level they have on it. Feeds GET /api/projects.
export async function listAccessibleProjects(env, userId) {
  if (!userId) return [];
  const byId = new Map();
  const add = (row, access) => {
    if (!byId.has(row.id)) byId.set(row.id, { ...row, access });
  };

  // 1) Projects the user created.
  const owned = await env.DB
    .prepare(
      "SELECT id, name, created_at, updated_at, organization_id FROM projects WHERE owner_user_id = ? AND archived = 0",
    )
    .bind(userId)
    .all();
  for (const r of owned.results || []) add(r, "owner");

  // 2) Every project in orgs where the user has full reach (owner/admin, or a
  //    member invited with "all projects" scope).
  const fullOrgs = (
    await env.DB
      .prepare(
        "SELECT organization_id FROM org_members WHERE user_id = ? AND (role IN ('owner','admin') OR all_projects = 1)",
      )
      .bind(userId)
      .all()
  ).results?.map((r) => r.organization_id) || [];
  if (fullOrgs.length) {
    const placeholders = fullOrgs.map(() => "?").join(",");
    const orgProjects = await env.DB
      .prepare(
        `SELECT id, name, created_at, updated_at, organization_id FROM projects WHERE organization_id IN (${placeholders}) AND archived = 0`,
      )
      .bind(...fullOrgs)
      .all();
    for (const r of orgProjects.results || []) add(r, "member");
  }

  // 3) Individually granted projects.
  const granted = await env.DB
    .prepare(
      `SELECT p.id, p.name, p.created_at, p.updated_at, p.organization_id, pm.role AS grant_role
         FROM project_member pm JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = ? AND p.archived = 0`,
    )
    .bind(userId)
    .all();
  for (const r of granted.results || []) {
    const { grant_role, ...rest } = r;
    add(rest, grant_role === "viewer" ? "viewer" : "editor");
  }

  return [...byId.values()].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

// ─── Members of an org (for the management UI / agent list_members) ──────────

export async function listOrgMembers(env, orgId) {
  const members = await env.DB
    .prepare(
      `SELECT m.user_id, m.role, m.all_projects, m.created_at, u.name, u.email
         FROM org_members m LEFT JOIN "user" u ON u.id = m.user_id
        WHERE m.organization_id = ?
        ORDER BY m.created_at ASC`,
    )
    .bind(orgId)
    .all();
  // Per-project grants, so the UI can show "member X → projects A, B".
  const grants = await env.DB
    .prepare(
      `SELECT pm.user_id, pm.project_id, pm.role, p.name
         FROM project_member pm JOIN projects p ON p.id = pm.project_id
        WHERE p.organization_id = ?`,
    )
    .bind(orgId)
    .all();
  const grantsByUser = new Map();
  for (const g of grants.results || []) {
    if (!grantsByUser.has(g.user_id)) grantsByUser.set(g.user_id, []);
    grantsByUser.get(g.user_id).push({ projectId: g.project_id, name: g.name, role: g.role });
  }
  return (members.results || []).map((m) => ({
    userId: m.user_id,
    name: m.name || null,
    email: m.email || null,
    role: m.role,
    allProjects: !!m.all_projects,
    grants: grantsByUser.get(m.user_id) || [],
  }));
}

// ─── Invitations ────────────────────────────────────────────────────────────

// Create a pending invite carrying the scope the inviter picked. Returns the row
// plus its accept token (the token is stored so accept can verify it).
export async function createInvitation(env, { orgId, email, role, scopeMode, projectIds, projectRole, invitedBy }) {
  const id = newInviteId();
  const token = newInviteToken();
  const ts = new Date().toISOString();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days
  const mode = scopeMode === "all" ? "all" : "selection";
  const ids = mode === "selection" ? JSON.stringify((projectIds || []).filter(Boolean)) : null;
  await env.DB
    .prepare(
      `INSERT INTO org_invitations
        (id, organization_id, email, role, scope_mode, scope_project_ids, project_role, token, status, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      id,
      orgId,
      String(email || "").trim().toLowerCase(),
      role === "admin" ? "admin" : "member",
      mode,
      ids,
      projectRole === "viewer" ? "viewer" : "editor",
      token,
      invitedBy,
      ts,
      expires,
    )
    .run();
  return { id, token, orgId, email, scopeMode: mode };
}

export async function getInvitation(env, id) {
  return env.DB.prepare("SELECT * FROM org_invitations WHERE id = ?").bind(id).first();
}

// Materialise a pending invite for `userId`: the org_members row (+ all_projects
// for "all" scope) and the project_member grants named in the scope. Idempotent
// on the membership (INSERT OR IGNORE) and marks the invite accepted.
export async function acceptInvitation(env, inv, userId) {
  const ts = new Date().toISOString();
  const all = inv.scope_mode === "all";
  const stmts = [
    env.DB
      .prepare(
        `INSERT INTO org_members (organization_id, user_id, role, all_projects, invited_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, user_id) DO UPDATE SET
           role = excluded.role,
           all_projects = MAX(org_members.all_projects, excluded.all_projects)`,
      )
      .bind(inv.organization_id, userId, inv.role || "member", all ? 1 : 0, inv.invited_by, ts),
    env.DB
      .prepare("UPDATE org_invitations SET status = 'accepted', accepted_by = ?, accepted_at = ? WHERE id = ?")
      .bind(userId, ts, inv.id),
  ];
  if (!all) {
    let ids = [];
    try {
      ids = JSON.parse(inv.scope_project_ids || "[]");
    } catch {
      ids = [];
    }
    for (const pid of ids) {
      // Only grant projects that actually live in this org (defends against a
      // stale invite naming a project that moved or was deleted).
      stmts.push(
        env.DB
          .prepare(
            `INSERT INTO project_member (project_id, user_id, role, granted_by, created_at)
               SELECT ?, ?, ?, ?, ?
               WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND organization_id = ?)
             ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
          )
          .bind(pid, userId, inv.project_role || "editor", inv.invited_by, ts, pid, inv.organization_id),
      );
    }
  }
  await env.DB.batch(stmts);
  return { landingProjectId: await inviteLandingProject(env, inv) };
}

// Which project should an accepting invitee be dropped onto? For a scoped invite,
// the most-recently-updated project they were actually granted; for an "all"
// invite (no explicit grants), the org's most-recently-updated project. Null if
// the org has nothing to show — the caller falls back to the default landing.
async function inviteLandingProject(env, inv) {
  if (inv.scope_mode === "all") {
    const row = await env.DB.prepare(
      "SELECT id FROM projects WHERE organization_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 1",
    ).bind(inv.organization_id).first();
    return row?.id || null;
  }
  let ids = [];
  try { ids = JSON.parse(inv.scope_project_ids || "[]"); } catch { ids = []; }
  if (!ids.length) return null;
  const row = await env.DB.prepare(
    `SELECT id FROM projects WHERE organization_id = ? AND archived = 0 AND id IN (${ids.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT 1`,
  ).bind(inv.organization_id, ...ids).first();
  return row?.id || null;
}

// Grant / update / revoke a single member's access to a single project — the
// "change the scope later" path. role null ⇒ revoke.
export async function setProjectGrant(env, { projectId, userId, role, grantedBy }) {
  if (!role) {
    await env.DB.prepare("DELETE FROM project_member WHERE project_id = ? AND user_id = ?").bind(projectId, userId).run();
    return;
  }
  const ts = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO project_member (project_id, user_id, role, granted_by, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .bind(projectId, userId, role === "viewer" ? "viewer" : "editor", grantedBy, ts)
    .run();
}

// Flip a member's "all projects" scope (org-wide reach without admin powers).
export async function setMemberAllProjects(env, { orgId, userId, allProjects }) {
  await env.DB
    .prepare("UPDATE org_members SET all_projects = ? WHERE organization_id = ? AND user_id = ?")
    .bind(allProjects ? 1 : 0, orgId, userId)
    .run();
}

// Remove a member entirely (membership + every per-project grant in the org).
// The org owner can never be removed.
export async function removeMember(env, { orgId, userId }) {
  await env.DB.batch([
    env.DB
      .prepare("DELETE FROM org_members WHERE organization_id = ? AND user_id = ? AND role != 'owner'")
      .bind(orgId, userId),
    env.DB
      .prepare(
        "DELETE FROM project_member WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE organization_id = ?)",
      )
      .bind(userId, orgId),
  ]);
}
