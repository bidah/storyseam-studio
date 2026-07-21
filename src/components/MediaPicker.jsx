import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ImagePlus, Library, Sparkles, Upload, Loader2, X, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Empty, Spinner, ErrorNote } from "@/components/shared";

/* ------------------------------------------------------------------ *
 * MediaPicker — one shared modal for picking reference images from    *
 * three sources: the asset library (Gallery), Visual World            *
 * generations, and the user's computer (Upload). Reused by the chat   *
 * composer, the Visual World reference button, and the written-world  *
 * character-sheet picker.                                             *
 *                                                                     *
 * Emits a normalized item to `onAdd(items[])`:                        *
 *   { source: "library"|"generation"|"upload",                        *
 *     rel?, genId?,          // source key (library rel / gen id)      *
 *     url,                   // in-app serve path (or object URL)      *
 *     refUrl?,               // ungated absolute /files URL            *
 *     thumb, name, file? }   // file only present for uploads          *
 *                                                                     *
 * `multiple` (default true) toggles checkbox-then-Add vs click-to-add.*
 * `sources` limits which tabs appear (default all three).             *
 * ------------------------------------------------------------------ */

// Where PC uploads go — same R2-backed endpoint the chat composer uses. Returns
// an ungated absolute `/files/...` url an external fetcher (Higgsfield) can read.
const UPLOAD_ENDPOINT = import.meta.env.VITE_UPLOAD_URL || "/api/upload";

const GRID = "grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5";

// A single selectable thumbnail. Shows a check overlay when picked.
function Tile({ url, name, caption, badge, picked, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted text-left transition-colors",
        picked ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/60",
      )}
      title={caption || name}
    >
      <img src={url} loading="lazy" alt={name} className="aspect-square w-full object-cover" />
      {badge && <Badge className="absolute left-1 top-1 px-1.5 py-0 text-[9px]">{badge}</Badge>}
      {picked && (
        <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          <Check size={13} />
        </span>
      )}
      {(caption || name) && (
        <div className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{caption || name}</div>
      )}
    </button>
  );
}

