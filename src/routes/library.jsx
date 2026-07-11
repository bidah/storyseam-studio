import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { X, Check, Plus, ChevronLeft, ImageDown, Loader2, Folder, FolderPlus } from "lucide-react";
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
  const [confirm, setConfirm] = useState(null);

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
              {im.selected ? (
                <Button
                  variant="destructive" size="icon-xs"
                  className="absolute right-1.5 top-1.5 rounded-full opacity-90"
                  title="remove from final_selection" aria-label="remove from final_selection"
                  onClick={() => setConfirm(im)}
                >
                  <X size={13} />
                </Button>
              ) : (
                <Button
                  size="icon-xs"
                  className="absolute right-1.5 top-1.5 rounded-full opacity-0 transition-opacity group-hover:opacity-90"
                  title="add to final_selection" aria-label="add to final_selection"
                  onClick={() => toggle(im)}
                >
                  <Plus size={14} />
                </Button>
              )}
              {im.selected && <Badge className="absolute left-1.5 top-1.5">selected</Badge>}
              <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">{im.name}</figcaption>
            </figure>
          ))}
        </div>

        <ConfirmModal
          open={!!confirm}
          title="Remove from selection?"
          message={confirm ? `"${confirm.name}" will be removed from final_selection (and any shots it was assigned to).` : ""}
          confirmLabel="Remove"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            toggle(confirm);
            setConfirm(null);
          }}
        />
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
        body: JSON.stringify({ rawUrl: item.rawUrl, minUrl: item.minUrl, folder: dest }),
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
          <img src={item.thumb || item.minUrl} alt="" className="h-20 w-20 shrink-0 rounded-md border object-cover" />
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

  // Basenames already in the library — imported files keep the Higgsfield file
  // name, so a match means "this generation is already in the library".
  const libraryNames = useMemo(() => {
    const s = new Set();
    for (const f of folders) for (const im of f.images) s.add(im.name);
    return s;
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

  if (needsAuth) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Sign in with Higgsfield to browse your generated images here.
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
          const inLibrary = imported[it.id] || libraryNames.has(urlBasename(it.rawUrl));
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
                <Badge className="absolute left-1.5 top-1.5"><Check size={11} /> in library</Badge>
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
