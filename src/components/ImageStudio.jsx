// ImageStudio — the reusable generation surface, extracted from the old
// World/Visual tab so every place that generates media shares one composer +
// results grid + detail modal.
//
// It owns the COMPOSER STATE (prompt, model, count, aspect, preset, refs) and the
// two generic transforms on a result — "Recreate" (copy a generation's params
// back into the composer) and "Use as reference" (add it to the ref tray). The
// BACKEND is pluggable via props: `onGenerate` fires a generation, `generations`
// is whatever the surface stores (visual-world concepts, or a shot's stills), and
// the detail-modal actions (`onSaveToLibrary`, `onAddToCanvas`, `onDelete`,
// `onSavePrompts`, plus any `detailActions`) are OPTIONAL — a button only renders
// when its handler is supplied, so a leaner surface can drop the canvas/library
// affordances it doesn't have.
//
// ── One medium at a time (`medium`) ──────────────────────────────────────────
// The composer showcases ONE medium's providers and models — never a mixed list.
// A model catalog that interleaves image and video models is a list where every
// second row is a mistake waiting to happen, so /images and /videos each hand
// this component their own catalog and say which medium it is. `medium` drives
// the LABELLING and the CONTROLS (duration + generated-audio are video-only;
// count fan-out and sheet tagging are image-only).
//
// A result tile keys off the GENERATION's own `kind`, not `medium` — the two
// surfaces share one store, so a stray record of the other medium must still
// render sanely rather than as a broken <img>.
//
// ── The controls come FROM THE MODEL ─────────────────────────────────────────
// The video composer used to offer a duration, a "generate audio" checkbox and
// an aspect ratio off three hardcoded lists. Those are SEEDANCE's parameters,
// and every other model on the provider takes a different set: Veo 3 has no
// duration at all, MiniMax H3 wants a `resolution` whose only option is "2K",
// Hailuo's duration is the enum [6, 10] rather than a range, and "audio" is
// spelled `generate_audio` (bool) on Seedance, `sound` (bool) on Kling 2.6 and
// `sound: "on" | "off"` (a STRING) on Kling 3.0. Hardcoding a fourth shape
// would just be a fourth model's worth of wrong.
//
// So each catalog entry carries its own `params` spec and the composer renders
// <ParamControl> per declared param, plus `aspectRatios` (empty = the model
// takes none, so the control disappears) and `batch` (the "how many clips"
// picker). A model with NO spec — the "Default" choice, an older catalog, the
// image surface — falls back to exactly the controls that were here before.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Wand2, Loader2, Sparkles, ImagePlus, X, Plus, Trash2, RefreshCw,
  Copy, Library, Pencil, Layers, AlertCircle, Check, ChevronDown, ChevronUp, Info,
  IdCard, MapPin, Package, Film, Volume2, Download,
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
import PromptEditor from "@/components/mention/PromptEditor";
import { refTagLabel, withImageRefNote } from "@/lib/refTags";
import { uploadAttachment, classifyFile } from "@/lib/attachments";
import { useProviderGate } from "@/components/ProviderGate";
import { useT } from "@/lib/i18n";
import { downloadUrl, filenameFromUrl } from "@/lib/download";
import { toThumbSrc, toZoomSrc } from "@/lib/previewSrc";

export const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const COUNTS = [1, 2, 3, 4];
// What the worker's clampDuration() accepts, in the steps the node canvas
// offers. Duplicated from src/components/flow/flow-config.js the same way
// ASPECTS already is — the canvas and this composer are two drivers of one
// backend, and neither should have to import the other's module graph.
export const VIDEO_DURATIONS = [4, 5, 6, 8, 10, 12, 15];
// Radix Select forbids an empty-string item value, so the "none"/"default"
// choices use sentinels mapped back to "" (server resolves the default model).
const NO_PRESET = "__none__";
const DEFAULT_MODEL = "__default__";

// Every tray entry gets a stable client-side id so "@imageN" chips in the
// prompt can follow their reference through removals/renumbering.
const withRefId = (r) => ({ id: crypto.randomUUID(), ...r });

// Display meta for the sheet tag ("" = plain image). The tag layers the
// project's character/location/prop sheet prompt into the generation
// server-side and is saved on the record as `sheetType` provenance.
const SHEET_TYPES = {
  character: { label: "Character sheet", short: "Character", icon: IdCard },
  location: { label: "Location sheet", short: "Location", icon: MapPin },
  prop: { label: "Prop sheet", short: "Prop", icon: Package },
};

// Per-medium copy. Everything the composer says about "what am I generating"
// comes from here, so a surface never has to hand-write "video model" into a
// prop and get it half-right.
const MEDIUM_COPY = {
  image: {
    modelPlaceholder: "Nano Banana Pro",
    modelDefault: "Nano Banana Pro (default)",
    modelLabel: "Image model",
    modelEmpty: "No image models — connect a provider",
    refLabel: "Reference",
    refTitle: "Add a reference image",
    busy: "generating…",
    cta: "Generate",
  },
  video: {
    modelPlaceholder: "Seedance",
    modelDefault: "Seedance (default)",
    modelLabel: "Video model",
    modelEmpty: "No video models — connect a provider",
    // For video the FIRST reference is the clip's first frame (the worker reads
    // it as the start frame), so the button says what it actually does.
    refLabel: "Start frame",
    refTitle: "The first reference becomes the clip's first frame",
    busy: "rendering…",
    cta: "Generate clip",
  },
};

const isVideoGen = (gen) => gen?.kind === "video";

/* ---------------------------------------------------------------- *
 * Model-declared controls                                           *
 * ---------------------------------------------------------------- */

// WHY: a model's creative knobs are data now (see the note at the top), so one
// renderer draws all four declared kinds — `enum`/`choice` as a Select, `bool`
// as a checkbox, `range` as a Select of steps or a number box. The param's
// `hint` is the ONLY per-model documentation that exists ("mode 'fast' supports
// 480p/720p only", "'512' is incompatible with end_image"), so it always rides
// along as the control's title; the `label` is always the aria-label.

