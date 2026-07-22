// ImageStudio — the reusable image-generation surface, extracted from the
// World/Visual tab so every place that generates images (World, Animatic,
// Episode) shares one composer + results grid + detail modal.
//
// It owns the COMPOSER STATE (prompt, model, count, aspect, preset, refs) and the
// two generic transforms on a result — "Recreate" (copy a generation's params
// back into the composer) and "Use as reference" (add it to the ref tray). The
// BACKEND is pluggable via props: `onGenerate` fires a generation, `generations`
// is whatever the surface stores (visual-world concepts, or a shot's stills), and
// the detail-modal actions (`onSaveToLibrary`, `onAddToCanvas`, `onDelete`,
// `onSavePrompts`, plus any `detailActions`) are OPTIONAL — a button only renders
// when its handler is supplied, so a leaner surface (Animatic/Episode) can drop
// the canvas/library affordances it doesn't have.
import { useEffect, useRef, useState } from "react";
import {
  Wand2, Loader2, Sparkles, ImagePlus, X, Plus, Trash2, RefreshCw,
  Copy, Library, Pencil, Layers, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "@/lib/shellContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Empty, Eyebrow, Panel, ErrorNote, ConfirmModal } from "@/components/shared";
import MediaPicker from "@/components/MediaPicker";

export const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const COUNTS = [1, 2, 3, 4];
// Radix Select forbids an empty-string item value, so the "none"/"default"
// choices use sentinels mapped back to "" (server resolves the default model).
const NO_PRESET = "__none__";
const DEFAULT_MODEL = "__default__";

/* ---------------------------------------------------------------- *
 * Prompt library — choose a preset (fills the prompt) and edit them. *
 * ---------------------------------------------------------------- */

function PromptLibraryDialog({ open, onOpenChange, prompts, onSave }) {
  const [list, setList] = useState(prompts);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setList(prompts); }, [open, prompts]);

  const edit = (id, key, val) => setList((l) => l.map((p) => (p.id === id ? { ...p, [key]: val } : p)));
  const add = () => setList((l) => [...l, { id: `prompt-${Date.now().toString(36)}`, name: "New prompt", image: "", video: "", builtin: false }]);
  const remove = (id) => setList((l) => l.filter((p) => p.id !== id));
  const commit = async () => { setSaving(true); try { await onSave(list); onOpenChange(false); } finally { setSaving(false); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Library size={18} className="text-primary" /> Prompt library</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Reusable style prompts. The <b>image</b> block is prepended to your scene as the house style; the
          <b> video</b> block is kept for later Seedance renders.
        </p>
        <div className="space-y-4">
          {list.map((p) => (
            <div key={p.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input value={p.name} onChange={(e) => edit(p.id, "name", e.target.value)} className="h-8 flex-1 text-sm font-medium" placeholder="Preset name" />
                {p.builtin && <Badge variant="muted">seed</Badge>}
                <Button variant="ghost" size="icon-sm" aria-label="Delete preset" onClick={() => remove(p.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={14} />
                </Button>
              </div>
              <div>
                <Eyebrow className="normal-case tracking-normal text-foreground/70">Image style</Eyebrow>
                <Textarea value={p.image} onChange={(e) => edit(p.id, "image", e.target.value)} rows={4} className="text-sm" placeholder="Style, palette, composition…" />
              </div>
              <div>
                <Eyebrow className="normal-case tracking-normal text-foreground/70">Video / motion (optional)</Eyebrow>
                <Textarea value={p.video} onChange={(e) => edit(p.id, "video", e.target.value)} rows={2} className="text-sm" placeholder="Camera & motion clauses for Seedance…" />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={add}><Plus size={13} /> Add preset</Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={commit} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : null} Save prompts</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Generation card + detail modal                                    *
 * ---------------------------------------------------------------- */

export function GenerationCard({ gen, onOpen }) {
  return (
    <button
      onClick={() => gen.status === "ready" && onOpen(gen)}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-lg border bg-muted text-left transition-colors",
        gen.status === "ready" ? "hover:border-primary/60" : "cursor-default",
      )}
      title={gen.prompt}
    >
      {gen.status === "ready" && gen.url ? (
        <img src={gen.url} loading="lazy" alt={gen.prompt} className="h-full w-full object-cover" />
      ) : gen.status === "error" ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-destructive">
          <AlertCircle size={18} />
          <span className="text-[10px] leading-tight">{gen.error || "Failed"}</span>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-[10px]">generating…</span>
        </div>
      )}
    </button>
  );
}

function GenerationDetail({ gen, onClose, onRecreate, onUseAsRef, onEdit, onAddToCanvas, onSaveToLibrary, onDelete, detailActions }) {
  const { setModalImage } = useShell();
  const [savedRel, setSavedRel] = useState(gen?.savedRel || null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Seed the saved state from the persisted `savedRel` (survives reload) and
  // reset confirm whenever a different generation opens.
  useEffect(() => { setSavedRel(gen?.savedRel || null); setConfirmDelete(false); }, [gen?.id, gen?.savedRel]);
  if (!gen) return null;
  return (
    <Dialog open={!!gen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[95vh] max-h-[95vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden sm:max-w-[96vw]">
        <DialogHeader><DialogTitle className="text-sm font-medium text-muted-foreground">Generation</DialogTitle></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          <button
            type="button"
            onClick={() => setModalImage({ url: gen.url, name: gen.prompt || "generation", role: "asset" })}
            className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg border bg-muted"
            title="View full image"
          >
            <img src={gen.url} alt={gen.prompt} className="max-h-full max-w-full object-contain" />
          </button>
          <div className="space-y-3 overflow-y-auto pr-1">
            <div>
              <Eyebrow className="normal-case tracking-normal text-foreground/70">Prompt</Eyebrow>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{gen.prompt || "—"}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {gen.model && <Badge variant="outline">{gen.model}</Badge>}
              {gen.aspectRatio && <Badge variant="outline">{gen.aspectRatio}</Badge>}
              {gen.refs?.length > 0 && <Badge variant="info"><ImagePlus size={11} /> {gen.refs.length} ref</Badge>}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {onRecreate && <Button size="sm" onClick={() => onRecreate(gen)}><RefreshCw size={13} /> Recreate</Button>}
              {onEdit && <Button size="sm" variant="outline" onClick={() => onEdit(gen)}><Pencil size={13} /> Edit</Button>}
              {onUseAsRef && <Button size="sm" variant="outline" onClick={() => onUseAsRef(gen)}><ImagePlus size={13} /> Use as reference</Button>}
              {onAddToCanvas && <Button size="sm" variant="outline" onClick={() => onAddToCanvas(gen)}><Layers size={13} /> Add to canvas</Button>}
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(gen.prompt || "")}><Copy size={13} /> Copy prompt</Button>
            </div>
            {/* Surface-specific extra actions (e.g. "Use as first frame", "Select take"). */}
            {typeof detailActions === "function" && (
              <div className="flex flex-wrap gap-2 pt-1">{detailActions(gen)}</div>
            )}
            {(onSaveToLibrary || onDelete) && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {onSaveToLibrary && (
                  <Button
                    size="sm" variant="outline"
                    disabled={!!savedRel}
                    onClick={async () => { const rel = await onSaveToLibrary(gen); if (rel) setSavedRel(rel); }}
                  >
                    <Library size={13} /> {savedRel ? "Saved to library" : "Save to library"}
                  </Button>
                )}
                {savedRel && <span className="text-xs text-muted-foreground">→ {savedRel}</span>}
                {onDelete && (
                  <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={13} /> Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>

      <ConfirmModal
        open={confirmDelete}
        title="Delete this generation?"
        message="This image will be permanently deleted, along with its stored file and anything referencing it."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); onDelete(gen); onClose(); }}
      />
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * ImageStudio — composer + results + detail, backend via props.     *
 * ---------------------------------------------------------------- */

export default function ImageStudio({
  // Header
  title, subtitle, headerExtra,
  // Data (from the surface's backend/loader)
  generations = [],
  models = [],
  prompts = [],
  settings = {},
  // Status
  busy = false, pending = 0, error = null,
  // Copy / options
  emptyLabel = "no images yet — describe something below and hit Generate.",
  composerPlaceholder = "Describe a character or a place…",
  countOptions = COUNTS,
  aspects = ASPECTS,
  refPickerSources, // MediaPicker `sources` (undefined = its default set)
  // Backend actions (each optional; a missing one hides its affordance)
  onGenerate,          // async ({prompt, model, count, aspectRatio, presetId, refs, mode, base})
  onDelete,            // async (gen)
  onSaveToLibrary,     // async (gen) => rel
  onAddToCanvas,       // async (gen)
  onSavePrompts,       // async (list)
  detailActions,       // (gen) => JSX  — surface-specific extra buttons in the detail modal
  onEditImage,         // if set, the detail modal shows an "Edit" button (edit-existing mode)
}) {
  const [open, setOpen] = useState(null); // generation open in the detail modal
  const [pickRef, setPickRef] = useState(false);
  const [editPrompts, setEditPrompts] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  // Composer state — seeded from remembered settings.
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(settings.model || "");
  const [count, setCount] = useState(String(settings.count || 1));
  const [aspectRatio, setAspectRatio] = useState(settings.aspectRatio || "16:9");
  const [presetId, setPresetId] = useState(settings.presetId ?? (prompts?.[0]?.id ?? ""));
  const [refs, setRefs] = useState([]);
  // "new" | "variation" | "edit" — the generation intent (base holds the source gen).
  const [mode, setMode] = useState("new");
  const [base, setBase] = useState(null);

  const isBusy = busy || localBusy;

  const doGenerate = async () => {
    if (!prompt.trim() || isBusy || !onGenerate) return;
    setLocalBusy(true);
    try {
      await onGenerate({ prompt, model, count: Number(count), aspectRatio, presetId, refs, mode, base });
      // A fresh "new" generation clears the edit/variation intent.
      if (mode !== "new") { setMode("new"); setBase(null); }
    } finally { setLocalBusy(false); }
  };

  // Generic transforms on a result (no backend needed).
  const recreate = (g) => {
    setPrompt(g.prompt || "");
    if (g.model) setModel(g.model);
    if (g.aspectRatio) setAspectRatio(g.aspectRatio);
    if (g.presetId) setPresetId(g.presetId);
    setRefs((g.refs || []).map((r) => ({ ...r, thumb: r.url || r.thumb })));
    setMode("new"); setBase(null);
    setOpen(null);
  };
  const useAsRef = (g) => {
    setRefs((cur) => (cur.some((r) => r.genId === g.id) ? cur : [...cur, { kind: "generation", genId: g.id, url: g.url, thumb: g.url, name: "gen" }]));
    setOpen(null);
  };
  // Edit-existing: seed the composer to edit this image in place (image + prompt).
  const editImage = (g) => {
    setMode("edit"); setBase(g);
    setRefs([{ kind: "generation", genId: g.id, url: g.url, thumb: g.url, name: "base" }]);
    setPrompt("");
    setOpen(null);
  };

  return (
    <div className="space-y-4">
      {(title || headerExtra || pending > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {title && <h2 className="text-xl font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {pending > 0 && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> {pending} generating</Badge>}
            {typeof headerExtra === "function" ? headerExtra({ prompt }) : headerExtra}
          </div>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Results grid */}
      <Panel title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> Generations</span>}>
        {generations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>{emptyLabel}</Empty>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {generations.map((g) => <GenerationCard key={g.id} gen={g} onOpen={setOpen} />)}
          </div>
        )}
      </Panel>

      {/* Composer */}
      <div className="sticky bottom-4 z-10 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
        {/* Mode banner when working from a base image (variation / edit). */}
        {mode !== "new" && base && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="info">{mode === "edit" ? "Editing" : "Variation of"}</Badge>
            <span className="truncate">this image — describe the change, then Generate.</span>
            <Button variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => { setMode("new"); setBase(null); }} className="ml-auto">
              <X size={13} />
            </Button>
          </div>
        )}
        {/* Reference chips */}
        {refs.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {refs.map((r, i) => (
              <div key={`${r.kind}-${r.rel || r.genId}-${i}`} className="group relative">
                <img src={r.thumb || r.url} alt={r.name} className="h-12 w-12 rounded-md border object-cover" />
                <button
                  onClick={() => setRefs((cur) => cur.filter((_, j) => j !== i))}
                  aria-label="Remove reference"
                  className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-destructive"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doGenerate(); }}
          placeholder={composerPlaceholder}
          rows={2}
          className="mb-2 resize-none text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* Prompt preset (only when the surface manages presets) */}
          {onSavePrompts && (
            <>
              <Select value={presetId || NO_PRESET} onValueChange={(v) => setPresetId(v === NO_PRESET ? "" : v)}>
                <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue placeholder="Prompt style" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PRESET}>No style preset</SelectItem>
                  {prompts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setEditPrompts(true)} title="Edit prompt library">
                <Pencil size={13} /> Prompts
              </Button>
            </>
          )}

          {/* Model */}
          <Select value={model || DEFAULT_MODEL} onValueChange={(v) => setModel(v === DEFAULT_MODEL ? "" : v)}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Nano Banana Pro" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL}>Nano Banana Pro (default)</SelectItem>
              {models.filter((m) => m.id).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Count */}
          <Select value={count} onValueChange={setCount}>
            <SelectTrigger className="h-8 w-[92px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{countOptions.map((n) => <SelectItem key={n} value={String(n)}>{n} image{n > 1 ? "s" : ""}</SelectItem>)}</SelectContent>
          </Select>

          {/* Aspect */}
          <Select value={aspectRatio} onValueChange={setAspectRatio}>
            <SelectTrigger className="h-8 w-[84px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{aspects.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => setPickRef(true)}><ImagePlus size={13} /> Reference</Button>

          <Button className="ml-auto" onClick={doGenerate} disabled={isBusy || !prompt.trim()}>
            {isBusy ? <><Loader2 size={14} className="animate-spin" /> generating…</> : <><Wand2 size={14} /> Generate</>}
          </Button>
        </div>
      </div>

      <GenerationDetail
        gen={open}
        onClose={() => setOpen(null)}
        onRecreate={recreate}
        onUseAsRef={useAsRef}
        onEdit={onEditImage ? editImage : undefined}
        onAddToCanvas={onAddToCanvas}
        onSaveToLibrary={onSaveToLibrary}
        onDelete={onDelete}
        detailActions={detailActions}
      />
      <MediaPicker
        open={pickRef}
        onOpenChange={setPickRef}
        sources={refPickerSources}
        onAdd={(items) => setRefs((cur) => [
          ...cur,
          ...items.map((it) => ({
            kind: it.source, // "library" | "generation" | "upload"
            rel: it.rel,
            genId: it.genId,
            // Uploads pass their absolute url to generate; library/generation
            // refs are resolved server-side from rel/genId.
            url: it.source === "upload" ? it.refUrl : undefined,
            // Prefer the durable /files url for the chip (upload object URLs are
            // revoked when the picker reopens).
            thumb: it.source === "upload" ? (it.refUrl || it.thumb) : (it.thumb || it.url),
            name: it.name,
          })),
        ])}
      />
      {onSavePrompts && (
        <PromptLibraryDialog open={editPrompts} onOpenChange={setEditPrompts} prompts={prompts} onSave={onSavePrompts} />
      )}
    </div>
  );
}
