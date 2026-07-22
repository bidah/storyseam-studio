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
  Copy, Library, Pencil, Layers, AlertCircle, Check, ChevronDown, ChevronUp, Info,
  IdCard, MapPin,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, Eyebrow, Panel, ErrorNote, ConfirmModal } from "@/components/shared";
import MediaPicker from "@/components/MediaPicker";

export const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const COUNTS = [1, 2, 3, 4];
// Radix Select forbids an empty-string item value, so the "none"/"default"
// choices use sentinels mapped back to "" (server resolves the default model).
const NO_PRESET = "__none__";
const DEFAULT_MODEL = "__default__";

// Display meta for the sheet tag ("" = plain image). The tag layers the
// project's character/location sheet prompt into the generation server-side
// and is saved on the record as `sheetType` provenance.
const SHEET_TYPES = {
  character: { label: "Character sheet", icon: IdCard },
  location: { label: "Location sheet", icon: MapPin },
};

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
      {gen.sheetType && SHEET_TYPES[gen.sheetType] && gen.status === "ready" && (
        <Badge variant="info" className="pointer-events-none absolute left-1.5 top-1.5 z-10">
          {(() => { const TagIcon = SHEET_TYPES[gen.sheetType].icon; return <TagIcon size={11} />; })()}
          {gen.sheetType === "character" ? "Character" : "Location"}
        </Badge>
      )}
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

// One row of the DETAILS key-value table.
function DetailRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-medium" title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  );
}

