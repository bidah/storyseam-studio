import React, { useState } from "react";
import { useNavigate } from "react-router";
import { HOME_PATH } from "@/lib/home";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus, Pencil, Trash2 } from "lucide-react";
import { useProjects } from "@/components/ProjectProvider";

// Top-left header control: shows the current project and a dropdown to switch,
// create, rename, or delete projects. Modeled on the Script tab's DraftControls.
export default function ProjectSwitcher({ className }) {
  const { projects, current, currentId, loading, switchTo, rename, remove } = useProjects();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode: "create" | "rename" }
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // A new project is a new STORY: the prompt box at `/` makes the project
  // around the Film, so "New project" is the way there, not a blank-project form.
  const openCreate = () => { setOpen(false); navigate(HOME_PATH); };
  const openRename = () => { setName(current?.name || ""); setErr(null); setDialog({ mode: "rename" }); };
  const closeDialog = () => { if (!busy) setDialog(null); };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setErr("Name is required"); return; }
    setBusy(true); setErr(null);
    try {
      await rename(currentId, trimmed);
      setDialog(null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!current) return;
    if (!window.confirm(`Delete project "${current.name}"? Its script and pipeline data will be archived.`)) return;
    setBusy(true);
    try { await remove(currentId); } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };

  const canDelete = current && current.id !== "p_default" && projects.length > 1;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch project"
            className={cn(
              "flex h-9 w-[202px] min-w-[202px] max-w-[202px] shrink-0 items-center gap-2 rounded-md border bg-background px-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">
              {loading ? "loading…" : current?.name || "Select…"}
            </span>
            <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="header-menu w-64">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => switchTo(p.id)} className="gap-2">
              <Check size={14} className={p.id === currentId ? "opacity-100" : "opacity-0"} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openCreate} className="gap-2">
            <Plus size={14} /> New story
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openRename} disabled={!current} className="gap-2">
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
            <DialogTitle>{dialog?.mode === "create" ? "New project" : "Rename project"}</DialogTitle>
            <DialogDescription>
              {dialog?.mode === "create"
                ? "Creates a blank project — its own script, shot list, sounds, and timeline."
                : "Give this project a new name."}
            </DialogDescription>
          </DialogHeader>
          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              {err}
            </div>
          )}
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={dialog?.mode === "create" ? "Untitled project" : "Project name"}
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
