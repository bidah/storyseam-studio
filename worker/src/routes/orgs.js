// Teams API (/api/orgs*) — organizations, members, per-project scopes, invites.
//
// The tenant model lives in lib/orgs.js; this file is the HTTP surface over it.
// Every route here authorises itself (member-of vs. can-manage) rather than
// leaning on the project-ownership middleware, so `/api/orgs` is exempt from the
// active-project gate in index.js (an invitee accepting their first invite has
// no project yet — the gate would 400 them).
//
// Invites are delivered via email (storyseam.app Email Sending binding). The
// route also returns the `inviteUrl` in the response so the creator can copy it
// as a fallback. The token is the credential.

import { sendInviteEmail } from "../lib/email.js";
import {
  listUserOrgs,
  listOrgMembers,
  orgRole,
  canManageOrg,
  createInvitation,
  getInvitation,
  acceptInvitation,
  setProjectGrant,
  setMemberAllProjects,
  removeMember,
  tokensMatch,
} from "../lib/orgs.js";

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());

function inviteUrl(c, id, token) {
  const origin = c.req.header("x-app-origin") || new URL(c.req.url).origin;
  return `${origin}/accept-invite/${id}?token=${token}`;
}

export function registerOrgs(app) {
  // Every org the caller belongs to (their personal one + any they joined).
  app.get("/api/orgs", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ orgs: await listUserOrgs(c.env, userId) });
  });

  // Members of an org, each with their scope (role, all-projects, grants). Any
  // member may read the roster; only managers see it in a mutating context.
  app.get("/api/orgs/:orgId/members", async (c) => {
    const userId = c.get("userId");
    const orgId = c.req.param("orgId");
    if (!userId || !(await orgRole(c.env, orgId, userId))) return c.json({ error: "Forbidden" }, 403);
    return c.json({ members: await listOrgMembers(c.env, orgId) });
  });

  // Projects in the org (for the invite scope picker). Managers only — a plain
  // member shouldn't enumerate projects they can't see.
  app.get("/api/orgs/:orgId/projects", async (c) => {
    const userId = c.get("userId");
    const orgId = c.req.param("orgId");
    if (!userId || !(await canManageOrg(c.env, orgId, userId))) return c.json({ error: "Forbidden" }, 403);
    const { results } = await c.env.DB.prepare(
      "SELECT id, name, updated_at FROM projects WHERE organization_id = ? AND archived = 0 ORDER BY updated_at DESC",
    ).bind(orgId).all();
    return c.json({ projects: results || [] });
  });

  // Pending invitations for an org (managers only).
  app.get("/api/orgs/:orgId/invitations", async (c) => {
    const userId = c.get("userId");
    const orgId = c.req.param("orgId");
    if (!userId || !(await canManageOrg(c.env, orgId, userId))) return c.json({ error: "Forbidden" }, 403);
    const { results } = await c.env.DB.prepare(
      "SELECT id, email, role, scope_mode, scope_project_ids, project_role, status, created_at, expires_at FROM org_invitations WHERE organization_id = ? AND status = 'pending' ORDER BY created_at DESC",
    ).bind(orgId).all();
    return c.json({ invitations: results || [] });
  });

  // Invite a user, with the scope the inviter chose:
  //   scopeMode "all"       → sees every current & future project of the org
  //   scopeMode "selection" → sees only projectIds (with projectRole)
  app.post("/api/orgs/:orgId/invitations", async (c) => {
    const userId = c.get("userId");
    const orgId = c.req.param("orgId");
    if (!userId || !(await canManageOrg(c.env, orgId, userId))) return c.json({ error: "Forbidden" }, 403);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const email = String(body?.email || "").trim().toLowerCase();
    if (!isEmail(email)) return c.json({ error: "A valid email is required" }, 400);
    const scopeMode = body?.scopeMode === "all" ? "all" : "selection";
    const role = body?.role === "admin" ? "admin" : "member";
    const projectRole = body?.projectRole === "viewer" ? "viewer" : "editor";
    let projectIds = Array.isArray(body?.projectIds) ? body.projectIds.filter(Boolean) : [];
    if (scopeMode === "selection") {
      if (!projectIds.length) return c.json({ error: "Select at least one project, or invite with 'all' scope" }, 400);
      // Keep only projects that actually belong to this org.
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM projects WHERE organization_id = ? AND id IN (${projectIds.map(() => "?").join(",")})`,
      ).bind(orgId, ...projectIds).all();
      projectIds = (results || []).map((r) => r.id);
      if (!projectIds.length) return c.json({ error: "None of those projects belong to this organization" }, 400);
    }
    const inv = await createInvitation(c.env, {
      orgId, email, role, scopeMode, projectIds, projectRole, invitedBy: userId,
    });
    const url = inviteUrl(c, inv.id, inv.token);
    // Send the email inline — if it fails the invite still exists in D1 and the
    // inviteUrl is returned as a fallback, but the creator gets to know.
    let emailResult = null;
    try {
      const org = await c.env.DB.prepare("SELECT name FROM organizations WHERE id = ?").bind(orgId).first();
      emailResult = await sendInviteEmail(c.env, { email, orgName: org?.name || "a team", inviteUrl: url });
    } catch (e) {
      emailResult = { sent: false, reason: e?.message || "unknown" };
    }
    if (emailResult?.sent === false) {
      console.error("invite email not sent:", emailResult?.reason);
    }
    return c.json({ id: inv.id, inviteUrl: url, email, scopeMode, emailSent: emailResult?.sent === true });
  });

  // Revoke a pending invitation (managers only).
  app.post("/api/orgs/:orgId/invitations/:id/revoke", async (c) => {
    const userId = c.get("userId");
    const orgId = c.req.param("orgId");
    const id = c.req.param("id");
    if (!userId || !(await canManageOrg(c.env, orgId, userId))) return c.json({ error: "Forbidden" }, 403);
    await c.env.DB.prepare(
      "UPDATE org_invitations SET status = 'revoked' WHERE id = ? AND organization_id = ? AND status = 'pending'",
    ).bind(id, orgId).run();
    return c.json({ ok: true });
  });

  // Change a member's scope after the fact:
  //   { allProjects?: bool, grants?: [{projectId, role}], revokeProjectIds?: [id] }
  app.post("/api/orgs/:orgId/members/:userId/scope", async (c) => {
    const actor = c.get("userId");
    const orgId = c.req.param("orgId");
    const memberId = c.req.param("userId");
    if (!actor || !(await canManageOrg(c.env, orgId, actor))) return c.json({ error: "Forbidden" }, 403);
    const role = await orgRole(c.env, orgId, memberId);
    if (!role) return c.json({ error: "Not a member of this organization" }, 404);
    if (role === "owner") return c.json({ error: "The org owner already has full access" }, 409);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    if (typeof body?.allProjects === "boolean") {
      await setMemberAllProjects(c.env, { orgId, userId: memberId, allProjects: body.allProjects });
    }
    for (const g of Array.isArray(body?.grants) ? body.grants : []) {
      if (!g?.projectId) continue;
      // Only grant projects that live in this org.
      const owns = await c.env.DB.prepare(
        "SELECT 1 FROM projects WHERE id = ? AND organization_id = ?",
      ).bind(g.projectId, orgId).first();
      if (!owns) continue;
      await setProjectGrant(c.env, {
        projectId: g.projectId, userId: memberId, role: g.role === "viewer" ? "viewer" : "editor", grantedBy: actor,
      });
    }
    for (const pid of Array.isArray(body?.revokeProjectIds) ? body.revokeProjectIds : []) {
      await setProjectGrant(c.env, { projectId: pid, userId: memberId, role: null });
    }
    return c.json({ members: await listOrgMembers(c.env, orgId) });
  });

  // Remove a member (managers only; the owner can't be removed).
  app.delete("/api/orgs/:orgId/members/:userId", async (c) => {
    const actor = c.get("userId");
    const orgId = c.req.param("orgId");
    const memberId = c.req.param("userId");
    if (!actor || !(await canManageOrg(c.env, orgId, actor))) return c.json({ error: "Forbidden" }, 403);
    if ((await orgRole(c.env, orgId, memberId)) === "owner") return c.json({ error: "Cannot remove the org owner" }, 409);
    await removeMember(c.env, { orgId, userId: memberId });
    return c.json({ ok: true });
  });

  // Preview an invite (for the accept landing page). Requires the token; returns
  // just enough to render "Join <org> as <role>". Works without a session so the
  // page can prompt sign-in.
  app.get("/api/orgs/invitations/:id", async (c) => {
    const id = c.req.param("id");
    const token = c.req.query("token");
    const inv = await getInvitation(c.env, id);
    if (!inv || !(await tokensMatch(token, inv.token))) return c.json({ error: "Invalid invitation" }, 404);
    const expired = inv.expires_at && inv.expires_at < new Date().toISOString();
    const org = await c.env.DB.prepare("SELECT name FROM organizations WHERE id = ?").bind(inv.organization_id).first();
    return c.json({
      id: inv.id,
      organizationId: inv.organization_id,
      organizationName: org?.name || "an organization",
      email: inv.email,
      role: inv.role,
      scopeMode: inv.scope_mode,
      status: expired ? "expired" : inv.status,
    });
  });

  // Accept an invite: materialise membership + grants for the signed-in user.
  app.post("/api/orgs/invitations/:id/accept", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in to accept this invitation" }, 401);
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const inv = await getInvitation(c.env, id);
    if (!inv || !(await tokensMatch(body?.token, inv.token))) return c.json({ error: "Invalid invitation" }, 404);
    if (inv.status !== "pending") return c.json({ error: `Invitation already ${inv.status}` }, 409);
    if (inv.expires_at && inv.expires_at < new Date().toISOString()) return c.json({ error: "Invitation expired" }, 410);
    const { landingProjectId } = await acceptInvitation(c.env, inv, userId);
    return c.json({ ok: true, organizationId: inv.organization_id, landingProjectId });
  });
}
