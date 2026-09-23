import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  Globe, Users, BookOpen, Sparkles, Wand2, UserPlus, Trash2, Loader2,
  ImagePlus, X, Maximize2, Mic, MapPin, MapPinPlus, Anchor, Library, Check,
  PersonStanding,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy, createWorldMessage } from "@/components/AgentProvider";
import { useShell } from "@/lib/shellContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Eyebrow, Panel, Spinner, ErrorNote, ConfirmModal } from "@/components/shared";
import { ProductionTypeBadge, ProductionTypePicker } from "@/components/ProductionType";
import { normalizeProductionType } from "@/lib/productionType";
import { useEpisodes } from "@/components/EpisodeProvider";
import { FORMATS } from "@/lib/format";
import DocHistory from "@/components/DocHistory";
import MediaPicker from "@/components/MediaPicker";
import ShareDialog from "@/components/ShareDialog";
import { useT, t as staticT } from "@/lib/i18n";
import { toZoomSrc } from "@/lib/previewSrc";

/* ---------------------------------------------------------------- *
 * Section definitions — the pieces of the world bible               *
 * ---------------------------------------------------------------- */

// The story map: the 5 questions that shape the story.
const MAP = [
  { key: "world", label: "1. What is the world of your story?", hint: "Where is it taking place?" },
  { key: "protagonist", label: "2. Who is the protagonist?", hint: "What is their main goal?" },
  { key: "antagonist", label: "3. Who or what is the antagonist?", hint: "The force standing in the way." },
  { key: "stakes", label: "4. What is the stake if they fail?", hint: "What is lost if the goal isn't met?" },
  { key: "theme", label: "5. What theme or message is driving the story?", hint: "The idea underneath it all." },
];

// Story depth: the core elements that make us understand the story.
const DEPTH = [
  { key: "premise", label: "Premise", hint: "What is the story really about? Beyond the plot, what's the deeper message?" },
  { key: "wantVsNeed", label: "Character development", hint: "What they want vs. what they need." },
  { key: "conflict", label: "Conflict & stakes", hint: "Why should the audience care what these characters are going through?" },
  { key: "obstacles", label: "Obstacles & consequences", hint: "The obstacles the protagonist faces — and what happens if they fail." },
  { key: "structure", label: "Story structure", hint: "How the story is shaped (the arc / beats)." },
];

// One character's type breakdown.
const CHAR_FIELDS = [
  { key: "archetype", label: "Type / archetype", placeholder: "Protagonist, mentor, foil…", short: true },
  { key: "role", label: "Role in the story", placeholder: "What they do in the plot", short: true },
  { key: "want", label: "Want", placeholder: "Their conscious goal", short: true },
  { key: "need", label: "Need", placeholder: "What they actually need", short: true },
  { key: "traits", label: "Traits & personality", placeholder: "Bright, playful, stubborn…" },
  { key: "arc", label: "Arc", placeholder: "How they change" },
  { key: "voice", label: "Voice", placeholder: "How they speak" },
  { key: "appearance", label: "Appearance", placeholder: "Look / design notes" },
];

/* ---------------------------------------------------------------- *
 * Inline-editable field — saves on blur (only when changed)         *
 * ---------------------------------------------------------------- */

function WorldField({ value, onCommit, placeholder, rows = 3, mono, autoGrow, big }) {
  const [v, setV] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setV(value ?? ""); }, [value]);
  const commit = async () => {
    if ((v ?? "") === (value ?? "")) return;
    setSaving(true);
    try { await onCommit(v); } finally { setSaving(false); }
  };
  const base = cn(
    "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 leading-relaxed hover:border-border focus:border-primary focus:bg-background focus:outline-none",
    big ? "text-base leading-7" : "text-sm",
    mono && "font-mono",
  );
  // autoGrow: a mirror div in the same grid cell sizes the box to the content
  // height, so the textarea grows to fit everything — no max-height, no inner
  // scroll. Used by the "Expand" modal so each field shows its whole value.
  if (autoGrow) {
    return (
      <div className="relative grid">
        <textarea
          value={v}
          placeholder={placeholder}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          className={cn(base, "col-start-1 row-start-1 resize-none overflow-hidden")}
        />
        <div aria-hidden className={cn(base, "col-start-1 row-start-1 whitespace-pre-wrap break-words invisible")}>
          {(v || placeholder || "") + "\n"}
        </div>
        {saving && <Loader2 size={14} className="absolute right-2 top-2 animate-spin text-muted-foreground" />}
      </div>
    );
  }
  return (
    <div className="relative">
      <textarea
        rows={rows}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        className={cn(base, "resize-y")}
      />
      {saving && <Loader2 size={12} className="absolute right-2 top-2 animate-spin text-muted-foreground" />}
    </div>
  );
}