// A range short enough to enumerate becomes a dropdown, because picking "8s"
// out of a list beats typing into a spinner. Durations are the common case and
// the widest of them (Kling 3.0's 3–15) is 13 steps; anything longer — Wan's
// 2–30 — gets a number box instead of a menu you have to scroll.
const RANGE_ENUM_MAX = 16;
// Radix Select forbids an empty-string item value; an enum could declare one.
const OPT_EMPTY = "__empty__";
// Every spelling of "make sound", so the checkbox keeps its speaker icon and
// the legacy `generateAudio` mirror still finds the switch whichever way this
// model names it.
const AUDIO_PARAMS = new Set(["generate_audio", "sound", "audio"]);
const PARAM_KINDS = new Set(["enum", "bool", "choice", "range"]);

// `generate_audio` → "Generate audio". Also the fallback label for a param the
// catalog handed us without one, and how the detail panel titles a stored row.
const humanizeParam = (name) => {
  const s = String(name || "").replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
};

const fmtParamNum = (v, unit) => (unit === "s" ? `${v}s` : String(v));

const paramStep = (p) => (Number(p.step) > 0 ? Number(p.step) : 1);

const clampParam = (n, p) => {
  const step = paramStep(p);
  const snapped = p.min + Math.round((n - p.min) / step) * step;
  return Math.min(p.max, Math.max(p.min, Number(snapped.toFixed(6))));
};

// The steps of a `range`, or null when it's too wide to put in a menu.
function rangeOptions(p) {
  const step = paramStep(p);
  const n = Math.floor((Number(p.max) - Number(p.min)) / step) + 1;
  if (!Number.isFinite(n) || n < 1 || n > RANGE_ENUM_MAX) return null;
  return Array.from({ length: n }, (_, i) => Number((Number(p.min) + i * step).toFixed(6)));
}

// Can `v` (carried over from whatever model the author was just on) be this
// param's value? Returns the coerced value, or undefined to mean "use the
// default". This is what makes switching models feel like changing one thing
// instead of resetting the composer.
function acceptParam(p, v) {
  if (v === undefined || v === null) return undefined;
  switch (p.kind) {
    case "bool":
      // Kling 3.0 spells the same switch "on"/"off" — cross that spelling
      // rather than dropping the author's choice on the way between models.
      if (typeof v === "boolean") return v;
      if (v === "on") return true;
      if (v === "off") return false;
      return undefined;
    case "enum": {
      const opts = (p.options || []).map(String);
      if (typeof v === "boolean" && opts.includes("on") && opts.includes("off")) return v ? "on" : "off";
      const s = String(v);
      return opts.includes(s) ? s : undefined;
    }
    case "choice": {
      const n = Number(v);
      return Number.isFinite(n) && (p.options || []).some((o) => Number(o) === n) ? n : undefined;
    }
    case "range": {
      const n = Number(v);
      if (!Number.isFinite(n) || n < Number(p.min) || n > Number(p.max)) return undefined;
      return clampParam(n, p);
    }
    default:
      return undefined;
  }
}

// Build the value bag for a model: every declared param, carried over from
// `prior` when the new model can accept it, otherwise its declared default.
function seedParams(spec, prior) {
  const out = {};
  for (const p of spec || []) {
    if (!p?.name || !PARAM_KINDS.has(p.kind)) continue;
    const carried = acceptParam(p, prior?.[p.name]);
    out[p.name] = carried === undefined ? p.default : carried;
  }
  return out;
}

// A range too wide to enumerate. Held as a draft string so typing "12" over a
// "4" isn't clamped mid-keystroke; the value commits on blur / Enter.
function NumberParam({ param, label, title, value, onChange }) {
  const [draft, setDraft] = useState(String(value ?? param.default ?? ""));
  useEffect(() => { setDraft(String(value ?? param.default ?? "")); }, [value, param.default]);
  const commit = () => {
    const n = Number(draft);
    onChange(draft.trim() !== "" && Number.isFinite(n) ? clampParam(n, param) : param.default);
  };
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground" title={title}>
      <span>{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        value={draft}
        min={param.min}
        max={param.max}
        step={paramStep(param)}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        className="h-6 w-16 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      {param.unit === "s" && <span>s</span>}
    </div>
  );
}

