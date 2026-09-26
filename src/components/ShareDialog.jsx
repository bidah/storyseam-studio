// Project-level Share dialog — one public, read-only link with two independently
// toggled surfaces: the SCRIPT (with a chosen draft) and the written WORLD. Both
// tabs live behind the SAME canonical link (/share/<token>); `?tab=script|world`
// deep-links to one. Used by BOTH the Script tab (ScriptEditor) and the World tab
// (routes/world/written.jsx), so it is fully self-loading — it fetches its own
// state from /api/share-config and needs nothing from whichever tab opened it.
//
// The public viewer is src/routes/share.jsx (outside the login gate); the worker
// half is routes/share-config.js (authed) + routes/share.js (public read).
import { useEffect, useState } from "react";
import {
  Share2, Copy, Check, ExternalLink, Loader2, GitBranch, ChevronDown,
  ScrollText, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useT, t as staticT } from "@/lib/i18n";

// A read-only link field with copy + open-in-new-tab buttons.
function LinkRow({ url }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url || ""} className="h-8 text-xs" onFocus={(e) => e.target.select()} />
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 shrink-0"
        disabled={!url}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch { /* clipboard blocked — the link is still selectable in the field */ }
        }}
      >
        {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
        {copied ? t("Copied") : t("Copy")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0"
        disabled={!url}
        aria-label={t("Open the shared view in a new tab")}
        onClick={() => window.open(url, "_blank", "noopener")}
      >
        <ExternalLink size={13} />
      </Button>
    </div>
  );
}

export default function ShareDialog({
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName = "h-7 gap-1.5 text-xs",
  label,
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null); // null = loading; object once loaded
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Load current state whenever the dialog opens (never mints anything — a link
  // only exists once the author flips a switch on).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCfg(null);
    setErr(null);
    (async () => {
      try {
        const d = await fetch("/api/share-config").then((r) => r.json());
        if (d.error) throw new Error(d.error);
        if (alive) setCfg(d);
      } catch (e) {
        if (alive) setErr(String(e.message || e));
      }
    })();
    return () => { alive = false; };
  }, [open]);

  // Every mutation is a merge-patch PUT that returns the fresh view.
  const apply = async (patch) => {
    setBusy(true);
    setErr(null);
    try {
      const d = await fetch("/api/share-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setCfg(d);
    } catch (e) {
      setErr(String(e.message || e || staticT("Couldn't update sharing")));
    } finally {
      setBusy(false);
    }
  };

  const drafts = cfg?.drafts || [];
  const selectedId =
    (cfg?.draftId && drafts.some((d) => d.id === cfg.draftId) && cfg.draftId) || cfg?.pinnedId;
  const selectedName = drafts.find((d) => d.id === selectedId)?.name || t("Pinned draft");
  const anyShared = !!cfg?.token;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
          title={t("Share a public read-only view of this project")}
        >
          <Share2 size={13} />
          {label ?? t("Share")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 size={16} /> {t("Share project")}
          </DialogTitle>
          <DialogDescription>
            {t("Create a public, read-only link. Anyone with it sees only the tabs you turn on — no editing.")}
          </DialogDescription>
        </DialogHeader>

        {err ? <p className="text-sm text-destructive" role="alert">{err}</p> : null}

        {!cfg && !err ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> {t("Loading…")}
          </p>
        ) : cfg ? (
          <>
            {/* Script surface */}
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <ScrollText size={15} className="shrink-0 text-muted-foreground" />
                <Label htmlFor="share-script" className="flex-1 text-sm font-medium">{t("Script")}</Label>
                <Switch
                  id="share-script"
                  checked={cfg.script}
                  disabled={busy}
                  onCheckedChange={(on) => apply({ script: on })}
                />
              </div>
              {cfg.script && (
                <div className="mt-3 space-y-2">
                  {/* Which draft the link shows. */}
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">{t("Version")}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 flex-1 justify-between gap-1.5 text-xs" disabled={busy}>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <GitBranch size={13} className="shrink-0 text-muted-foreground" />
                            <span className="truncate">{selectedName}</span>
                            {selectedId === cfg.pinnedId && (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">{t("pinned")}</Badge>
                            )}
                          </span>
                          {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} className="shrink-0 opacity-60" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-h-64 w-[--radix-dropdown-menu-trigger-width] overflow-y-auto">
                        {drafts.map((d) => (
                          <DropdownMenuItem key={d.id} onClick={() => apply({ draftId: d.id })} className="flex items-center gap-2 text-xs">
                            {d.id === selectedId ? (
                              <Check size={13} className="shrink-0 text-primary" />
                            ) : (
                              <span className="w-[13px] shrink-0" />
                            )}
                            <span className="truncate">{d.name}</span>
                            {d.pinned && <Badge variant="secondary" className="shrink-0 text-[10px]">{t("pinned")}</Badge>}
                            <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">{d.lineCount} {t("lines")}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <LinkRow url={cfg.scriptUrl} />
                </div>
              )}
            </div>

            {/* World surface */}
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Globe size={15} className="shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <Label htmlFor="share-world" className="text-sm font-medium">{t("World")}</Label>
                  <p className="text-[11px] text-muted-foreground">{t("The written world — story, characters, locations.")}</p>
                </div>
                <Switch
                  id="share-world"
                  checked={cfg.world}
                  disabled={busy}
                  onCheckedChange={(on) => apply({ world: on })}
                />
              </div>
              {cfg.world && <div className="mt-3"><LinkRow url={cfg.worldUrl} /></div>}
            </div>

            {/* Canonical link — opens to whichever tabs are on. Shown once at least
                one surface is live and both are on (otherwise the per-surface link
                above already IS the canonical link). */}
            {anyShared && cfg.script && cfg.world && (
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("Both tabs")}</span>
                <LinkRow url={cfg.url} />
              </div>
            )}
          </>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={!anyShared || busy}
            onClick={() => apply({ script: false, world: false })}
          >
            {t("Stop sharing")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            {t("Done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
