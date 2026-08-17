// The fallback leg of the invite flow. A signed-out visitor who clicks an invite
// email can't accept on the spot (accepting needs an identity), and the invite id
// + token get lost across the Google OAuth redirect and the post-login
// provider-connect gate — so lib/pendingInvite stashes them in localStorage the
// moment the URL is seen. This modal, mounted inside the signed-in app shell,
// picks that up on first entry and offers to accept, dropping the user onto the
// project they were granted. See routes/accept-invite.jsx for the direct path
// (already-signed-in users who land on /accept-invite handle it there).
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Users, Check, Loader2, Globe, FolderClosed } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/shared";
import { useProjects } from "@/components/ProjectProvider";
import { readPendingInvite, clearPendingInvite } from "@/lib/pendingInvite";

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

export default function PendingInviteModal() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refresh, switchTo } = useProjects();

  // Read once on mount — invites arrive via a fresh page load, so there's no
  // need to react to later localStorage changes.
  const [invite] = useState(readPendingInvite);
  const [preview, setPreview] = useState(null);
  const [open, setOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);

  // If the user is on the dedicated /accept-invite page, that route owns the
  // flow — don't double up with the modal.
  const onAcceptPage = location.pathname.startsWith("/accept-invite/");

  useEffect(() => {
    if (!invite || onAcceptPage) return;
    let alive = true;
    (async () => {
      try {
        const p = await apiJson(
          `/api/orgs/invitations/${invite.id}?token=${encodeURIComponent(invite.token)}`,
        );
        if (!alive) return;
        // Already accepted / revoked / expired since it was stashed — clear it
        // silently rather than nagging with a dead card.
        if (p.status !== "pending") { clearPendingInvite(); return; }
        setPreview(p);
        setOpen(true);
      } catch {
        // A missing or malformed invite isn't worth surfacing — drop it.
        if (alive) clearPendingInvite();
      }
    })();
    return () => { alive = false; };
  }, [invite, onAcceptPage]);

  const dismiss = useCallback(() => {
    clearPendingInvite();
    setOpen(false);
  }, []);

  const accept = useCallback(async () => {
    if (!invite) return;
    setAccepting(true); setError(null);
    try {
      const res = await apiJson(
        `/api/orgs/invitations/${invite.id}/accept`, "POST", { token: invite.token },
      );
      clearPendingInvite();
      await refresh();
      // Drop the invitee onto the project they were just granted rather than the
      // empty personal project they were parked on — switchTo persists the pick.
      if (res.landingProjectId) await switchTo(res.landingProjectId);
      setOpen(false);
      navigate("/world");
    } catch (e) {
      setError(String(e.message || e));
      setAccepting(false);
    }
  }, [invite, refresh, switchTo, navigate]);

  if (!invite || !preview) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:text-center">
          <div className="mx-auto mb-1 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users size={22} />
          </div>
          <DialogTitle>Join {preview.organizationName}</DialogTitle>
          <DialogDescription>
            You’ve been invited as {preview.role === "admin" ? "an admin" : "a member"}
            {preview.role !== "admin" && (
              <>
                {" "}with access to{" "}
                {preview.scopeMode === "all" ? (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Globe size={13} /> all projects
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <FolderClosed size={13} /> selected projects
                  </span>
                )}
              </>
            )}.
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorNote>{error}</ErrorNote>}
        <DialogFooter className="sm:justify-center">
          <Button variant="ghost" onClick={dismiss} disabled={accepting}>
            Not now
          </Button>
          <Button onClick={accept} disabled={accepting}>
            {accepting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Accept invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
