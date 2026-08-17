// Invite acceptance landing (/accept-invite/:id?token=…). A RootLayout child, so
// LoginGate guarantees a signed-in user before we get here — accepting an invite
// requires an identity to attach the membership to. On accept we materialise the
// org membership + project grants (routes/orgs.js), refresh the project list so
// the newly shared projects appear, and drop the user into the app.
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Users, Check, Loader2, Globe, FolderClosed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, ErrorNote, Spinner } from "@/components/shared";
import { useProjects } from "@/components/ProjectProvider";
import { clearPendingInvite } from "@/lib/pendingInvite";

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

export function Component() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { refresh, switchTo } = useProjects();

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setPreview(await apiJson(`/api/orgs/invitations/${id}?token=${encodeURIComponent(token)}`));
      } catch (e) { setError(String(e.message || e)); }
      finally { setLoading(false); }
    })();
  }, [id, token]);

  const accept = useCallback(async () => {
    setAccepting(true); setError(null);
    try {
      const res = await apiJson(`/api/orgs/invitations/${id}/accept`, "POST", { token });
      clearPendingInvite(); // this page handled it — don't let the modal replay it
      await refresh();
      // Drop the invitee onto the project they were just granted, not the empty
      // personal project they were parked on — switchTo also persists the pick so
      // a reload stays there. `/world` reads the newly-active project.
      if (res.landingProjectId) await switchTo(res.landingProjectId);
      navigate("/world");
    } catch (e) { setError(String(e.message || e)); setAccepting(false); }
  }, [id, token, refresh, switchTo, navigate]);

  if (loading) return <div className="flex h-full items-center justify-center py-24"><Spinner /></div>;

  const dead = preview && preview.status !== "pending";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-16">
      <Panel className="w-full p-6 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users size={22} />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {!preview && !error && <p className="text-sm text-muted-foreground">This invitation could not be found.</p>}
        {preview && (
          <>
            <h1 className="text-lg font-semibold">
              Join {preview.organizationName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You’re invited as {preview.role === "admin" ? "an admin" : "a member"}
              {preview.role !== "admin" && (
                <> with access to{" "}
                  {preview.scopeMode === "all"
                    ? <span className="inline-flex items-center gap-1 font-medium text-foreground"><Globe size={13} /> all projects</span>
                    : <span className="inline-flex items-center gap-1 font-medium text-foreground"><FolderClosed size={13} /> selected projects</span>}
                </>
              )}.
            </p>
            {dead ? (
              <p className="mt-4 text-sm text-muted-foreground">This invitation is {preview.status}.</p>
            ) : (
              <Button className="mt-5 w-full" onClick={accept} disabled={accepting}>
                {accepting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Accept invitation
              </Button>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