function ParamControl({ param, value, onChange }) {
  const t = useT();
  const label = t(param.label || humanizeParam(param.name));
  const title = param.hint ? String(param.hint) : label;
  // A kind this renderer doesn't know is a catalog that moved ahead of the
  // client — draw nothing rather than a broken control.
  if (!param?.name || !PARAM_KINDS.has(param.kind)) return null;

  if (param.kind === "bool") {
    const Icon = AUDIO_PARAMS.has(param.name) ? Volume2 : null;
    return (
      <label
        className="flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground has-[[data-state=checked]]:text-foreground"
        title={title}
      >
        {Icon && <Icon size={13} />} {label}
        <Checkbox checked={!!value} onCheckedChange={(v) => onChange(!!v)} aria-label={label} />
      </label>
    );
  }

  const options = param.kind === "enum"
    ? (param.options || []).map(String)
    : param.kind === "choice"
      ? (param.options || []).map(Number)
      : rangeOptions(param);

  if (!options) return <NumberParam param={param} label={label} title={title} value={value} onChange={onChange} />;

  const asItem = (o) => (o === "" ? OPT_EMPTY : String(o));
  const current = value ?? param.default;
  return (
    <Select
      value={current === undefined || current === null ? "" : asItem(current)}
      onValueChange={(v) => onChange(param.kind === "enum" ? (v === OPT_EMPTY ? "" : v) : Number(v))}
    >
      {/* The label rides in the trigger: a bare "std" or "2K" next to three
          other bare values is a row nobody can read. */}
      <SelectTrigger size="sm" aria-label={label} title={title} className="max-w-[220px] gap-1.5 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={String(o)} value={asItem(o)}>
            {param.kind === "enum" ? String(o) : fmtParamNum(o, param.unit)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ---------------------------------------------------------------- *
 * Prompt library — choose a preset (fills the prompt) and edit them. *
 * ---------------------------------------------------------------- */

const fmtRevDate = (ts) => {
  const d = ts ? new Date(ts) : null;
  return d && !Number.isNaN(+d)
    ? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
};

// Edits the project's generation prompts in one place: the STYLE presets (house
// look) and the character/location SHEET prompts (also on Settings).
// Every save is confirmed and stored server-side as a numbered, dated revision.
//
// A preset carries BOTH an `image` block and a `video`/motion block, and the
// worker picks between them per job (`kind === "video" ? preset.video :
// preset.image`). Both stay editable here whichever surface opened the dialog —
// they are one document — but the block that will actually be prepended on THIS
// surface is ordered first and labelled as the one in use, so the author isn't
// typing style notes into a field this medium ignores.
function PromptLibraryDialog({ open, onOpenChange, prompts, sheetPrompts, revisions = [], onSave, medium = "image" }) {
  const t = useT();
  const [list, setList] = useState(prompts);
  const [sheets, setSheets] = useState({ character: "", location: "", prop: "" });
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!open) return;
    setList(prompts);
    setSheets({
      character: sheetPrompts?.character || "",
      location: sheetPrompts?.location || "",
      prop: sheetPrompts?.prop || "",
    });
    setConfirming(false);
  }, [open, prompts, sheetPrompts]);

  const latest = revisions[revisions.length - 1];
  const nextRev = (latest?.rev || 0) + 1;
  const forVideo = medium === "video";

  // The two style blocks, ordered so the one this surface prepends comes first.
  const blocks = [
    {
      key: "image",
      label: forVideo ? "Image style (used by Image generation)" : "Image style (in use here)",
      rows: 4,
      placeholder: "Style, palette, composition…",
    },
    {
      key: "video",
      label: forVideo ? "Video / motion style (in use here)" : "Video / motion (used by Video generation)",
      rows: forVideo ? 4 : 2,
      placeholder: "Camera & motion clauses…",
    },
  ];
  if (forVideo) blocks.reverse();

  const edit = (id, key, val) => setList((l) => l.map((p) => (p.id === id ? { ...p, [key]: val } : p)));
  const add = () => setList((l) => [...l, { id: `prompt-${Date.now().toString(36)}`, name: t("New prompt"), image: "", video: "", builtin: false }]);
  const remove = (id) => setList((l) => l.filter((p) => p.id !== id));
  const commit = async () => {
    setSaving(true);
    try { await onSave({ prompts: list, sheetPrompts: sheets }); onOpenChange(false); }
    finally { setSaving(false); setConfirming(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library size={18} className="text-primary" /> {t("Prompt library")}
            {latest && <Badge variant="muted">{t("rev")} {latest.rev} · {fmtRevDate(latest.ts)}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {/* Style presets */}
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={14} className="text-primary" /> {t("Style prompts")}</h3>
          <p className="text-sm text-muted-foreground">
            {forVideo
              ? t("Reusable style prompts. The video / motion block is prepended to your shot description on this surface; the image block is what the Image generation surface prepends.")
              : t("Reusable style prompts. The image block is prepended to your scene as the house style; the video / motion block is what the Video generation surface prepends.")}
          </p>
        </div>
        <div className="space-y-4">
          {list.map((p) => (
            <div key={p.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input value={p.name} onChange={(e) => edit(p.id, "name", e.target.value)} className="h-8 flex-1 text-sm font-medium" placeholder={t("Preset name")} />
                {p.builtin && <Badge variant="muted">{t("seed")}</Badge>}
                <Button variant="ghost" size="icon-sm" aria-label={t("Delete preset")} onClick={() => remove(p.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={14} />
                </Button>
              </div>
              {blocks.map((b) => (
                <div key={b.key}>
                  <Eyebrow className="normal-case tracking-normal text-foreground/70">{t(b.label)}</Eyebrow>
                  <Textarea value={p[b.key] || ""} onChange={(e) => edit(p.id, b.key, e.target.value)} rows={b.rows} className="text-sm" placeholder={t(b.placeholder)} />
                </div>
              ))}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={add}><Plus size={13} /> {t("Add preset")}</Button>
        </div>

        {/* Sheet prompts — same data Settings edits, surfaced here too. A design
            sheet is an IMAGE concept, so the video surface doesn't show them;
            they still ride through the save untouched. */}
        {!forVideo && (
        <>
        <div className="space-y-1 pt-2">

          <h3 className="flex items-center gap-2 text-sm font-semibold"><IdCard size={14} className="text-primary" /> {t("Sheet prompts")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("Layered on top of the style when a generation is tagged as a character, location, or prop sheet. Also editable in Settings.")}
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Character sheet prompt")}</Eyebrow>
            <Textarea value={sheets.character} onChange={(e) => setSheets((s) => ({ ...s, character: e.target.value }))} rows={4} className="text-sm" placeholder={t("Contact-sheet instructions for characters…")} />
          </div>
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Location sheet prompt")}</Eyebrow>
            <Textarea value={sheets.location} onChange={(e) => setSheets((s) => ({ ...s, location: e.target.value }))} rows={4} className="text-sm" placeholder={t("Contact-sheet instructions for locations…")} />
          </div>
          <div>
            <Eyebrow className="normal-case tracking-normal text-foreground/70">{t("Prop sheet prompt")}</Eyebrow>
            <Textarea value={sheets.prop} onChange={(e) => setSheets((s) => ({ ...s, prop: e.target.value }))} rows={4} className="text-sm" placeholder={t("Multi-view instructions for props — no hands, consistent scale…")} />
          </div>
        </div>
        </>
        )}

        {/* Revision history — number + date as a reference. */}
        {revisions.length > 0 && (
          <div className="space-y-2 pt-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Layers size={14} className="text-primary" /> {t("Revisions")}</h3>
            <ul className="space-y-1">
              {[...revisions].reverse().map((r) => (
                <li key={r.rev} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={r.rev === latest.rev ? "info" : "muted"}>{t("rev")} {r.rev}</Badge>
                  {fmtRevDate(r.ts)}
                  {r.rev === latest.rev && <span className="text-foreground/70">{t("current")}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          {confirming ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">{t("Save these prompts as rev {n}?", { n: nextRev })}</span>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={saving}>{t("Back")}</Button>
              <Button onClick={commit} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t("Save revision {n}", { n: nextRev })}
              </Button>
            </div>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
              <Button onClick={() => setConfirming(true)}>{t("Save prompts")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Generation card + detail modal                                    *
 * ---------------------------------------------------------------- */

export function GenerationCard({ gen, onOpen }) {
  const t = useT();
  const video = isVideoGen(gen);
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
          {t(SHEET_TYPES[gen.sheetType].short)}
        </Badge>
      )}
      {video && gen.status === "ready" && (
        <Badge variant="muted" className="pointer-events-none absolute right-1.5 top-1.5 z-10">
          <Film size={11} /> {t("Clip")}
        </Badge>
      )}
      {gen.status === "ready" && gen.url ? (
        video ? (
          // No `controls` here: the tile IS the button that opens the detail
          // view, and a control bar inside it would swallow that click. Hover
          // previews the clip; the modal is where it actually plays.
          <video
            src={gen.url}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            onMouseEnter={(e) => { e.currentTarget.play().catch(() => {}); }}
            onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
          />
        ) : (
          // The grid renders the ~400px webp; the full-res original is what the
          // lightbox and any downstream image-to-video job get.
          <img src={gen.thumb || gen.url} loading="lazy" alt={gen.prompt} className="h-full w-full object-cover" />
        )
      ) : gen.status === "error" ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-destructive">
          <AlertCircle size={18} />
          <span className="text-[10px] leading-tight">{gen.error || t("Failed")}</span>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-[10px]">{video ? t("rendering…") : t("generating…")}</span>
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
  const t = useT();
  const [savedRel, setSavedRel] = useState(gen?.savedRel || null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Seed the saved state from the persisted `savedRel` (survives reload) and
  // reset confirm/expand/copied whenever a different generation opens.
  useEffect(() => {
    setSavedRel(gen?.savedRel || null);
    setConfirmDelete(false);
    setPromptExpanded(false);
    setCopied(false);
    setDownloading(false);
  }, [gen?.id, gen?.savedRel]);
  if (!gen) return null;

  const video = isVideoGen(gen);
  // The knobs a clip was made with differ per model, so the details table
  // renders whatever bag the record stored rather than a fixed Duration/Audio
  // pair. Records written before models declared their params have no bag —
  // their top-level `duration` / `generateAudio` rows below still carry them.
  const paramRows = Object.entries(gen.params && typeof gen.params === "object" ? gen.params : {})
    .filter(([k, v]) => k && v !== undefined && v !== null && v !== "");
  const paramNames = new Set(paramRows.map(([k]) => k));
  const fmtParamValue = (name, v) =>
    typeof v === "boolean" ? (v ? t("On") : t("Off"))
      : name === "duration" ? `${v}s`
        : String(v);
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

  // Always the ORIGINAL (`gen.url`), never `display` — that's a ~1600px webp
  // for looking at, and a download that quietly hands back a downsized copy of
  // the picture is worse than no download button.
  const saveOriginal = async () => {
    setDownloading(true);
    try {
      await downloadUrl(gen.url, gen.file || filenameFromUrl(gen.url, video ? "clip.mp4" : "generation.png"));
    } finally {
      setDownloading(false);
    }
  };

  // Secondary (outline) actions for the two-column row under the CTA.
  const secondaries = [
    onEdit && !video && { key: "edit", icon: Pencil, label: t("Edit"), onClick: () => onEdit(gen) },
    // A clip can't be a reference IMAGE, and the ref tray only takes images.
    onUseAsRef && !video && { key: "ref", icon: ImagePlus, label: t("Reference"), title: t("Use as generation reference"), onClick: () => onUseAsRef(gen) },
    onAddToCanvas && { key: "canvas", icon: Layers, label: t("Add to canvas"), onClick: () => onAddToCanvas(gen) },
    gen.url && {
      key: "download",
      icon: downloading ? Loader2 : Download,
      iconClassName: downloading ? "animate-spin" : undefined,
      label: t("Download"),
      title: video ? t("Download the original clip") : t("Download the full-size original"),
      disabled: downloading,
      onClick: saveOriginal,
    },
    onSaveToLibrary && {
      key: "library", icon: Library,
      label: savedRel ? t("Saved to library") : t("Save to library"),
      disabled: !!savedRel,
      onClick: async () => { const rel = await onSaveToLibrary(gen); if (rel) setSavedRel(rel); },
    },
  ].filter(Boolean);

  return (
    <Dialog open={!!gen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[95vh] max-h-[95vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden sm:max-w-[96vw]">
        <DialogHeader><DialogTitle className="text-sm font-medium text-muted-foreground">{video ? t("Clip") : t("Generation")}</DialogTitle></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          {video ? (
            // The shell lightbox is an IMAGE viewer, so a clip plays in place
            // with its own transport instead of opening it.
            <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg border bg-black">
              <video src={gen.url} controls muted playsInline className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <button
              type="button"
              // The lightbox opens the ~1600px webp too. It used to be handed
              // `gen.url` — the untouched original, which on a 4k generation is
              // several megabytes of detail no screen shows, so the viewer sat
              // blank while it downloaded. The original has exactly one job here
              // and it is the Download button below (`saveOriginal`).
              onClick={() => setModalImage({
                url: gen.url,
                display: gen.display || toZoomSrc(gen.url),
                name: gen.prompt || t("generation"),
                role: "asset",
              })}
              className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg border bg-muted"
              title={t("View full image")}
            >
              <img src={gen.display || toZoomSrc(gen.url)} alt={gen.prompt} className="max-h-full max-w-full object-contain" />
            </button>
          )}

          {/* Info panel — sectioned cards on top, actions pinned to the bottom. */}
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {/* PROMPT */}
              <section className="rounded-xl border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Eyebrow className="flex items-center gap-1.5"><Sparkles size={12} /> {t("Prompt")}</Eyebrow>
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={copyPrompt}>
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t("Copied") : t("Copy")}
                  </Button>
                </div>
                {refThumbs.length > 0 && (
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    {refThumbs.map((r, i) => (
<img
                          key={`${r.rel || r.genId || i}`}
                          src={toThumbSrc(r.thumb || r.url)}
                          alt={t("reference")}
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
                      ? <>{t("Show less")} <ChevronUp size={13} /></>
                      : <>{t("See all")} <ChevronDown size={13} /></>}
                  </button>
                )}
              </section>

              {/* DETAILS */}
              <section>
                <Eyebrow className="mb-1.5 flex items-center gap-1.5 px-1"><Info size={12} /> {t("Details")}</Eyebrow>
                <dl className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <DetailRow label={t("Model")}>{gen.model || t("Default")}</DetailRow>
                  {gen.sheetType && SHEET_TYPES[gen.sheetType] && (
                    <DetailRow label={t("Sheet")}>{t(SHEET_TYPES[gen.sheetType].label)}</DetailRow>
                  )}
                  {gen.aspectRatio && <DetailRow label={t("Aspect")}>{gen.aspectRatio}</DetailRow>}
                  {paramRows.map(([k, v]) => (
                    <DetailRow key={k} label={t(humanizeParam(k))}>{fmtParamValue(k, v)}</DetailRow>
                  ))}
                  {video && gen.duration && !paramNames.has("duration")
                    ? <DetailRow label={t("Duration")}>{`${gen.duration}s`}</DetailRow>
                    : null}
                  {video && "generateAudio" in gen && !paramNames.has("generate_audio") && !paramNames.has("sound")
                    ? <DetailRow label={t("Audio")}>{gen.generateAudio ? t("Generated") : t("Silent")}</DetailRow>
                    : null}
                  {gen.refs?.length > 0 && <DetailRow label={t("References")}>{gen.refs.length}</DetailRow>}
                  {createdLabel && <DetailRow label={t("Created")}>{createdLabel}</DetailRow>}
                  {savedRel && <DetailRow label={t("Library")}>{savedRel}</DetailRow>}
                </dl>
              </section>
            </div>

            {/* Bottom-pinned actions */}
            <div className="mt-3 space-y-2 border-t pt-3">
              {onRecreate && (
                <Button className="w-full" onClick={() => onRecreate(gen)}>
                  <RefreshCw size={14} /> {t("Recreate")}
                </Button>
              )}
              {/* Surface-specific extra actions (e.g. "Use as first frame", "Select take"). */}
              {typeof detailActions === "function" && (
                <div className="flex flex-wrap gap-2">{detailActions(gen)}</div>
              )}
              {secondaries.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {secondaries.map(({ key, icon: SecIcon, iconClassName, label, title, disabled, onClick }) => (
                    <Button
                      key={key}
                      size="sm"
                      variant="outline"
                      className={cn("min-w-0 text-xs", secondaries.length % 2 === 1 && key === secondaries[secondaries.length - 1].key && "col-span-2")}
                      title={title}
                      disabled={disabled}
                      onClick={onClick}
                    >
                      <SecIcon size={13} className={iconClassName} /> <span className="truncate">{label}</span>
                    </Button>
                  ))}
                </div>
              )}
              {onDelete && (
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={13} /> {t("Delete")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      <ConfirmModal
        open={confirmDelete}
        title={video ? t("Delete this clip?") : t("Delete this generation?")}
        message={video
          ? t("This clip will be permanently deleted, along with its stored file and anything referencing it.")
          : t("This image will be permanently deleted, along with its stored file and anything referencing it.")}
        confirmLabel={t("Delete")}
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
  // "image" (default — exactly today's behaviour) | "video". Picks the composer's
  // labelling and which controls exist; see the medium note at the top.
  medium = "image",
  // Header
  title, subtitle, headerExtra,
  // Data (from the surface's backend/loader)
  generations = [],
  models = [],
  prompts = [],
  sheetPrompts = {},
  promptRevisions = [],
  settings = {},
  // Status
  busy = false, pending = 0, error = null,
  // Copy / options
  emptyLabel = "no images yet — describe something below and hit Generate.",
  composerPlaceholder = "Describe a character or a place…",
  countOptions = COUNTS,
  aspects = ASPECTS,
  durations = VIDEO_DURATIONS,
  refPickerSources, // MediaPicker `sources` (undefined = its default set)
  // Show the character/location/prop sheet checkboxes in the composer (surfaces
  // whose backend understands `sheetType` — currently the Visual world).
  sheetTagging = false,
  // Remembered composer choice, so a reload doesn't drop the author back on the
  // catalog default: { model, aspectRatio, params }. Absent = today's behaviour.
  composerDefaults = null,
  // Backend actions (each optional; a missing one hides its affordance)
  onGenerate,          // async ({prompt, model, count, aspectRatio, presetId, sheetType, refs, mode, base, params, duration, generateAudio})
  onComposerChange,    // ({model, aspectRatio, params}) — debounced; the route persists it
  onDelete,            // async (gen)
  onSaveToLibrary,     // async (gen) => rel
  onAddToCanvas,       // async (gen)
  onSavePrompts,       // async (list)
  detailActions,       // (gen) => JSX  — surface-specific extra buttons in the detail modal
  onEditImage,         // if set, the detail modal shows an "Edit" button (edit-existing mode)
}) {
  const [open, setOpen] = useState(null); // generation open in the detail modal
  const t = useT();
  const gate = useProviderGate();
  const [pickRef, setPickRef] = useState(false);
  const [editPrompts, setEditPrompts] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const promptEd = useRef(null);

  // Composer state — seeded from the remembered composer choice, else settings.
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(composerDefaults?.model || settings.model || "");
  const [count, setCount] = useState(String(settings.count || 1));
  const [aspectRatio, setAspectRatio] = useState(composerDefaults?.aspectRatio || settings.aspectRatio || "16:9");
  const [presetId, setPresetId] = useState(settings.presetId ?? (prompts?.[0]?.id ?? ""));
  // "" | "character" | "location" | "prop" — tag the next generation as a design sheet
  // (mutually exclusive; the server layers the matching sheet prompt on top of
  // the style preset and stamps the metadata on the generation).
  const [sheetType, setSheetType] = useState("");
  const [refs, setRefs] = useState([]);
  // "new" | "variation" | "edit" — the generation intent (base holds the source gen).
  const [mode, setMode] = useState("new");
  const [base, setBase] = useState(null);
  // LEGACY video controls — what a model with no declared spec still gets: the
  // "Default" choice (the server resolves Seedance) and any older catalog.
  const [duration, setDuration] = useState(String(settings.duration || 5));
  const [generateAudio, setGenerateAudio] = useState(!!settings.generateAudio);
  // The model-declared param bag, `{ name: value }`, sent as `params`.
  const [params, setParams] = useState(() => ({ ...(composerDefaults?.params || {}) }));
  // Every value the author has landed on, across models — so hopping to a model
  // that drops `duration` and back again doesn't forget the 8 they chose.
  const stickyParams = useRef({ ...(composerDefaults?.params || {}) });

  const isVideo = medium === "video";
  const activeSpec = useMemo(() => models.find((m) => m.id && m.id === model) || null, [models, model]);
  // `null` = this model declares nothing (or the catalog hasn't landed): fall
  // back to the controls that were here before the catalog carried specs.
  //
  // VIDEO ONLY, deliberately. The worker's catalog now decorates image models
  // with a spec too, but only the video branch of `POST /generate` consumes a
  // `params` bag — so rendering generated controls on the image composer would
  // put a resolution dropdown on screen that changes nothing. When the image
  // path learns to forward `params`, drop the `isVideo &&` and this comment
  // together; nothing else here is medium-specific.
  const specParams = isVideo && Array.isArray(activeSpec?.params) ? activeSpec.params : null;
  const modelAspects = isVideo && Array.isArray(activeSpec?.aspectRatios) ? activeSpec.aspectRatios : null;
  const aspectOptions = modelAspects ?? aspects;
  const showAspect = aspectOptions.length > 0;
  // "How many clips" — only when the model has a batch_size to drive it.
  const batch = isVideo ? (activeSpec?.batch || null) : null;
  const videoCounts = useMemo(() => {
    if (!batch) return [];
    const lo = Math.max(1, Number(batch.min) || 1);
    const hi = Math.max(lo, Number(batch.max) || lo);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [batch]);
  const countChoices = isVideo ? videoCounts : countOptions;
  const showCount = isVideo ? countChoices.length > 1 : true;

  // Re-seed the bag whenever the SELECTED MODEL's spec changes. `seededFor`
  // holds the id we last seeded from, so the catalog arriving late (models are
  // fetched, the composer renders first) seeds once rather than every render.
  const seededFor = useRef(undefined);
  useEffect(() => {
    const key = specParams ? activeSpec.id : null;
    if (seededFor.current === key) return;
    const first = seededFor.current === undefined;
    seededFor.current = key;
    if (!specParams) {
      // Before the catalog lands, keep the remembered bag; once a spec-less
      // model is actually CHOSEN there is nothing declared left to send.
      if (!first) setParams({});
      return;
    }
    setParams((cur) => seedParams(specParams, { ...stickyParams.current, ...cur }));
    if (modelAspects?.length) setAspectRatio((cur) => (modelAspects.includes(cur) ? cur : modelAspects[0]));
    if (batch) {
      const n = Number(count) || Number(batch.default) || 1;
      setCount(String(Math.min(Number(batch.max), Math.max(Number(batch.min), n))));
    }
  }, [activeSpec, specParams, modelAspects, batch, count]);

  // A composer choice only gets persisted once the AUTHOR made it — the initial
  // seed and the catalog's late arrival must not fire a PUT.
  const composerDirty = useRef(false);
  const composerChangeRef = useRef(onComposerChange);
  useEffect(() => { composerChangeRef.current = onComposerChange; });
  useEffect(() => {
    if (!composerDirty.current || !composerChangeRef.current) return;
    // Debounced: a select spree (or a spin through a number box) is one write.
    const id = setTimeout(() => {
      composerChangeRef.current?.({ model, aspectRatio, params });
    }, 700);
    return () => clearTimeout(id);
  }, [model, aspectRatio, params]);

  const chooseModel = (id) => { composerDirty.current = true; setModel(id); };
  const chooseAspect = (a) => { composerDirty.current = true; setAspectRatio(a); };
  const setParam = (name, v) => {
    composerDirty.current = true;
    stickyParams.current = { ...stickyParams.current, [name]: v };
    setParams((cur) => ({ ...cur, [name]: v }));
  };

  const copy = MEDIUM_COPY[isVideo ? "video" : "image"];
  const isBusy = busy || localBusy;
  // A location sheet formalizes an EXISTING place — generating one without
  // reference art would just invent a new location, so a reference is required
  // (the server enforces this too).
  const needsRef = sheetTagging && sheetType === "location" && refs.length === 0;
  // A pasted/dropped image is still uploading — hold Generate so we never fire
  // with a ref that has no durable url yet.
  const uploadingRefs = refs.some((r) => r.uploading);

  // Cmd/Ctrl+V (or drop) of an image onto the prompt box → add it to the ref
  // tray exactly like a MediaPicker upload: show the local preview immediately,
  // upload to R2 in the background, then swap in the durable /files url. Files
  // that aren't images are ignored (this composer only takes reference images).
  const addPastedFiles = async (files) => {
    const images = Array.from(files || []).filter((f) => classifyFile(f) === "image");
    if (!images.length) return;
    const staged = images.map((file) => ({
      file,
      ref: withRefId({
        kind: "upload",
        url: undefined,
        thumb: URL.createObjectURL(file),
        name: file.name || "pasted image",
        uploading: true,
      }),
    }));
    setRefs((cur) => [...cur, ...staged.map((s) => s.ref)]);
    await Promise.all(
      staged.map(async ({ file, ref }) => {
        try {
          const data = await uploadAttachment(file);
          setRefs((cur) =>
            cur.map((r) => (r.id === ref.id ? { ...r, url: data.url, thumb: data.url, uploading: false } : r)),
          );
        } catch (e) {
          // Drop the failed chip — a paste that never uploaded just doesn't stick.
          setRefs((cur) => cur.filter((r) => r.id !== ref.id));
          console.error("paste upload failed", e);
        } finally {
          URL.revokeObjectURL(ref.thumb);
        }
      }),
    );
  };

  const doGenerate = async () => {
    if (!prompt.trim() || isBusy || !onGenerate || needsRef || uploadingRefs) return;
    // No render provider connected yet → pop the setup modal instead of firing a
    // request that would 401 (setup is skippable at login now).
    if (!gate.ensure(medium)) return;
    setLocalBusy(true);
    try {
      // "@imageN" chips serialize to plain tags; when any are present, prepend
      // the note that tells the model how tags map onto the attached refs.
      const { text, mentions } = promptEd.current?.getValue() ?? { text: prompt, mentions: [] };
      const outPrompt = mentions.length ? withImageRefNote(text) : text;
      // Whichever way this model spells "make sound" — for the legacy mirror.
      const audioParam = specParams?.find((p) => AUDIO_PARAMS.has(p.name));
      await onGenerate({
        prompt: outPrompt, model, presetId, refs, mode, base,
        // A model that declares no aspect ratio must not be sent one.
        aspectRatio: showAspect ? aspectRatio : undefined,
        // A video fan-out is minutes of provider time per extra take, so the
        // count is 1 unless the model itself offers a batch.
        count: isVideo ? (batch ? Number(count) : 1) : Number(count),
        sheetType: isVideo ? "" : sheetType,
        ...(specParams
          ? {
            params,
            // The legacy top-level fields stay ON TOP of the bag: the worker,
            // the Nodes canvas and the episode render path all still read them.
            ...("duration" in params ? { duration: Number(params.duration) } : {}),
            ...(audioParam ? { generateAudio: params[audioParam.name] === true || params[audioParam.name] === "on" } : {}),
          }
          : isVideo ? { duration: Number(duration), generateAudio } : {}),
      });
      // A fresh "new" generation clears the edit/variation intent.
      if (mode !== "new") { setMode("new"); setBase(null); }
    } finally { setLocalBusy(false); }
  };

  // Generic transforms on a result (no backend needed).
  const recreate = (g) => {
    setPrompt(g.prompt || "");
    promptEd.current?.setText(g.prompt || "");
    if (g.model) chooseModel(g.model);
    if (g.aspectRatio) chooseAspect(g.aspectRatio);
    if (g.presetId) setPresetId(g.presetId);
    if (g.duration) setDuration(String(g.duration));
    if ("generateAudio" in g) setGenerateAudio(!!g.generateAudio);
    // The stored bag goes back into the composer; if the recreate also switched
    // models, the re-seed above validates it against the new model's spec.
    if (g.params && typeof g.params === "object") {
      composerDirty.current = true;
      stickyParams.current = { ...stickyParams.current, ...g.params };
      setParams((cur) => ({ ...cur, ...g.params }));
    }
    setSheetType(g.sheetType || "");
    setRefs((g.refs || []).map((r) => withRefId({ ...r, thumb: r.url || r.thumb })));
    setMode("new"); setBase(null);
    setOpen(null);
  };
  const useAsRef = (g) => {
    setRefs((cur) => (cur.some((r) => r.genId === g.id) ? cur : [...cur, withRefId({ kind: "generation", genId: g.id, url: g.url, thumb: g.url, name: "gen" })]));
    setOpen(null);
  };
  // Edit-existing: seed the composer to edit this image in place (image + prompt).
  const editImage = (g) => {
    setMode("edit"); setBase(g);
    setRefs([withRefId({ kind: "generation", genId: g.id, url: g.url, thumb: g.url, name: "base" })]);
    setPrompt("");
    promptEd.current?.setText("");
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
            {pending > 0 && (
              <Badge variant="warning">
                <Loader2 size={11} className="animate-spin" />{" "}
                {isVideo ? t("{n} rendering", { n: pending }) : t("{n} generating", { n: pending })}
              </Badge>
            )}
            {typeof headerExtra === "function" ? headerExtra({ prompt }) : headerExtra}
          </div>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Results grid */}
      <Panel title={
        <span className="flex items-center gap-2">
          {isVideo ? <Film size={15} className="text-primary" /> : <Sparkles size={15} className="text-primary" />}
          {isVideo ? t("Clips") : t("Generations")}
        </span>
      }>
        {generations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>{t(emptyLabel)}</Empty>
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
            <Badge variant="info">{mode === "edit" ? t("Editing") : t("Variation of")}</Badge>
            <span className="truncate">{t("this image — describe the change, then Generate.")}</span>
            <Button variant="ghost" size="icon-sm" aria-label={t("Cancel")} onClick={() => { setMode("new"); setBase(null); }} className="ml-auto">
              <X size={13} />
            </Button>
          </div>
        )}
        {/* Reference chips */}
        {refs.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {refs.map((r, i) => (
              <div key={r.id || `${r.kind}-${r.rel || r.genId}-${i}`} className="group relative">
                <img src={toThumbSrc(r.thumb || r.url)} alt={r.name} className="h-12 w-12 rounded-md border object-cover" />
                {r.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60">
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  </div>
                )}
                {/* The "@" tag this reference answers to in the prompt. */}
                <span className="pointer-events-none absolute bottom-0 left-0 max-w-full truncate rounded-bl-md rounded-tr-md border-r border-t bg-background/85 px-1 text-[9px] font-medium text-muted-foreground">
                  {refTagLabel(i)}
                </span>
                <button
                  onClick={() => setRefs((cur) => cur.filter((_, j) => j !== i))}
                  aria-label={t("Remove reference")}
                  className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-destructive"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Prompt box — a TipTap editor so "@" pops the reference picker and
            picked refs become inline @imageN chips (Cmd/Ctrl+Enter generates). */}
        <PromptEditor
          ref={promptEd}
          refs={refs}
          placeholder={t(composerPlaceholder)}
          onChange={setPrompt}
          onSubmit={doGenerate}
          onPasteFiles={addPastedFiles}
          className="mb-2 max-h-40 min-h-16 w-full overflow-y-auto rounded-md border border-input bg-transparent px-3 py-2 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPickRef(true)} title={t(copy.refTitle)}>
            <ImagePlus size={13} /> {t(copy.refLabel)}
          </Button>

          {/* Model — one medium's catalog only, and it says which. */}
          <Select value={model || DEFAULT_MODEL} onValueChange={(v) => chooseModel(v === DEFAULT_MODEL ? "" : v)}>
            <SelectTrigger size="sm" aria-label={t(copy.modelLabel)} className="w-[180px] text-xs">
              <SelectValue placeholder={t(copy.modelPlaceholder)} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL}>{t(copy.modelDefault)}</SelectItem>
              {models.filter((m) => m.id).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              {models.filter((m) => m.id).length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t(copy.modelEmpty)}</div>
              )}
            </SelectContent>
          </Select>

          {/* Count — image fan-out, or a video model's own batch_size. */}
          {showCount && (
            <Select value={count} onValueChange={setCount}>
              <SelectTrigger size="sm" aria-label={isVideo ? t("How many clips") : t("How many images")} className="w-[92px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {countChoices.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {isVideo ? <>{n} {n > 1 ? t("clips") : t("clip")}</> : <>{n} {n > 1 ? t("images") : t("image")}</>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* The model's own controls — duration, resolution, mode, audio,
              whatever it declared, in declaration order. */}
          {specParams?.map((p) => (
            <ParamControl
              key={p.name}
              param={p}
              value={params[p.name] ?? p.default}
              onChange={(v) => setParam(p.name, v)}
            />
          ))}

          {/* No spec (the "Default" model, or a catalog that predates them):
              the Seedance-shaped duration + audio pair, as before. */}
          {isVideo && !specParams && (
            <>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger size="sm" aria-label={t("Clip duration")} className="w-[92px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{durations.map((d) => <SelectItem key={d} value={String(d)}>{d}s</SelectItem>)}</SelectContent>
              </Select>
              <label
                className="flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground has-[[data-state=checked]]:text-foreground"
                title={t("Generate audio with the clip")}
              >
                <Volume2 size={13} /> {t("Audio")}
                <Checkbox checked={generateAudio} onCheckedChange={(v) => setGenerateAudio(!!v)} aria-label={t("Generate audio")} />
              </label>
            </>
          )}

          {/* Aspect — the model's own list when it declares one; gone entirely
              when it declares an empty one (it takes no aspect ratio). */}
          {showAspect && (
            <Select value={aspectRatio} onValueChange={chooseAspect}>
              <SelectTrigger size="sm" aria-label={t("Aspect ratio")} className="w-[84px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{aspectOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          )}

          {/* Prompt preset (only when the surface manages presets) */}
          {onSavePrompts && (
            <Select value={presetId || NO_PRESET} onValueChange={(v) => setPresetId(v === NO_PRESET ? "" : v)}>
              <SelectTrigger size="sm" className="w-[190px] text-xs"><SelectValue placeholder={t("Prompt style")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRESET}>{t("No style preset")}</SelectItem>
                {prompts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {/* Sheet tagging — mutually exclusive checkboxes; the server layers the
              matching sheet prompt on top of the style preset. */}
          {sheetTagging && (
            <div className="flex h-8 items-center gap-3 rounded-md border px-2.5">
              {Object.entries(SHEET_TYPES).map(([key, { label, icon: TagIcon }]) => (
                <label key={key} className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground has-[[data-state=checked]]:text-foreground">
                  <Checkbox
                    checked={sheetType === key}
                    onCheckedChange={(v) => setSheetType(v ? key : "")}
                    aria-label={t(label)}
                  />
                  <TagIcon size={13} /> {t(label)}
                </label>
              ))}
              {onSavePrompts && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setEditPrompts(true)}
                  aria-label={t("Edit prompt library")}
                  title={t("Edit prompt library")}
                  className="-mr-1 text-muted-foreground hover:text-foreground"
                >
                  <Pencil size={13} />
                </Button>
              )}
            </div>
          )}
          {!sheetTagging && onSavePrompts && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setEditPrompts(true)}
              aria-label={t("Edit prompt library")}
              title={t("Edit prompt library")}
            >
              <Pencil size={13} />
            </Button>
          )}
          {needsRef && (
            <button
              type="button"
              onClick={() => setPickRef(true)}
              className="flex items-center gap-1.5 text-xs text-amber-500 hover:underline"
            >
              <AlertCircle size={13} /> {t("Location sheets need a reference image — add one")}
            </button>
          )}

          <Button
            size="sm"
            className="ml-auto"
            onClick={doGenerate}
            disabled={isBusy || !prompt.trim() || needsRef || uploadingRefs}
            title={needsRef ? t("Location sheets need a reference image — add one first") : undefined}
          >
            {isBusy
              ? <><Loader2 size={14} className="animate-spin" /> {t(copy.busy)}</>
              : <><Wand2 size={14} /> {t(copy.cta)}</>}
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
          ...items.map((it) => withRefId({
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
        <PromptLibraryDialog open={editPrompts} onOpenChange={setEditPrompts} medium={medium} prompts={prompts} sheetPrompts={sheetPrompts} revisions={promptRevisions} onSave={onSavePrompts} />
      )}
    </div>
  );
}
