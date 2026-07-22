import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  Globe, Users, BookOpen, Sparkles, Wand2, UserPlus, Trash2, Loader2,
  ImagePlus, X, Maximize2, Mic, MapPin, MapPinPlus,
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
import MediaPicker from "@/components/MediaPicker";

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
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Expand ${typeof title === "string" ? title : "section"}`}
        className="text-muted-foreground"
      >
        <Maximize2 size={13} /> Expand
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
            name: t.name || v.name || "Untitled voice",
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
          <DialogTitle>Attach a voice</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Your liked voices from the Sound Studio — like a voice take on the Sounds tab to see it here.
        </p>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search liked voices…"
          className="h-8 text-sm"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        {tracks === null && !error ? (
          <div className="py-10"><Spinner /></div>
        ) : voices.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>no liked voices yet — generate a voice on the Sounds tab and tap the heart to like a take.</Empty>
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
                <Button size="sm" className="shrink-0" onClick={() => onPick(o)}>Select</Button>
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

function CharacterCard({ char, onField, onRemove, expanded }) {
  const { setModalImage } = useShell();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const sheet = char.sheetImage;
  const voiceRef = char.voiceRef;
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          defaultValue={char.name}
          placeholder="Character name"
          onBlur={(e) => e.target.value !== char.name && onField("name", e.target.value)}
          className={cn(
            "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-semibold hover:border-border focus:border-primary focus:bg-background focus:outline-none",
            expanded ? "text-lg" : "text-sm",
          )}
        />
        {char.archetype && <Badge variant="secondary" className="shrink-0">{char.archetype}</Badge>}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${char.name || "character"}`}
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
            onClick={() => setModalImage({ url: sheet.url, name: sheet.name || `${char.name || "character"} sheet`, role: "asset" })}
            title="View full image"
            className="shrink-0 overflow-hidden rounded-md border transition-colors hover:border-primary/60"
          >
            <img
              src={sheet.thumb || sheet.url}
              alt={sheet.name || `${char.name || "character"} sheet`}
              className="h-28 w-28 object-cover"
            />
          </button>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <ImagePlus size={13} /> Change character sheet
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onField("sheetImage", null)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X size={14} /> Unlink
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <ImagePlus size={13} /> Link character sheet
          </Button>
        </div>
      )}

      {/* Voice: a liked Sound Studio take attached as this character's voice.
          Sits with the character sheet as the two linked assets of a character. */}
      {voiceRef ? (
        <div className="mb-2 flex items-center gap-3 rounded-lg border bg-muted/60 p-2">
          <Mic size={16} className="shrink-0 text-primary" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-sm font-medium">
              {voiceRef.name || "Voice"}
              {voiceRef.v != null && <span className="text-muted-foreground"> · v{voiceRef.v}</span>}
            </span>
            {voiceRef.url && <audio controls src={voiceRef.url} preload="none" className="h-8 w-full max-w-sm" />}
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setVoiceOpen(true)}>
                <Mic size={13} /> Change voice
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onField("voiceRef", null)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X size={14} /> Unlink
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <Button variant="outline" size="sm" onClick={() => setVoiceOpen(true)}>
            <Mic size={13} /> Attach voice
          </Button>
        </div>
      )}

      <div className={cn("grid gap-2", !expanded && "sm:grid-cols-2")}>
        {CHAR_FIELDS.map((f) => (
          <label key={f.key} className={cn("space-y-0.5", !expanded && !f.short && "sm:col-span-2")}>
            <span className={cn(
              "font-semibold uppercase tracking-wide text-muted-foreground",
              expanded ? "text-xs" : "text-[10px]",
            )}>{f.label}</span>
            <WorldField
              value={char[f.key]}
              placeholder={f.placeholder}
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
        title="Link character sheet"
        sources={["library"]}
        multiple={false}
        onAdd={([im]) => {
          if (im) onField("sheetImage", { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name });
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
  const { setModalImage } = useShell();
  const [pickerOpen, setPickerOpen] = useState(false);
  const sheet = loc.sheetImage;
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          defaultValue={loc.name}
          placeholder="Location name"
          onBlur={(e) => e.target.value !== loc.name && onField("name", e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold hover:border-border focus:border-primary focus:bg-background focus:outline-none"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${loc.name || "location"}`}
          onClick={() => onRemove(loc)}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Slug — the key a shot's `location` string resolves to. */}
      <label className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Slug</span>
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
            onClick={() => setModalImage({ url: sheet.url, name: sheet.name || `${loc.name || "location"} sheet`, role: "asset" })}
            title="View full image"
            className="shrink-0 overflow-hidden rounded-md border transition-colors hover:border-primary/60"
          >
            <img
              src={sheet.thumb || sheet.url}
              alt={sheet.name || `${loc.name || "location"} sheet`}
              className="h-28 w-28 object-cover"
            />
          </button>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <ImagePlus size={13} /> Change location sheet
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onField("sheetImage", null)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X size={14} /> Unlink
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <ImagePlus size={13} /> Link location sheet
          </Button>
        </div>
      )}

      <label className="space-y-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Description</span>
        <WorldField
          value={loc.description}
          placeholder="What the place looks like — keep it consistent across scenes."
          rows={2}
          onCommit={(val) => onField("description", val)}
        />
      </label>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Link location sheet"
        sources={["library"]}
        multiple={false}
        onAdd={([im]) => {
          if (im) onField("sheetImage", { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name });
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Route                                                             *
 * ---------------------------------------------------------------- */

function World() {
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const world = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("world");
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // character pending removal
  const [confirmLoc, setConfirmLoc] = useState(null); // location pending removal

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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      refetch();
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [refetch]);

  const patchWorld = (body) => mutate("/api/world", { method: "PUT", body: JSON.stringify(body) });
  const setMap = (key, val) => patchWorld({ map: { [key]: val } });
  const setDepth = (key, val) => patchWorld({ depth: { [key]: val } });
  const setChar = (id, key, val) =>
    mutate(`/api/world/character/${id}`, { method: "PUT", body: JSON.stringify({ [key]: val }) });
  const addChar = () => mutate("/api/world/character", { method: "POST", body: JSON.stringify({}) });
  const removeChar = (char) => { setConfirm(null); mutate(`/api/world/character/${char.id}`, { method: "DELETE" }); };
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
            <h2 className="text-xl font-semibold tracking-tight">World creation</h2>
            <p className="text-sm text-muted-foreground">
              The world that makes the series — define it here before you write the script.
            </p>
          </div>
          <Button onClick={createWithAgent} disabled={agentBusy}>
            {agentBusy
              ? <><Loader2 size={14} className="animate-spin" /> agent working…</>
              : <><Wand2 size={14} /> Let's create the world</>}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline"><Globe size={11} /> {mapFilled}/{MAP.length} story map</Badge>
          <Badge variant="outline"><BookOpen size={11} /> {depthFilled}/{DEPTH.length} story depth</Badge>
          <Badge variant="info"><Users size={11} /> {characters.length} characters</Badge>
          <Badge variant="info"><MapPin size={11} /> {locations.length} locations</Badge>
          {agentBusy && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> agent working…</Badge>}
          <span>press “Let's create the world” to have the agent interview you, or fill any field in directly.</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Title + logline */}
      <Panel
        title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> The series</span>}
        meta={
          <ExpandSection title="The series" icon={<Sparkles size={18} className="text-primary" />}>
            <div className="space-y-1">
              <Eyebrow className="text-sm normal-case tracking-normal text-foreground/80">Title</Eyebrow>
              <WorldField value={world.title} onCommit={(v) => patchWorld({ title: v })} placeholder="Untitled world" big autoGrow />
            </div>
            <div className="space-y-1">
              <Eyebrow className="text-sm normal-case tracking-normal text-foreground/80">Logline</Eyebrow>
              <WorldField value={world.logline} onCommit={(v) => patchWorld({ logline: v })} placeholder="One sentence that captures the series." big autoGrow />
            </div>
          </ExpandSection>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-1">
            <Eyebrow className="normal-case tracking-normal text-foreground/80">Title</Eyebrow>
            <WorldField value={world.title} onCommit={(v) => patchWorld({ title: v })} placeholder="Untitled world" rows={1} />
          </div>
          <div className="space-y-1">
            <Eyebrow className="normal-case tracking-normal text-foreground/80">Logline</Eyebrow>
            <WorldField value={world.logline} onCommit={(v) => patchWorld({ logline: v })} placeholder="One sentence that captures the series." rows={2} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Story map — the 5 shaping questions */}
        <Panel
          title={<span className="flex items-center gap-2"><Globe size={15} className="text-primary" /> Story map</span>}
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="outline">{mapFilled}/{MAP.length}</Badge>
              <ExpandSection title="Story map" icon={<Globe size={18} className="text-primary" />}>
                {MAP.map((m) => (
                  <PromptRow key={m.key} label={m.label} hint={m.hint} value={world.map?.[m.key]} onCommit={(v) => setMap(m.key, v)} big autoGrow />
                ))}
              </ExpandSection>
            </div>
          }
        >
          <div className="space-y-4">
            {MAP.map((m) => (
              <PromptRow key={m.key} label={m.label} hint={m.hint} value={world.map?.[m.key]} onCommit={(v) => setMap(m.key, v)} />
            ))}
          </div>
        </Panel>

        {/* Story depth — the core elements */}
        <Panel
          title={<span className="flex items-center gap-2"><BookOpen size={15} className="text-primary" /> Story depth</span>}
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="outline">{depthFilled}/{DEPTH.length}</Badge>
              <ExpandSection title="Story depth" icon={<BookOpen size={18} className="text-primary" />}>
                <p className="text-sm text-muted-foreground">Understand the story — the core elements beneath the plot.</p>
                {DEPTH.map((d) => (
                  <PromptRow key={d.key} label={d.label} hint={d.hint} value={world.depth?.[d.key]} onCommit={(v) => setDepth(d.key, v)} big autoGrow />
                ))}
              </ExpandSection>
            </div>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">Understand the story — the core elements beneath the plot.</p>
          <div className="space-y-4">
            {DEPTH.map((d) => (
              <PromptRow key={d.key} label={d.label} hint={d.hint} value={world.depth?.[d.key]} onCommit={(v) => setDepth(d.key, v)} />
            ))}
          </div>
        </Panel>
      </div>

      {/* Characters */}
      <Panel
        title={<span className="flex items-center gap-2"><Users size={15} className="text-primary" /> Characters</span>}
        meta={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addChar}>
              <UserPlus size={13} /> Add character
            </Button>
            {characters.length > 0 && (
              <ExpandSection title="Characters" icon={<Users size={18} className="text-primary" />}>
                {characters.map((char) => (
                  <CharacterCard
                    key={char.id}
                    char={char}
                    expanded
                    onField={(key, val) => setChar(char.id, key, val)}
                    onRemove={setConfirm}
                  />
                ))}
              </ExpandSection>
            )}
          </div>
        }
      >
        {characters.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Empty>no characters yet — add one, or let the agent build the roster.</Empty>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {characters.map((char) => (
              <CharacterCard
                key={char.id}
                char={char}
                onField={(key, val) => setChar(char.id, key, val)}
                onRemove={setConfirm}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Locations — the places of the world; each shot's `location` slug resolves
          here so the Animatic can auto-supply the place's reference art. */}
      <Panel
        title={<span className="flex items-center gap-2"><MapPin size={15} className="text-primary" /> Locations</span>}
        meta={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addLoc}>
              <MapPinPlus size={13} /> Add location
            </Button>
          </div>
        }
      >
        {locations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Empty>no locations yet — add the places your shots happen in so scenes get a consistent background.</Empty>
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
        title="Remove character"
        message={`Remove “${confirm?.name || "this character"}” from the world? This can't be undone.`}
        onConfirm={() => removeChar(confirm)}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmModal
        open={!!confirmLoc}
        title="Remove location"
        message={`Remove “${confirmLoc?.name || "this location"}” from the world? This can't be undone.`}
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
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export { World };

export function Component() {
  return <World />;
}