// A labelled prompt row (used for the story map + story depth).
function PromptRow({ label, hint, value, onCommit, rows, big, autoGrow }) {
  return (
    <div className="space-y-1">
      <Eyebrow className={cn("normal-case tracking-normal text-foreground/80", big && "text-sm")}>{label}</Eyebrow>
      {hint && <p className={cn("px-0.5 text-muted-foreground", big ? "text-sm" : "text-xs")}>{hint}</p>}
      <WorldField value={value} onCommit={onCommit} placeholder="—" rows={rows} big={big} autoGrow={autoGrow} />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Expand — a header button that opens a big, fully-editable modal    *
 * showing every field at a larger size with no inner scrolling.      *
 * ---------------------------------------------------------------- */

function ExpandSection({ title, icon, children }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t("Expand {title}", { title: typeof title === "string" ? title : t("section") })}
        className="text-muted-foreground"
      >
        <Maximize2 size={13} /> {t("Expand")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{icon} {title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}


/* ---------------------------------------------------------------- *
 * Voice picker — attach a liked Sound Studio voice to a character.   *
 * Voices are tracks with kind "voice"; likes live per audio version, *
 * so we surface every liked voice take. Fetches /api/sounds on open. *
 * ---------------------------------------------------------------- */

// Mirror of trackKind() in sounds.jsx: prefer the explicit kind, else sniff the
// v1 prompt for the voice builder's fixed lead-in (older, kind-less tracks).
const VOICE_RE = /^\s*(@audio\d|use a seed audio voice reference to voice-act)/i;
function isVoiceTrack(t) {
  if (t.kind === "voice") return true;
  if (t.kind === "sfx" || t.kind === "music") return false;
  const v1 = (t.versions || []).find((v) => v.v === 1) || (t.versions || [])[0];
  return VOICE_RE.test(v1?.prompt || "");
}

function VoicePicker({ open, onOpenChange, onPick }) {
  const t = useT();
  const [tracks, setTracks] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTracks(null);
    setError(null);
    setQ("");
    fetch("/api/sounds")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) throw new Error(j.error);
        setTracks(j.tracks || []);
      })
      .catch((e) => { if (!cancelled) setError(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [open]);

  // Every liked voice take across the Sound Studio, flattened into pickable
  // options. A search term filters by track name.
  const voices = useMemo(() => {
    const all = (tracks || [])
      .filter(isVoiceTrack)
      .flatMap((t) =>
        (t.versions || [])
          .filter((v) => v.liked && v.url)
          .map((v) => ({
            trackId: t.id,
            v: v.v,
            name: t.name || v.name || staticT("Untitled voice"),
            url: v.url,
          })),
      );
    const term = q.trim().toLowerCase();
    return term ? all.filter((o) => o.name.toLowerCase().includes(term)) : all;
  }, [tracks, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Attach a voice")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t("Your liked voices from the Sound Studio — like a voice take on the Sounds tab to see it here.")}
        </p>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search liked voices…")}
          className="h-8 text-sm"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        {tracks === null && !error ? (
          <div className="py-10"><Spinner /></div>
        ) : voices.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>{t("no liked voices yet — generate a voice on the Sounds tab and tap the heart to like a take.")}</Empty>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {voices.map((o) => (
              <div key={`${o.trackId}:${o.v}`} className="flex items-center gap-3 rounded-lg border p-2">
                <Mic size={16} className="shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {o.name} <span className="text-muted-foreground">v{o.v}</span>
                  </div>
                  <audio controls src={o.url} preload="none" className="mt-1 h-8 w-full" />
                </div>
                <Button size="sm" className="shrink-0" onClick={() => onPick(o)}>{t("Select")}</Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Character card                                                    *
 * ---------------------------------------------------------------- */

function CharacterCard({ char, onField, onRemove, onToggleAnchor, isSeries, expanded, is2d }) {
  const t = useT();
  const { setModalImage } = useShell();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const sheet = char.sheetImage;
  const mini = char.miniatureImage;
  const voiceRef = char.voiceRef;
  return (
    <div className={cn("rounded-lg border p-3", isSeries && char.anchor && "border-primary/40 bg-primary/5")}>
      <div className="mb-2 flex items-center gap-2">
        <input
          defaultValue={char.name}
          placeholder={t("Character name")}
          onBlur={(e) => e.target.value !== char.name && onField("name", e.target.value)}
          className={cn(
            "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-semibold hover:border-border focus:border-primary focus:bg-background focus:outline-none",
            expanded ? "text-lg" : "text-sm",
          )}
        />
        {char.archetype && <Badge variant="secondary" className="shrink-0">{char.archetype}</Badge>}
        {/* Anchor: keep this character in every new episode of the series. */}
        {isSeries && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={char.anchor ? t("Unanchor {name}", { name: char.name || t("character") }) : t("Anchor {name} across episodes", { name: char.name || t("character") })}
            title={char.anchor ? t("Anchored across episodes — carried into every new episode") : t("Anchor across episodes")}
            onClick={() => onToggleAnchor(char)}
            className={cn("shrink-0", char.anchor ? "text-primary" : "text-muted-foreground hover:text-primary")}
          >
            <Anchor size={14} className={char.anchor ? "fill-primary/20" : undefined} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={isSeries ? t("Remove {name} from this episode", { name: char.name || t("character") }) : t("Remove {name}", { name: char.name || t("character") })}
          title={isSeries ? t("Remove from this episode") : t("Delete character")}
          onClick={() => onRemove(char)}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Character sheet: once linked, the thumbnail + its controls live together
          in a contrasting gray card so they read as one unit. */}
      {sheet ? (
        <div className="mb-2 flex items-center gap-3 rounded-lg border bg-muted/60 p-2">
          <button
            type="button"
            onClick={() => setModalImage({ url: sheet.url, display: sheet.display || toZoomSrc(sheet.url), name: sheet.name || t("{name} sheet", { name: char.name || t("character") }), role: "asset" })}
            title={t("View full image")}
            className="shrink-0 overflow-hidden rounded-md border transition-colors hover:border-primary/60"
          >
            <img
              src={sheet.thumb || sheet.url}
              alt={sheet.name || t("{name} sheet", { name: char.name || t("character") })}
              className="h-28 w-28 object-cover"
            />
          </button>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <ImagePlus size={13} /> {t("Change character sheet")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onField("sheetImage", null)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X size={14} /> {t("Unlink")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <ImagePlus size={13} /> {t("Link character sheet")}
          </Button>
        </div>
      )}

      {/* Miniature: a full-figure reference used on WIDE / establishing shots,
          where this character is too small in frame for the close-up sheet to
          read. 2D projects only — the pipeline attaches it on wide shots (see
          the Episode tab's needs checklist). */}
      {is2d && (mini ? (
        <div className="mb-2 flex items-center gap-3 rounded-lg border bg-muted/60 p-2">
          <button
            type="button"
            onClick={() => setModalImage({ url: mini.url, display: mini.display || toZoomSrc(mini.url), name: mini.name || t("{name} miniature", { name: char.name || t("character") }), role: "asset" })}
            title={t("View full image")}
            className="shrink-0 overflow-hidden rounded-md border transition-colors hover:border-primary/60"
          >
            <img
              src={mini.thumb || mini.url}
              alt={mini.name || t("{name} miniature", { name: char.name || t("character") })}
              className="h-28 w-28 object-cover"
            />
          </button>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <PersonStanding size={13} className="text-primary" /> {t("Wide-shot miniature")}
            </span>
            <Button variant="outline" size="sm" onClick={() => setMiniOpen(true)}>
              <ImagePlus size={13} /> {t("Change miniature")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onField("miniatureImage", null)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X size={14} /> {t("Unlink")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <Button variant="outline" size="sm" onClick={() => setMiniOpen(true)}>
            <PersonStanding size={13} /> {t("Link wide-shot miniature")}
          </Button>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("A full-figure reference for wide shots where this character is small in frame.")}
          </p>
        </div>
      ))}

      {/* Voice: a liked Sound Studio take attached as this character's voice.
          Sits with the character sheet as the two linked assets of a character. */}
      {voiceRef ? (
        <div className="mb-2 flex items-center gap-3 rounded-lg border bg-muted/60 p-2">
          <Mic size={16} className="shrink-0 text-primary" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-sm font-medium">
              {voiceRef.name || t("Voice")}
              {voiceRef.v != null && <span className="text-muted-foreground"> · v{voiceRef.v}</span>}
            </span>
            {voiceRef.url && <audio controls src={voiceRef.url} preload="none" className="h-8 w-full max-w-sm" />}
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setVoiceOpen(true)}>
                <Mic size={13} /> {t("Change voice")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onField("voiceRef", null)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X size={14} /> {t("Unlink")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <Button variant="outline" size="sm" onClick={() => setVoiceOpen(true)}>
            <Mic size={13} /> {t("Attach voice")}
          </Button>
        </div>
      )}

      <div className={cn("grid gap-2", !expanded && "sm:grid-cols-2")}>
        {CHAR_FIELDS.map((f) => (
          <label key={f.key} className={cn("space-y-0.5", !expanded && !f.short && "sm:col-span-2")}>
            <span className={cn(
              "font-semibold uppercase tracking-wide text-muted-foreground",
              expanded ? "text-xs" : "text-[10px]",
            )}>{t(f.label)}</span>
            <WorldField
              value={char[f.key]}
              placeholder={t(f.placeholder)}
              rows={2}
              big={expanded}
              autoGrow={expanded}
              onCommit={(val) => onField(f.key, val)}
            />
          </label>
        ))}
      </div>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t("Link character sheet")}
        sources={["library", "upload"]}
        multiple={false}
        onAdd={([im]) => {
          if (im) onField("sheetImage", { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name });
        }}
      />

      <MediaPicker
        open={miniOpen}
        onOpenChange={setMiniOpen}
        title={t("Link wide-shot miniature")}
        sources={["library", "upload"]}
        multiple={false}
        onAdd={([im]) => {
          if (im) onField("miniatureImage", { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name });
        }}
      />

      <VoicePicker
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        onPick={(o) => {
          onField("voiceRef", { trackId: o.trackId, v: o.v, name: o.name, url: o.url });
          setVoiceOpen(false);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Location card — a place in the world, its slug (matches a shot's  *
 * `location`) and its reference-art sheet.                          *
 * ---------------------------------------------------------------- */

function LocationCard({ loc, onField, onRemove }) {
  const t = useT();
  const { setModalImage } = useShell();
  const [pickerOpen, setPickerOpen] = useState(false);
  const sheet = loc.sheetImage;
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          defaultValue={loc.name}
          placeholder={t("Location name")}
          onBlur={(e) => e.target.value !== loc.name && onField("name", e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold hover:border-border focus:border-primary focus:bg-background focus:outline-none"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Remove {name}", { name: loc.name || t("location") })}
          onClick={() => onRemove(loc)}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Slug — the key a shot's `location` string resolves to. */}
      <label className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Slug")}</span>
        <input
          defaultValue={loc.slug}
          placeholder="school-clearing"
          onBlur={(e) => e.target.value !== loc.slug && onField("slug", e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-muted/50 px-1.5 py-0.5 font-mono text-xs hover:border-border focus:border-primary focus:bg-background focus:outline-none"
        />
      </label>

      {/* Location sheet: the reference art fed to the image model as this place's
          background (same shape/flow as a character sheet). */}
      {sheet ? (
        <div className="mb-2 flex items-center gap-3 rounded-lg border bg-muted/60 p-2">
          <button
            type="button"
            onClick={() => setModalImage({ url: sheet.url, display: sheet.display || toZoomSrc(sheet.url), name: sheet.name || t("{name} sheet", { name: loc.name || t("location") }), role: "asset" })}
            title={t("View full image")}
            className="shrink-0 overflow-hidden rounded-md border transition-colors hover:border-primary/60"
          >
            <img
              src={sheet.thumb || sheet.url}
              alt={sheet.name || t("{name} sheet", { name: loc.name || t("location") })}
              className="h-28 w-28 object-cover"
            />
          </button>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <ImagePlus size={13} /> {t("Change location sheet")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onField("sheetImage", null)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X size={14} /> {t("Unlink")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <ImagePlus size={13} /> {t("Link location sheet")}
          </Button>
        </div>
      )}

      <label className="space-y-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Description")}</span>
        <WorldField
          value={loc.description}
          placeholder={t("What the place looks like — keep it consistent across scenes.")}
          rows={2}
          onCommit={(val) => onField("description", val)}
        />
      </label>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t("Link location sheet")}
        sources={["library", "upload"]}
        multiple={false}
        onAdd={([im]) => {
          if (im) onField("sheetImage", { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name });
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * "Add previous character" — the series character library picker     *
 * ---------------------------------------------------------------- */

function LibraryPicker({ open, onOpenChange, inRoster, onAdd }) {
  const t = useT();
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/world/characters/library")
      .then((r) => r.json())
      .then((d) => setLibrary(Array.isArray(d.characters) ? d.characters : []))
      .catch(() => setLibrary([]))
      .finally(() => setLoading(false));
  }, [open]);
  const available = library.filter((c) => !inRoster.has(c.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{t("Add a previous character")}</DialogTitle></DialogHeader>
        {loading ? (
          <div className="py-8"><Spinner /></div>
        ) : available.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Empty>{t("every character in the library is already in this episode.")}</Empty>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {available.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onAdd(c.id); onOpenChange(false); }}
                className="flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors hover:border-primary/60 hover:bg-accent"
              >
                {c.sheetImage ? (
                  <img src={c.sheetImage.thumb || c.sheetImage.url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
                    <Users size={16} className="text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{c.name || t("Unnamed")}</div>
                  {c.archetype && <div className="truncate text-xs text-muted-foreground">{c.archetype}</div>}
                </div>
                {c.anchor && <Anchor size={13} className="shrink-0 text-primary" />}
                <Check size={14} className="shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Route                                                             *
 * ---------------------------------------------------------------- */

function World() {
  const t = useT();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const world = useLoaderData();
  // Miniature references are a 2D affordance (wide-shot full-figure refs).
  const is2d = normalizeProductionType(world.productionType) === "2d";
  const { isSeries, active: activeEpisode, refresh: refreshEpisodes } = useEpisodes();
  const revalidator = useRevalidator();
  useRevalidateOnMount("world");
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // character pending removal
  const [confirmLoc, setConfirmLoc] = useState(null); // location pending removal
  const [libraryOpen, setLibraryOpen] = useState(false); // "add previous character" picker

  const revalidate = revalidator.revalidate;
  const refetch = useCallback(() => {
    invalidateTabCache("world");
    revalidate();
  }, [revalidate]);

  // The agent just wrote the world (save_world) → refresh when its turn ends.
  useRevalidateOnAgentIdle("world", agent.status);

  // One shared saver: PUT/POST/DELETE, then refetch so the tab reflects the write.
  const mutate = useCallback(async (path, init) => {
    setError(null);
    try {
      const res = await fetch(path, {
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
        ...init,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t("Save failed"));
      refetch();
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [refetch]);

  const patchWorld = (body) => mutate("/api/world", { method: "PUT", body: JSON.stringify(body) });
  const setMap = (key, val) => patchWorld({ map: { [key]: val } });
  const setDepth = (key, val) => patchWorld({ depth: { [key]: val } });
  // Flipping feature ⇄ series also refreshes the episode provider so the header
  // switcher appears/disappears immediately.
  const setFormat = async (id) => { await patchWorld({ format: id }); refreshEpisodes(); };
  const setChar = (id, key, val) =>
    mutate(`/api/world/character/${id}`, { method: "PUT", body: JSON.stringify({ [key]: val }) });
  const addChar = () => mutate("/api/world/character", { method: "POST", body: JSON.stringify({}) });
  const toggleAnchor = (char) =>
    mutate(`/api/world/character/${char.id}/anchor`, { method: "POST", body: JSON.stringify({ anchor: !char.anchor }) });
  const addFromLibrary = (id) => mutate("/api/episode/roster", { method: "POST", body: JSON.stringify({ id }) });
  // In a series the trash icon removes a character from THIS episode only; the
  // library keeps it (add it back via the picker). A feature film has one
  // implicit episode, so removal there is a full delete.
  const removeChar = (char) => {
    setConfirm(null);
    const scope = isSeries ? "episode" : "library";
    mutate(`/api/world/character/${char.id}?scope=${scope}`, { method: "DELETE" });
  };
  const setLoc = (id, key, val) =>
    mutate(`/api/world/location/${id}`, { method: "PUT", body: JSON.stringify({ [key]: val }) });
  const addLoc = () => mutate("/api/world/location", { method: "POST", body: JSON.stringify({}) });
  const removeLoc = (loc) => { setConfirmLoc(null); mutate(`/api/world/location/${loc.id}`, { method: "DELETE" }); };

  const createWithAgent = () => agent.send({ message: createWorldMessage() }).catch(() => {});

  const characters = world.characters || [];
  const locations = world.locations || [];
  const mapFilled = MAP.filter((m) => (world.map?.[m.key] || "").trim()).length;
  const depthFilled = DEPTH.filter((d) => (world.depth?.[d.key] || "").trim()).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t("World creation")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("The world that makes the series — define it here before you write the script.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Every save parks the previous version — this is the way back if
                a bad write (usually the agent's) flattens the bible. */}
            <DocHistory doc="world" onRestored={refetch} />
            <ShareDialog />
            <Button onClick={createWithAgent} disabled={agentBusy}>
              {agentBusy
                ? <><Loader2 size={14} className="animate-spin" /> {t("agent working…")}</>
                : <><Wand2 size={14} /> {t("Let's create the world")}</>}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline"><Globe size={11} /> {mapFilled}/{MAP.length} {t("story map")}</Badge>
          <Badge variant="outline"><BookOpen size={11} /> {depthFilled}/{DEPTH.length} {t("story depth")}</Badge>
          <Badge variant="info"><Users size={11} /> {characters.length} {t("characters")}</Badge>
          <Badge variant="info"><MapPin size={11} /> {locations.length} {t("locations")}</Badge>
          {agentBusy && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> {t("agent working…")}</Badge>}
          <span>{t("press “Let's create the world” to have the agent interview you, or fill any field in directly.")}</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Title + logline + production type */}
      <Panel
        title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> {t("The series")}</span>}
        meta={
          <div className="flex items-center gap-2">
            <ProductionTypeBadge value={world.productionType} long />
            <ExpandSection title={t("The series")} icon={<Sparkles size={18} className="text-primary" />}>
              <div className="space-y-1">
                <Eyebrow className="text-sm normal-case tracking-normal text-foreground/80">{t("Title")}</Eyebrow>
                <WorldField value={world.title} onCommit={(v) => patchWorld({ title: v })} placeholder={t("Untitled world")} big autoGrow />
              </div>
              <div className="space-y-1">
                <Eyebrow className="text-sm normal-case tracking-normal text-foreground/80">{t("Logline")}</Eyebrow>
                <WorldField value={world.logline} onCommit={(v) => patchWorld({ logline: v })} placeholder={t("One sentence that captures the series.")} big autoGrow />
              </div>
            </ExpandSection>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-1">
            <Eyebrow className="normal-case tracking-normal text-foreground/80">{t("Title")}</Eyebrow>
            <WorldField value={world.title} onCommit={(v) => patchWorld({ title: v })} placeholder={t("Untitled world")} rows={1} />
          </div>
          <div className="space-y-1">
            <Eyebrow className="normal-case tracking-normal text-foreground/80">{t("Logline")}</Eyebrow>
            <WorldField value={world.logline} onCommit={(v) => patchWorld({ logline: v })} placeholder={t("One sentence that captures the series.")} rows={2} />
          </div>
        </div>
        {/* Production type — the fork in the pipeline. It picks which shot-list
            skill the agent runs and, with it, the whole shape of every shot's
            Seedance prompt, so it is set here once before the script. */}
        <div className="mt-3 space-y-1.5 border-t pt-3">
          <Eyebrow className="normal-case tracking-normal text-foreground/80">{t("Production type")}</Eyebrow>
          <ProductionTypePicker
            value={world.productionType}
            onChange={(id) => patchWorld({ productionType: id })}
          />
          <p className="text-xs text-muted-foreground">
            {t("2D and 3D-Pixar shots get a one-paragraph Seedance prompt plus the Episode tab's style preset. Live action instead writes each shot as a full block prompt (scene context, optics, lighting, locks) — a different generation run entirely.")}
          </p>
        </div>
        {/* Format — one-off feature film, or an episodic series. A series unlocks
            per-episode scripts/shot lists/cuts and the episode switcher in the
            header; the world bible is shared across episodes. */}
        <div className="mt-3 space-y-1.5 border-t pt-3">
          <Eyebrow className="normal-case tracking-normal text-foreground/80">{t("Format")}</Eyebrow>
          <div className="inline-flex rounded-md border p-0.5">
            {FORMATS.map((f) => {
              const activeFmt = (world.format || "feature") === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormat(f.id)}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors",
                    activeFmt ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(f.label)}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("A series creates episodes, each with its own script, shot list, animatic and cut. The title, story map, locations and character library are shared; story depth and the cast are per episode, and anchored characters carry into every new episode.")}
          </p>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Story map — the 5 shaping questions */}
        <Panel
          title={<span className="flex items-center gap-2"><Globe size={15} className="text-primary" /> {t("Story map")}</span>}
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="outline">{mapFilled}/{MAP.length}</Badge>
              <ExpandSection title={t("Story map")} icon={<Globe size={18} className="text-primary" />}>
                {MAP.map((m) => (
                  <PromptRow key={m.key} label={t(m.label)} hint={t(m.hint)} value={world.map?.[m.key]} onCommit={(v) => setMap(m.key, v)} big autoGrow />
                ))}
              </ExpandSection>
            </div>
          }
        >
          <div className="space-y-4">
            {MAP.map((m) => (
              <PromptRow key={m.key} label={t(m.label)} hint={t(m.hint)} value={world.map?.[m.key]} onCommit={(v) => setMap(m.key, v)} />
            ))}
          </div>
        </Panel>

        {/* Story depth — the core elements */}
        <Panel
          title={<span className="flex items-center gap-2"><BookOpen size={15} className="text-primary" /> {t("Story depth")}</span>}
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="outline">{depthFilled}/{DEPTH.length}</Badge>
              <ExpandSection title={t("Story depth")} icon={<BookOpen size={18} className="text-primary" />}>
                <p className="text-sm text-muted-foreground">{t("Understand the story — the core elements beneath the plot.")}</p>
                {DEPTH.map((d) => (
                  <PromptRow key={d.key} label={t(d.label)} hint={t(d.hint)} value={world.depth?.[d.key]} onCommit={(v) => setDepth(d.key, v)} big autoGrow />
                ))}
              </ExpandSection>
            </div>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">{t("Understand the story — the core elements beneath the plot.")}</p>
          <div className="space-y-4">
            {DEPTH.map((d) => (
              <PromptRow key={d.key} label={t(d.label)} hint={t(d.hint)} value={world.depth?.[d.key]} onCommit={(v) => setDepth(d.key, v)} />
            ))}
          </div>
        </Panel>
      </div>

      {/* Characters */}
      <Panel
        title={<span className="flex items-center gap-2"><Users size={15} className="text-primary" /> {t("Characters")}</span>}
        meta={
          <div className="flex items-center gap-2">
            {isSeries && (
              <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
                <Library size={13} /> {t("Add from library")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={addChar}>
              <UserPlus size={13} /> {t("Add character")}
            </Button>
            {characters.length > 0 && (
              <ExpandSection title={t("Characters")} icon={<Users size={18} className="text-primary" />}>
                {characters.map((char) => (
                  <CharacterCard
                    key={char.id}
                    char={char}
                    expanded
                    isSeries={isSeries}
                    is2d={is2d}
                    onField={(key, val) => setChar(char.id, key, val)}
                    onRemove={setConfirm}
                    onToggleAnchor={toggleAnchor}
                  />
                ))}
              </ExpandSection>
            )}
          </div>
        }
      >
        {isSeries && activeEpisode && (
          <p className="mb-3 text-xs text-muted-foreground">
            {t("The cast for {ep}. Anchored characters carry into every new episode; use “Add from library” to bring back one created for another episode.", { ep: `Ep ${activeEpisode.number} · ${activeEpisode.title}` })}
          </p>
        )}
        {characters.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Empty>{t("no characters yet — add one, or let the agent build the roster.")}</Empty>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {characters.map((char) => (
              <CharacterCard
                key={char.id}
                char={char}
                isSeries={isSeries}
                is2d={is2d}
                onField={(key, val) => setChar(char.id, key, val)}
                onRemove={setConfirm}
                onToggleAnchor={toggleAnchor}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Locations — the places of the world; each shot's `location` slug resolves
          here so the Animatic can auto-supply the place's reference art. The
          `locations` id is the anchor the Animatic's "Add in World" button jumps to. */}
      <Panel
        id="locations"
        title={<span className="flex items-center gap-2"><MapPin size={15} className="text-primary" /> {t("Locations")}</span>}
        meta={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addLoc}>
              <MapPinPlus size={13} /> {t("Add location")}
            </Button>
          </div>
        }
      >
        {locations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Empty>{t("no locations yet — add the places your shots happen in so scenes get a consistent background.")}</Empty>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {locations.map((loc) => (
              <LocationCard
                key={loc.id}
                loc={loc}
                onField={(key, val) => setLoc(loc.id, key, val)}
                onRemove={setConfirmLoc}
              />
            ))}
          </div>
        )}
      </Panel>

      <ConfirmModal
        open={!!confirm}
        title={isSeries ? t("Remove from episode") : t("Remove character")}
        message={isSeries
          ? t("Remove “{name}” from this episode? It stays in the series library — add it back any time.", { name: confirm?.name || t("this character") })
          : t("Remove “{name}” from the world? This can't be undone.", { name: confirm?.name || t("this character") })}
        onConfirm={() => removeChar(confirm)}
        onCancel={() => setConfirm(null)}
      />

      <LibraryPicker
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        inRoster={new Set(characters.map((c) => c.id))}
        onAdd={addFromLibrary}
      />

      <ConfirmModal
        open={!!confirmLoc}
        title={t("Remove location")}
        message={t("Remove “{name}” from the world? This can't be undone.", { name: confirmLoc?.name || t("this location") })}
        onConfirm={() => removeLoc(confirmLoc)}
        onCancel={() => setConfirmLoc(null)}
      />
    </div>
  );
}

// Loader: the world bible (story map + story depth + characters).
export function loader() {
  return swr("world", async () => {
    const res = await fetch("/api/world");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || staticT("Failed to load"));
    return json;
  });
}

export { World };

export function Component() {
  return <World />;
}