function GenerationDetail({ gen, onClose, onRecreate, onUseAsRef, onEdit, onAddToCanvas, onSaveToLibrary, onDelete, detailActions }) {
  const { setModalImage } = useShell();
  const [savedRel, setSavedRel] = useState(gen?.savedRel || null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  // Seed the saved state from the persisted `savedRel` (survives reload) and
  // reset confirm/expand/copied whenever a different generation opens.
  useEffect(() => {
    setSavedRel(gen?.savedRel || null);
    setConfirmDelete(false);
    setPromptExpanded(false);
    setCopied(false);
  }, [gen?.id, gen?.savedRel]);
  if (!gen) return null;

  const promptText = gen.prompt || "";
  const promptIsLong = promptText.length > 240 || promptText.split("\n").length > 6;
  const refThumbs = (gen.refs || []).filter((r) => r.url || r.thumb);
  const createdDate = gen.ts ? new Date(gen.ts) : null;
  const createdLabel = createdDate && !Number.isNaN(createdDate.getTime())
    ? createdDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : null;

  const copyPrompt = () => {
    navigator.clipboard?.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Secondary (outline) actions for the two-column row under the CTA.
  const secondaries = [
    onEdit && { key: "edit", icon: Pencil, label: "Edit", onClick: () => onEdit(gen) },
    onUseAsRef && { key: "ref", icon: ImagePlus, label: "Reference", title: "Use as generation reference", onClick: () => onUseAsRef(gen) },
    onAddToCanvas && { key: "canvas", icon: Layers, label: "Add to canvas", onClick: () => onAddToCanvas(gen) },
    onSaveToLibrary && {
      key: "library", icon: Library,
      label: savedRel ? "Saved to library" : "Save to library",
      disabled: !!savedRel,
      onClick: async () => { const rel = await onSaveToLibrary(gen); if (rel) setSavedRel(rel); },
    },
  ].filter(Boolean);

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

          {/* Info panel — sectioned cards on top, actions pinned to the bottom. */}
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {/* PROMPT */}
              <section className="rounded-xl border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Eyebrow className="flex items-center gap-1.5"><Sparkles size={12} /> Prompt</Eyebrow>
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={copyPrompt}>
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                {refThumbs.length > 0 && (
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    {refThumbs.map((r, i) => (
                      <img
                        key={`${r.rel || r.genId || i}`}
                        src={r.url || r.thumb}
                        alt="reference"
                        className="h-12 w-12 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                )}
                <p className={cn(
                  "whitespace-pre-wrap text-sm leading-relaxed",
                  promptIsLong && !promptExpanded && "line-clamp-6",
                )}>
                  {promptText || "—"}
                </p>
                {promptIsLong && (
                  <button
                    type="button"
                    onClick={() => setPromptExpanded((v) => !v)}
                    className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {promptExpanded
                      ? <>Show less <ChevronUp size={13} /></>
                      : <>See all <ChevronDown size={13} /></>}
                  </button>
                )}
              </section>

              {/* DETAILS */}
              <section>
                <Eyebrow className="mb-1.5 flex items-center gap-1.5 px-1"><Info size={12} /> Details</Eyebrow>
                <dl className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <DetailRow label="Model">{gen.model || "Default"}</DetailRow>
                  {gen.sheetType && SHEET_TYPES[gen.sheetType] && (
                    <DetailRow label="Sheet">{SHEET_TYPES[gen.sheetType].label}</DetailRow>
                  )}
                  {gen.aspectRatio && <DetailRow label="Aspect">{gen.aspectRatio}</DetailRow>}
                  {gen.refs?.length > 0 && <DetailRow label="References">{gen.refs.length}</DetailRow>}
                  {createdLabel && <DetailRow label="Created">{createdLabel}</DetailRow>}
                  {savedRel && <DetailRow label="Library">{savedRel}</DetailRow>}
                </dl>
              </section>
            </div>

            {/* Bottom-pinned actions */}
            <div className="mt-3 space-y-2 border-t pt-3">
              {onRecreate && (
                <Button className="w-full" onClick={() => onRecreate(gen)}>
                  <RefreshCw size={14} /> Recreate
                </Button>
              )}
              {/* Surface-specific extra actions (e.g. "Use as first frame", "Select take"). */}
              {typeof detailActions === "function" && (
                <div className="flex flex-wrap gap-2">{detailActions(gen)}</div>
              )}
              {secondaries.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {secondaries.map(({ key, icon: SecIcon, label, title, disabled, onClick }) => (
                    <Button
                      key={key}
                      size="sm"
                      variant="outline"
                      className={cn("min-w-0 text-xs", secondaries.length % 2 === 1 && key === secondaries[secondaries.length - 1].key && "col-span-2")}
                      title={title}
                      disabled={disabled}
                      onClick={onClick}
                    >
                      <SecIcon size={13} /> <span className="truncate">{label}</span>
                    </Button>
                  ))}
                </div>
              )}
              {onDelete && (
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={13} /> Delete
                  </Button>
                </div>
              )}
            </div>
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
  // Show the character/location sheet checkboxes in the composer (surfaces whose
  // backend understands `sheetType` — currently the Visual world).
  sheetTagging = false,
  // Backend actions (each optional; a missing one hides its affordance)
  onGenerate,          // async ({prompt, model, count, aspectRatio, presetId, sheetType, refs, mode, base})
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
  // "" | "character" | "location" — tag the next generation as a design sheet
  // (mutually exclusive; the server layers the matching sheet prompt on top of
  // the style preset and stamps the metadata on the generation).
  const [sheetType, setSheetType] = useState("");
  const [refs, setRefs] = useState([]);
  // "new" | "variation" | "edit" — the generation intent (base holds the source gen).
  const [mode, setMode] = useState("new");
  const [base, setBase] = useState(null);

  const isBusy = busy || localBusy;
  // A location sheet formalizes an EXISTING place — generating one without
  // reference art would just invent a new location, so a reference is required
  // (the server enforces this too).
  const needsRef = sheetTagging && sheetType === "location" && refs.length === 0;

  const doGenerate = async () => {
    if (!prompt.trim() || isBusy || !onGenerate || needsRef) return;
    setLocalBusy(true);
    try {
      await onGenerate({ prompt, model, count: Number(count), aspectRatio, presetId, sheetType, refs, mode, base });
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
    setSheetType(g.sheetType || "");
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

          {/* Sheet tagging — mutually exclusive checkboxes; the server layers the
              matching sheet prompt on top of the style preset. */}
          {sheetTagging && (
            <div className="flex items-center gap-3 rounded-md border px-2.5 py-1.5">
              {Object.entries(SHEET_TYPES).map(([key, { label, icon: TagIcon }]) => (
                <label key={key} className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground has-[[data-state=checked]]:text-foreground">
                  <Checkbox
                    checked={sheetType === key}
                    onCheckedChange={(v) => setSheetType(v ? key : "")}
                    aria-label={label}
                  />
                  <TagIcon size={13} /> {label}
                </label>
              ))}
            </div>
          )}
          {needsRef && (
            <button
              type="button"
              onClick={() => setPickRef(true)}
              className="flex items-center gap-1.5 text-xs text-amber-500 hover:underline"
            >
              <AlertCircle size={13} /> Location sheets need a reference image — add one
            </button>
          )}

          <Button
            className="ml-auto"
            onClick={doGenerate}
            disabled={isBusy || !prompt.trim() || needsRef}
            title={needsRef ? "Location sheets need a reference image — add one first" : undefined}
          >
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
