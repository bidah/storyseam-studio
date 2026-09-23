import React, { useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, Plus, Pencil, Trash2, Clapperboard } from "lucide-react";
import { useEpisodes } from "@/components/EpisodeProvider";

// Header control next to the ProjectSwitcher, shown ONLY for a series. Switching
// episode re-points the whole downstream pipeline; the world bible is shared.
// Modeled on ProjectSwitcher.
export default function EpisodeSwitcher() {
  const {
    episodes, isSeries, active, activeId, loading,
    switchEpisode, createEpisode, renameEpisode, removeEpisode,
  } = useEpisodes();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode: "create" | "rename" }
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // A feature film has one implicit episode — no switcher.
  if (!isSeries) return null;

  const openCreate = () => { setTitle(""); setErr(null); setDialog({ mode: "create" }); };
  const openRename = () => { setTitle(active?.title || ""); setErr(null); setDialog({ mode: "rename" }); };
  const closeDialog = () => { if (!busy) setDialog(null); };

  const submit = async () => {
    const trimmed = title.trim();
    if (dialog.mode === "rename" && !trimmed) { setErr("Title is required"); return; }
    setBusy(true); setErr(null);
    try {
      if (dialog.mode === "create") await createEpisode(trimmed);
      else await renameEpisode(activeId, trimmed);
      setDialog(null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!active) return;
    if (!window.confirm(`Delete "${active.title}"? Its script and pipeline data are kept but hidden.`)) return;
    setBusy(true);
    try { await removeEpisode(activeId); } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };

  const canDelete = active && active.id !== "ep1" && episodes.length > 1;
  const label = active ? `Ep ${active.number} · ${active.title}` : "Episode…";

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch episode"
            className="flex h-9 w-[180px] min-w-[180px] max-w-[180px] shrink-0 items-center gap-2 rounded-md border bg-background px-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Clapperboard size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">
              {loading ? "loading…" : label}
            </span>
            <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="header-menu w-64">
          <DropdownMenuLabel>Episodes</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {episodes.map((e) => (
            <DropdownMenuItem key={e.id} onClick={() => switchEpisode(e.id)} className="gap-2">
              <Check size={14} className={e.id === activeId ? "opacity-100" : "opacity-0"} />
              <span className="min-w-0 flex-1 truncate">Ep {e.number} · {e.title}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openCreate} className="gap-2">
            <Plus size={14} /> New episode
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openRename} disabled={!active} className="gap-2">
            <Pencil size={14} /> Rename current
          </DropdownMenuItem>
          <DropdownMenuItem onClick={del} disabled={!canDelete} variant="destructive" className="gap-2">
            <Trash2 size={14} /> Delete current
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!dialog} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "create" ? "New episode" : "Rename episode"}</DialogTitle>
            <DialogDescription>
              {dialog?.mode === "create"
                ? "Creates a new episode — its own script, shot list, animatic and cut. The world bible (title, story map, locations, character library) is shared; anchored characters are carried in."
                : "Give this episode a new title."}
            </DialogDescription>
          </DialogHeader>
          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              {err}
            </div>
          )}
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={dialog?.mode === "create" ? "Episode title (optional)" : "Episode title"}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Saving…" : dialog?.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
