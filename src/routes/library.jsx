import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { X, Check, Plus, ChevronLeft, ImageDown, KeyRound, Loader2, Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { connectHiggsfield } from "@/lib/higgsfieldAccount";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmModal, ErrorNote, Spinner } from "@/components/shared";
import { useShell } from "@/lib/shellContext";

/* ---------------------------------------------------------------- *
 * Asset library                                                    *
 * ---------------------------------------------------------------- */

// Loader: the folder grid + selection state. swr paints the cached payload
// instantly on a revisit; useRevalidateOnMount refreshes it once.
export function loader() {
  return swr("library", () =>
    fetch("/api/library")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        return j.folders;
      }));
}

function Library({ onView }) {
  const folders = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("library");
  const [active, setActive] = useState(null);
  const [confirm, setConfirm] = useState(null); // { type: "deselect" | "delete", im }
  const [rename, setRename] = useState(null); // image being renamed

  // Add/remove an image from final_selection, then refetch (invalidate +
  // revalidate) so the selection state reflects the server. A failed toggle is
  // a no-op — the current selection stays as it was.
  const toggle = useCallback(async (im) => {
    try {
      const res = await fetch("/api/library/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel: im.rel }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      invalidateTabCache("library");
      revalidator.revalidate();
    } catch (e) {
      console.error("library toggle failed:", e);
    }
  }, [revalidator]);

  // Delete the image from the asset library entirely (R2 original + thumb +
  // selection membership) — always behind the ConfirmModal.
  const removeAsset = useCallback(async (im) => {
    try {
      const res = await fetch("/api/library/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel: im.rel }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      invalidateTabCache("library");
      revalidator.revalidate();
    } catch (e) {
      console.error("library remove failed:", e);
    }
  }, [revalidator]);

  const af = active && folders.find((f) => f.folder === active);

  if (af) {
    const selCount = af.images.filter((i) => i.selected).length;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setActive(null)}>
            <ChevronLeft size={14} /> all folders
          </Button>
          <h2 className="text-xl font-semibold tracking-tight">{af.folder}</h2>
          <Badge variant="outline">{af.count} images</Badge>
          {selCount > 0 && <Badge variant="success">{selCount} selected</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {af.images.map((im) => (
            <figure
              key={im.rel}
              className={cn(
                "group relative overflow-hidden rounded-lg border bg-muted transition-colors",
                im.selected ? "border-primary ring-1 ring-primary/40" : "border-border"
              )}
            >
              {/* grid paints the small thumb; the full-res original only loads
                  in the view modal */}
              <button className="block w-full" onClick={() => onView({ url: im.url, name: im.rel, role: "asset" })}>
                <img src={im.thumb || im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
              </button>
              <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1.5">
                {im.selected ? (
                  <Button
                    variant="destructive" size="icon-xs"
                    className="rounded-full opacity-90"
                    title="remove from final_selection" aria-label="remove from final_selection"
                    onClick={() => setConfirm({ type: "deselect", im })}
                  >
                    <X size={13} />
                  </Button>
                ) : (
                  <Button
                    size="icon-xs"
                    className="rounded-full opacity-0 transition-opacity group-hover:opacity-90"
                    title="add to final_selection" aria-label="add to final_selection"
                    onClick={() => toggle(im)}
                  >
                    <Plus size={14} />
                  </Button>
                )}
                <Button
                  variant="secondary" size="icon-xs"
                  className="rounded-full opacity-0 transition-opacity group-hover:opacity-90"
                  title="rename" aria-label="rename"
                  onClick={() => setRename(im)}
                >
                  <Pencil size={12} />
                </Button>
                <Button
                  variant="destructive" size="icon-xs"
                  className="rounded-full opacity-0 transition-opacity group-hover:opacity-90"
                  title="delete from library" aria-label="delete from library"
                  onClick={() => setConfirm({ type: "delete", im })}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
              {im.selected && <Badge className="absolute left-1.5 top-1.5">selected</Badge>}
              <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">{im.name}</figcaption>
            </figure>
          ))}
        </div>

        <ConfirmModal
          open={!!confirm}
          title={confirm?.type === "delete" ? "Delete from library?" : "Remove from selection?"}
          message={
            !confirm ? "" : confirm.type === "delete"
              ? `"${confirm.im.name}" will be permanently deleted from the asset library${confirm.im.selected ? ", final_selection, and any shots it was assigned to" : ""}.`
              : `"${confirm.im.name}" will be removed from final_selection (and any shots it was assigned to).`
          }
          confirmLabel={confirm?.type === "delete" ? "Delete" : "Remove"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.type === "delete") removeAsset(confirm.im);
            else toggle(confirm.im);
            setConfirm(null);
          }}
        />

        {rename && (
          <RenameModal
            im={rename}
            onClose={() => setRename(null)}
            onDone={() => {
              setRename(null);
              invalidateTabCache("library");
              revalidator.revalidate();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Asset library</h2>
        <Badge variant="outline">{folders.length} folders</Badge>
        <Badge variant="success">
          {folders.reduce((a, f) => a + f.images.filter((i) => i.selected).length, 0)} selected → final_selection
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {folders.map((f) => {
          const sel = f.images.filter((i) => i.selected).length;
          return (
            <button
              key={f.folder}
              className="group overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/50"
              onClick={() => setActive(f.folder)}
            >
              <div className="relative aspect-video bg-muted">
                <img src={f.preview} loading="lazy" alt={f.folder} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                {sel > 0 && <Badge className="absolute right-2 top-2">{sel} <Check size={11} /></Badge>}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium">{f.folder}</div>
                <div className="text-xs text-muted-foreground">{f.count} images</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Rename an asset in place. Meaningful names (e.g. the character shown) beat
// the opaque Higgsfield file names when auto-assigning images on the Episode
// tab. The extension can be omitted — the server keeps the original one.
function RenameModal({ im, onClose, onDone }) {
  const [name, setName] = useState(im.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const doRename = async () => {
    if (busy || !name.trim() || name.trim() === im.name) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/library/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel: im.rel, name: name.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onDone(j);
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename asset</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <img src={im.thumb || im.url} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doRename()}
            autoFocus
            className="h-8 text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Use a name that says what the image shows (e.g. <span className="font-medium">elara_courtroom_closeup</span>)
          so it's easy to match when assigning images on the Episode tab.
        </p>
        {err && <ErrorNote>{err}</ErrorNote>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !name.trim() || name.trim() === im.name} onClick={doRename}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Import from Higgsfield                                           *
 * ---------------------------------------------------------------- */

// Basename of a Higgsfield delivery URL ("…/hf_2026…_<id>.png").
function urlBasename(u) {
  try {
    return decodeURIComponent(new URL(u).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

// Modal: pick where in the library the image lands — an existing folder or a
// brand-new one. Import copies the full-res image (and Higgsfield's ready-made
// small thumb) into the project's asset library.
function PlaceModal({ item, folders, onClose, onDone }) {
  const [folder, setFolder] = useState(folders[0]?.folder ?? "");
  const [newFolder, setNewFolder] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const dest = newFolder.trim() || folder;

  const doImport = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/higgsfield/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawUrl: item.rawUrl, minUrl: item.minUrl, folder: dest,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onDone(item, j);
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to library</DialogTitle>
        </DialogHeader>
        <div className="flex items-start gap-3">
          <img src={item.thumb || item.minUrl} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" />
          <p className="line-clamp-4 text-xs text-muted-foreground">{item.prompt || item.model}</p>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Place in folder</div>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {folders.map((f) => (
              <button
                key={f.folder}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                  !newFolder.trim() && folder === f.folder
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                )}
                onClick={() => { setFolder(f.folder); setNewFolder(""); }}
              >
                <Folder size={14} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{f.folder === "." ? "(library root)" : f.folder}</span>
                <span className="ml-auto text-xs text-muted-foreground">{f.count}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <FolderPlus size={14} className="shrink-0 text-muted-foreground" />
            <Input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="…or a new folder (e.g. higgsfield)"
              className="h-8 text-sm"
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Name (optional)</div>
          <div className="flex items-center gap-2">
            <Pencil size={14} className="shrink-0 text-muted-foreground" />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. elara_courtroom_closeup — helps Episode auto-assign"
              className="h-8 text-sm"
            />
          </div>
        </div>
        {err && <ErrorNote>{err}</ErrorNote>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !dest} onClick={doImport}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ImageDown size={14} />}
            Import{dest ? ` to ${dest === "." ? "library root" : dest}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HiggsfieldImport({ onView }) {
  const folders = useLoaderData();
  const revalidator = useRevalidator();
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [pick, setPick] = useState(null); // item awaiting a folder choice
  const [imported, setImported] = useState({}); // id -> rel (this session)
  const [confirm, setConfirm] = useState(null); // { item, rel } awaiting removal

  // Basename -> rel for everything in the library. Un-renamed imports keep the
  // Higgsfield file name, so a match means "this generation is already in the
  // library" (a custom-named import is only tracked via `imported` this session).
  const libraryByName = useMemo(() => {
    const m = new Map();
    for (const f of folders) for (const im of f.images) m.set(im.name, im.rel);
    return m;
  }, [folders]);

  const load = useCallback(async (cursor) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ size: "24" });
      if (cursor != null) qs.set("cursor", String(cursor));
      const res = await fetch(`/api/higgsfield/images?${qs}`);
      const j = await res.json();
      if (!res.ok) {
        if (res.status === 401) setNeedsAuth(true);
        throw new Error(j.error === "no_higgsfield_token" ? "No Higgsfield credential" : j.error || `HTTP ${res.status}`);
      }
      setItems((prev) => (cursor != null ? [...prev, ...j.items] : j.items));
      setNextCursor(j.nextCursor ?? null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onImported = useCallback((item, j) => {
    setImported((m) => ({ ...m, [item.id]: j.rel }));
    setPick(null);
    invalidateTabCache("library");
    revalidator.revalidate();
  }, [revalidator]);

  // Undo an import: delete the copied asset from the library (the Higgsfield
  // generation itself is untouched) so the tile goes back to its plus button.
  const removeImport = useCallback(async ({ item, rel }) => {
    try {
      const res = await fetch("/api/library/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setImported((m) => {
        if (!(item.id in m)) return m;
        const next = { ...m };
        delete next[item.id];
        return next;
      });
      invalidateTabCache("library");
      revalidator.revalidate();
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [revalidator]);

  if (needsAuth) {
    // Expired/missing Higgsfield credential: re-run the LINK flow in place —
    // it refreshes the token stored on the current user's linked Higgsfield
    // account row without touching the (Google) app session. A sign-in here
    // would instead switch the session to the Higgsfield-identified user.
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>Your Higgsfield connection expired. Reconnect it to browse your generated images here.</p>
        <Button onClick={() => connectHiggsfield("/library").catch(() => {})}>
          <KeyRound size={14} /> Reconnect Higgsfield
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Import from Higgsfield</h2>
        <Badge variant="outline">{items.length} loaded</Badge>
        <span className="text-xs text-muted-foreground">
          Your Higgsfield image generations, newest first. Add one to the library with its plus button.
        </span>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((it) => {
          // Truthy = the library rel of this generation's imported copy.
          const inLibrary = imported[it.id] || libraryByName.get(urlBasename(it.rawUrl)) || null;
          return (
            <figure
              key={it.id}
              className={cn(
                "group relative overflow-hidden rounded-lg border bg-muted transition-colors",
                inLibrary ? "border-primary ring-1 ring-primary/40" : "border-border"
              )}
            >
              <button
                className="block w-full"
                onClick={() => onView({ url: it.rawUrl, name: it.prompt || it.id, role: "asset" })}
              >
                <img src={it.thumb || it.minUrl} loading="lazy" alt={it.prompt || it.model} className="aspect-square w-full object-cover" />
              </button>
              {inLibrary ? (
                <>
                  <Badge className="absolute left-1.5 top-1.5"><Check size={11} /> in library</Badge>
                  <Button
                    variant="destructive" size="icon-xs"
                    className="absolute right-1.5 top-1.5 rounded-full opacity-0 transition-opacity group-hover:opacity-90"
                    title="remove from library" aria-label="remove from library"
                    onClick={() => setConfirm({ item: it, rel: inLibrary })}
                  >
                    <Trash2 size={12} />
                  </Button>
                </>
              ) : (
                <Button
                  size="icon-xs"
                  className="absolute right-1.5 top-1.5 rounded-full opacity-0 transition-opacity group-hover:opacity-90"
                  title="add to library" aria-label="add to library"
                  onClick={() => setPick(it)}
                >
                  <Plus size={14} />
                </Button>
              )}
              <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">
                {it.prompt || it.model}
              </figcaption>
            </figure>
          );
        })}
      </div>

      {loading && items.length === 0 && <Spinner />}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No completed image generations found on your Higgsfield account.
        </div>
      )}
      {nextCursor != null && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => load(nextCursor)}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : null} Load more
          </Button>
        </div>
      )}

      {pick && (
        <PlaceModal
          item={pick}
          folders={folders}
          onClose={() => setPick(null)}
          onDone={onImported}
        />
      )}

      <ConfirmModal
        open={!!confirm}
        title="Remove from library?"
        message={confirm ? `"${confirm.rel}" will be deleted from the asset library (and dropped from final_selection if it was selected). The Higgsfield generation itself is untouched.` : ""}
        confirmLabel="Remove"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          removeImport(confirm);
          setConfirm(null);
        }}
      />
    </div>
  );
}

export { Library };

export function Component() {
  const { setModalImage } = useShell();
  return (
    <Tabs defaultValue="library">
      <TabsList className="mb-4">
        <TabsTrigger value="library">Library</TabsTrigger>
        <TabsTrigger value="higgsfield">Import from Higgsfield</TabsTrigger>
      </TabsList>
      <TabsContent value="library">
        <Library onView={setModalImage} />
      </TabsContent>
      <TabsContent value="higgsfield">
        <HiggsfieldImport onView={setModalImage} />
      </TabsContent>
    </Tabs>
  );
}