export default function MediaPicker({
  open,
  onOpenChange,
  onAdd,
  multiple = true,
  sources = ["library", "generation", "upload"],
  title = "Add a reference image",
}) {
  const [tab, setTab] = useState(sources[0] || "library");
  const [q, setQ] = useState("");

  // Library (asset gallery).
  const [folders, setFolders] = useState(null); // null = loading
  const [libErr, setLibErr] = useState(null);

  // Visual World generations.
  const [gens, setGens] = useState(null);
  const [genErr, setGenErr] = useState(null);

  // Staged PC uploads (each optimistic, then resolves to a durable url).
  const [uploads, setUploads] = useState([]);
  const fileInputRef = useRef(null);

  // Multi-select tray, keyed by a stable id. Value is the normalized item.
  const [picked, setPicked] = useState(() => new Map());

  const hasLib = sources.includes("library");
  const hasGen = sources.includes("generation");
  const hasUpload = sources.includes("upload");

  // Reset everything when the dialog opens, and lazily fetch each source.
  useEffect(() => {
    if (!open) return;
    setTab(sources[0] || "library");
    setQ("");
    setPicked(new Map());
    // Revoke any stale object URLs from a previous session.
    setUploads((prev) => { prev.forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl)); return []; });

    let cancelled = false;
    if (hasLib) {
      setFolders(null); setLibErr(null);
      fetch("/api/library")
        .then((r) => r.json())
        .then((j) => { if (cancelled) return; if (j.error) throw new Error(j.error); setFolders(j.folders || []); })
        .catch((e) => { if (!cancelled) setLibErr(String(e.message || e)); });
    }
    if (hasGen) {
      setGens(null); setGenErr(null);
      fetch("/api/visual-world")
        .then((r) => r.json())
        .then((j) => { if (cancelled) return; if (j.error) throw new Error(j.error); setGens(j.generations || []); })
        .catch((e) => { if (!cancelled) setGenErr(String(e.message || e)); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Library images, flattened + folder-tagged, selected surfaced first, filtered.
  const libImages = useMemo(() => {
    const all = (folders || []).flatMap((f) => f.images.map((im) => ({ ...im, folder: f.folder })));
    const term = q.trim().toLowerCase();
    const filtered = term ? all.filter((im) => `${im.name} ${im.folder}`.toLowerCase().includes(term)) : all;
    // Selected (final_selection) images first, otherwise stable.
    return filtered.slice().sort((a, b) => (b.selected ? 1 : 0) - (a.selected ? 1 : 0));
  }, [folders, q]);

  // Only fully-rendered ("ready") generations are pickable.
  const genImages = useMemo(() => {
    const list = (gens || []).filter((g) => g.status === "ready" && g.url);
    const term = q.trim().toLowerCase();
    return term ? list.filter((g) => (g.prompt || "").toLowerCase().includes(term)) : list;
  }, [gens, q]);

  const isPicked = useCallback((id) => picked.has(id), [picked]);

  // Toggle (multi) or emit-and-close (single).
  const choose = useCallback((item) => {
    if (!multiple) { onAdd?.([item]); onOpenChange?.(false); return; }
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id); else next.set(item.id, item);
      return next;
    });
  }, [multiple, onAdd, onOpenChange]);

  const commit = () => {
    const items = [...picked.values()];
    if (items.length) onAdd?.(items);
    onOpenChange?.(false);
  };

  // Upload a PC file to R2 for a durable, ungated url, keeping the raw File so a
  // chat attachment can still base64-encode its bytes for the agent. On success,
  // auto-select the finished upload (multi mode) so it rides along on Add.
  const uploadOne = useCallback(async (file, id) => {
    try {
      const resp = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
        body: file,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Upload failed (${resp.status})`);
      setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, state: "done", refUrl: data.url } : u)));
      if (multiple) {
        // Emit the durable `/files` url (not the ephemeral object URL, which is
        // revoked on reopen) so consumers can hold onto the thumbnail safely.
        setPicked((prev) => {
          const next = new Map(prev);
          next.set(id, { id, source: "upload", url: data.url, refUrl: data.url, thumb: data.url, name: file.name, file });
          return next;
        });
      }
    } catch (e) {
      setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, state: "error", error: String(e.message || e) } : u)));
    }
  }, [multiple]);

  const addFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const staged = files.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      file: f,
      previewUrl: URL.createObjectURL(f),
      state: "uploading",
      refUrl: null,
      error: null,
    }));
    setUploads((prev) => [...prev, ...staged]);
    staged.forEach((s) => uploadOne(s.file, s.id));
  }, [uploadOne]);

  const onFileInput = (e) => { addFiles(e.target.files); e.target.value = ""; };

  const removeUpload = (id) => {
    setUploads((prev) => {
      const gone = prev.find((u) => u.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((u) => u.id !== id);
    });
    setPicked((prev) => { const next = new Map(prev); next.delete(id); return next; });
  };

  const tabCount = [hasLib, hasGen, hasUpload].filter(Boolean).length;
  const pickedCount = picked.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          {tabCount > 1 && (
            <TabsList>
              {hasLib && <TabsTrigger value="library"><Library size={14} /> Gallery</TabsTrigger>}
              {hasGen && <TabsTrigger value="generation"><Sparkles size={14} /> Visual world</TabsTrigger>}
              {hasUpload && <TabsTrigger value="upload"><Upload size={14} /> Upload</TabsTrigger>}
            </TabsList>
          )}

          {/* Search applies to the two library-style tabs. */}
          {(tab === "library" || tab === "generation") && (
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === "library" ? "Search the asset library…" : "Search generations by prompt…"}
              className="mt-2 h-8 text-sm"
            />
          )}

          {hasLib && (
            <TabsContent value="library" className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
              {libErr && <ErrorNote>{libErr}</ErrorNote>}
              {folders === null && !libErr ? (
                <div className="py-10"><Spinner /></div>
              ) : libImages.length === 0 && !libErr ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Empty>no images in the asset library yet — import some on the Library tab.</Empty>
                </div>
              ) : (
                <div className={GRID}>
                  {libImages.map((im) => (
                    <Tile
                      key={im.rel}
                      url={im.thumb || im.url}
                      name={im.name}
                      caption={im.name}
                      badge={im.selected ? "selected" : null}
                      picked={isPicked(`lib:${im.rel}`)}
                      onClick={() => choose({
                        id: `lib:${im.rel}`, source: "library",
                        rel: im.rel, url: im.url, refUrl: im.refUrl,
                        thumb: im.thumb || im.url, name: im.name,
                      })}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          )}

          {hasGen && (
            <TabsContent value="generation" className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
              {genErr && <ErrorNote>{genErr}</ErrorNote>}
              {gens === null && !genErr ? (
                <div className="py-10"><Spinner /></div>
              ) : genImages.length === 0 && !genErr ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Empty>no ready generations yet — create some on the Visual world tab.</Empty>
                </div>
              ) : (
                <div className={GRID}>
                  {genImages.map((g) => (
                    <Tile
                      key={g.id}
                      url={g.url}
                      name={g.prompt || "generation"}
                      caption={g.prompt}
                      picked={isPicked(`gen:${g.id}`)}
                      onClick={() => choose({
                        id: `gen:${g.id}`, source: "generation",
                        genId: g.id, url: g.url, refUrl: g.refUrl,
                        thumb: g.url, name: g.prompt || "generation",
                      })}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          )}

          {hasUpload && (
            <TabsContent value="upload" className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
              <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onFileInput} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
              >
                <ImagePlus size={22} />
                <span className="text-sm font-medium">Upload from your computer</span>
                <span className="text-xs">Click to choose images (PNG, JPG, WebP…)</span>
              </button>
              {uploads.length > 0 && (
                <div className={cn(GRID, "mt-3")}>
                  {uploads.map((u) => {
                    const pickedNow = isPicked(u.id);
                    return (
                      <div key={u.id} className="group relative">
                        <button
                          type="button"
                          disabled={u.state !== "done"}
                          onClick={() => choose({
                            id: u.id, source: "upload",
                            url: u.refUrl, refUrl: u.refUrl,
                            thumb: u.refUrl, name: u.name, file: u.file,
                          })}
                          className={cn(
                            "relative block w-full overflow-hidden rounded-lg border bg-muted text-left transition-colors",
                            pickedNow ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/60",
                            u.state !== "done" && "cursor-default",
                          )}
                          title={u.name}
                        >
                          <img src={u.previewUrl} alt={u.name} className="aspect-square w-full object-cover" />
                          {u.state === "uploading" && (
                            <span className="absolute inset-0 flex items-center justify-center bg-background/50">
                              <Loader2 size={18} className="animate-spin text-muted-foreground" />
                            </span>
                          )}
                          {u.state === "error" && (
                            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/70 p-2 text-center text-destructive">
                              <AlertCircle size={16} />
                              <span className="text-[9px] leading-tight">{u.error || "Upload failed"}</span>
                            </span>
                          )}
                          {pickedNow && (
                            <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                              <Check size={13} />
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeUpload(u.id)}
                          aria-label={`Remove ${u.name}`}
                          className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-destructive"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>

        {multiple && (
          <DialogFooter className="border-t pt-3">
            <Button variant="ghost" onClick={() => onOpenChange?.(false)}>Cancel</Button>
            <Button onClick={commit} disabled={pickedCount === 0}>
              <ImagePlus size={14} /> Add{pickedCount > 0 ? ` ${pickedCount}` : ""}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
