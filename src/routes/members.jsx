// Team & access — opened from the header avatar menu (not a top tab).
//
// The tenant model: every user has a PERSONAL organization that owns the
// projects they create, and can belong to other people's orgs too. Here an
// org's owner/admin invites people and picks a SCOPE per person — the whole
// workspace ("all projects", current and future) or a hand-picked SELECTION of
// projects as editor or viewer. Backed entirely by /api/orgs* (routes/orgs.js);
// the same capability is available to the flue agent via the team-access skill.
//
// Not project-scoped, so this screen fetches on mount (like a settings surface)
// rather than through a per-tab swr loader.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, Mail, Link2, Copy, Check, Trash2, Shield, ShieldCheck, Loader2, FolderClosed, Globe, Eye, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Eyebrow, Panel, ErrorNote, Spinner } from "@/components/shared";

async function apiJson(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed`);
  return data;
}

const initials = (m) => (m.name || m.email || "?").trim().charAt(0).toUpperCase();

// A short human summary of what one member can reach.
function scopeSummary(m) {
  if (m.role === "owner") return "Owner · full access";
  if (m.role === "admin") return "Admin · all projects";
  if (m.allProjects) return "All projects";
  const n = m.grants?.length || 0;
  return n ? `${n} project${n === 1 ? "" : "s"}` : "No projects yet";
}

// One copy-to-clipboard row for a freshly created invite link.
function InviteLink({ url }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/40 p-2">
      <Link2 size={14} className="shrink-0 text-muted-foreground" />
      <code className="flex-1 truncate text-xs">{url}</code>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

export function Component() {
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(null);
  const [members, setMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const org = useMemo(() => orgs.find((o) => o.id === orgId) || null, [orgs, orgId]);
  const canManage = org && (org.role === "owner" || org.role === "admin");

  // Invite form state
  const [email, setEmail] = useState("");
  const [scopeMode, setScopeMode] = useState("selection"); // "all" | "selection"
  const [pickedProjects, setPickedProjects] = useState(() => new Set());
  const [projectRole, setProjectRole] = useState("editor");
  const [asAdmin, setAsAdmin] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [lastInvite, setLastInvite] = useState(null);
  const [formError, setFormError] = useState(null);

  const loadOrgs = useCallback(async () => {
    const { orgs: list } = await apiJson("/api/orgs");
    setOrgs(list || []);
    setOrgId((cur) => cur || list?.[0]?.id || null);
    return list || [];
  }, []);

  const loadOrg = useCallback(async (id) => {
    if (!id) return;
    const membersP = apiJson(`/api/orgs/${id}/members`).then((r) => setMembers(r.members || []));
    // Projects + invitations are manager-only; ignore 403 for plain members.
    const projectsP = apiJson(`/api/orgs/${id}/projects`).then((r) => setProjects(r.projects || [])).catch(() => setProjects([]));
    const invitesP = apiJson(`/api/orgs/${id}/invitations`).then((r) => setInvites(r.invitations || [])).catch(() => setInvites([]));
    await Promise.all([membersP, projectsP, invitesP]);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const list = await loadOrgs();
        if (list[0]) await loadOrg(orgId || list[0].id);
      } catch (e) { setError(String(e.message || e)); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-load the roster when the selected org changes.
  useEffect(() => { if (orgId) loadOrg(orgId).catch((e) => setError(String(e.message || e))); }, [orgId, loadOrg]);

  const toggleProject = (id) => setPickedProjects((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const submitInvite = async () => {
    setFormError(null); setLastInvite(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setFormError("Enter a valid email address."); return; }
    if (!asAdmin && scopeMode === "selection" && pickedProjects.size === 0) {
      setFormError("Pick at least one project, or choose “All projects”."); return;
    }
    setInviting(true);
    try {
      const body = {
        email: email.trim().toLowerCase(),
        role: asAdmin ? "admin" : "member",
        scopeMode: asAdmin ? "all" : scopeMode,
        projectIds: scopeMode === "selection" ? [...pickedProjects] : [],
        projectRole,
      };
      const res = await apiJson(`/api/orgs/${orgId}/invitations`, "POST", body);
      setLastInvite(res);
      setEmail(""); setPickedProjects(new Set()); setAsAdmin(false);
      await loadOrg(orgId);
    } catch (e) { setFormError(String(e.message || e)); }
    finally { setInviting(false); }
  };

  const setScope = async (memberId, patch) => {
    try {
      const { members: next } = await apiJson(`/api/orgs/${orgId}/members/${memberId}/scope`, "POST", patch);
      setMembers(next || []);
    } catch (e) { setError(String(e.message || e)); }
  };

  const removeMember = async (memberId) => {
    try {
      await apiJson(`/api/orgs/${orgId}/members/${memberId}`, "DELETE");
      await loadOrg(orgId);
    } catch (e) { setError(String(e.message || e)); }
  };

  const revokeInvite = async (id) => {
    try {
      await apiJson(`/api/orgs/${orgId}/invitations/${id}/revoke`, "POST");
      setInvites((prev) => prev.filter((i) => i.id !== id));
    } catch (e) { setError(String(e.message || e)); }
  };

  if (loading) return <div className="flex h-full items-center justify-center py-24"><Spinner /></div>;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-primary" />
          <h1 className="text-xl font-semibold">Team &amp; access</h1>
        </div>
        {orgs.length > 1 && (
          <Select value={orgId || ""} onValueChange={setOrgId}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}{o.personal ? " (personal)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Invite */}
      {canManage && (
        <Panel className="mb-6">
          <Eyebrow>Invite someone</Eyebrow>
          <p className="mb-3 text-sm text-muted-foreground">
            They join <span className="font-medium text-foreground">{org?.name}</span>. Choose how much of it they can see.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor="invite-email" className="mb-1 block text-xs">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Checkbox checked={asAdmin} onCheckedChange={(v) => setAsAdmin(!!v)} />
              <span className="flex items-center gap-1"><ShieldCheck size={14} /> Make admin (full access)</span>
            </label>
          </div>

          {!asAdmin && (
            <div className="mt-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={scopeMode === "all" ? "default" : "outline"}
                  onClick={() => setScopeMode("all")}
                >
                  <Globe size={14} /> All projects
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={scopeMode === "selection" ? "default" : "outline"}
                  onClick={() => setScopeMode("selection")}
                >
                  <FolderClosed size={14} /> Selected projects
                </Button>
              </div>

              {scopeMode === "selection" && (
                <div className="mt-3 rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Pick the projects they can open</span>
                    <Select value={projectRole} onValueChange={setProjectRole}>
                      <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid max-h-56 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
                    {projects.length === 0 && <span className="text-xs text-muted-foreground">No projects in this workspace yet.</span>}
                    {projects.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                        <Checkbox checked={pickedProjects.has(p.id)} onCheckedChange={() => toggleProject(p.id)} />
                        <span className="truncate">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {formError && <ErrorNote>{formError}</ErrorNote>}
          <div className="mt-4">
            <Button onClick={submitInvite} disabled={inviting}>
              {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Create invite
            </Button>
          </div>
          {lastInvite?.inviteUrl && <InviteLink url={lastInvite.inviteUrl} />}
        </Panel>
      )}

      {/* Members */}
      <Panel className="mb-6">
        <Eyebrow>Members</Eyebrow>
        <div className="mt-2 divide-y">
          {members.map((m) => (
            <div key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                {initials(m)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{m.name || m.email || m.userId}</span>
                  {m.role === "owner" && <Badge variant="muted"><Shield size={11} /> Owner</Badge>}
                  {m.role === "admin" && <Badge variant="info"><ShieldCheck size={11} /> Admin</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{m.email} · {scopeSummary(m)}</div>
              </div>

              {canManage && m.role === "member" && (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Globe size={13} /> All projects
                    <Switch
                      checked={m.allProjects}
                      onCheckedChange={(v) => setScope(m.userId, { allProjects: !!v })}
                    />
                  </label>
                  <Button size="icon" variant="ghost" aria-label="Remove member" onClick={() => removeMember(m.userId)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Per-project grants for scoped members */}
        {canManage && members.some((m) => m.role === "member" && !m.allProjects) && projects.length > 0 && (
          <>
            <Separator className="my-4" />
            <Eyebrow>Project access</Eyebrow>
            <p className="mb-2 text-xs text-muted-foreground">
              Give a member specific projects (they don’t have “All projects”).
            </p>
            <div className="space-y-3">
              {members.filter((m) => m.role === "member" && !m.allProjects).map((m) => {
                const granted = new Map((m.grants || []).map((g) => [g.projectId, g.role]));
                return (
                  <div key={m.userId} className="rounded-md border p-3">
                    <div className="mb-2 text-sm font-medium">{m.name || m.email}</div>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {projects.map((p) => {
                        const role = granted.get(p.id);
                        const on = !!role;
                        return (
                          <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                            <Checkbox
                              checked={on}
                              onCheckedChange={(v) =>
                                v
                                  ? setScope(m.userId, { grants: [{ projectId: p.id, role: "editor" }] })
                                  : setScope(m.userId, { revokeProjectIds: [p.id] })
                              }
                            />
                            <span className="flex-1 truncate">{p.name}</span>
                            {on && (
                              <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => setScope(m.userId, { grants: [{ projectId: p.id, role: role === "viewer" ? "editor" : "viewer" }] })}
                                title="Toggle editor / viewer"
                              >
                                {role === "viewer" ? <><Eye size={12} /> Viewer</> : <><Pencil size={12} /> Editor</>}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>

      {/* Pending invitations */}
      {canManage && invites.length > 0 && (
        <Panel>
          <Eyebrow>Pending invitations</Eyebrow>
          <div className="mt-2 divide-y">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center gap-3 py-2">
                <Mail size={14} className="text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.role === "admin" ? "Admin" : i.scope_mode === "all" ? "All projects" : "Selected projects"}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => revokeInvite(i.id)}>Revoke</Button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
