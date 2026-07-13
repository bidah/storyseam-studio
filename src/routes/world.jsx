import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  Globe, Users, BookOpen, Sparkles, Wand2, UserPlus, Trash2, Loader2,
  ImagePlus, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { useAgent, agentIsBusy, createWorldMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Eyebrow, Panel, Spinner, ErrorNote, ConfirmModal } from "@/components/shared";

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

function WorldField({ value, onCommit, placeholder, rows = 3, mono }) {
  const [v, setV] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setV(value ?? ""); }, [value]);
  const commit = async () => {
    if ((v ?? "") === (value ?? "")) return;
    setSaving(true);
    try { await onCommit(v); } finally { setSaving(false); }
  };
  return (
    <div className="relative">
      <textarea
        rows={rows}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        className={cn(
          "w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed hover:border-border focus:border-primary focus:bg-background focus:outline-none",
          mono && "font-mono",
        )}
      />
      {saving && <Loader2 size={12} className="absolute right-2 top-2 animate-spin text-muted-foreground" />}
    </div>
  );
}

// A labelled prompt row (used for the story map + story depth).
function PromptRow({ label, hint, value, onCommit, rows }) {
  return (
    <div className="space-y-1">
      <Eyebrow className="normal-case tracking-normal text-foreground/80">{label}</Eyebrow>
      {hint && <p className="px-0.5 text-xs text-muted-foreground">{hint}</p>}
      <WorldField value={value} onCommit={onCommit} placeholder="—" rows={rows} />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Character-sheet picker — pick a linked image from the project's    *
 * asset library (the selected/final_selection images, never the raw  *
 * Higgsfield library). Fetches /api/library lazily on open.          *
 * ---------------------------------------------------------------- */

function CharacterSheetPicker({ open, onOpenChange, onPick }) {
  const [folders, setFolders] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFolders(null);
    setError(null);
    setQ("");
    fetch("/api/library")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) throw new Error(j.error);
        setFolders(j.folders || []);
      })
      .catch((e) => { if (!cancelled) setError(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [open]);

  // Flatten every asset-library image across folders (the project's own library,
  // never the raw Higgsfield one), tagging each with its folder so the caption
  // reads sensibly. A search term filters by name or folder.
  const images = useMemo(() => {
    const all = (folders || []).flatMap((f) =>
      f.images.map((im) => ({ ...im, folder: f.folder })),
    );
    const term = q.trim().toLowerCase();
    return term
      ? all.filter((im) => `${im.name} ${im.folder}`.toLowerCase().includes(term))
      : all;
  }, [folders, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Link character sheet</DialogTitle>
        </DialogHeader>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the selected asset library…"
          className="h-8 text-sm"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        {folders === null && !error ? (
          <div className="py-10"><Spinner /></div>
        ) : images.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>no images in the asset library yet — add some on the Library tab.</Empty>
          </div>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5">
            {images.map((im) => (
              <button
                key={im.rel}
                onClick={() => onPick(im)}
                className="group relative overflow-hidden rounded-lg border border-border bg-muted text-left transition-colors hover:border-primary/60"
                title={`${im.folder} / ${im.name}`}
              >
                <img src={im.thumb || im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
                {im.selected && <Badge className="absolute left-1 top-1 px-1.5 py-0 text-[9px]">selected</Badge>}
                <div className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{im.name}</div>
              </button>
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

function CharacterCard({ char, onField, onRemove }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const sheet = char.sheetImage;
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          defaultValue={char.name}
          placeholder="Character name"
          onBlur={(e) => e.target.value !== char.name && onField("name", e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold hover:border-border focus:border-primary focus:bg-background focus:outline-none"
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

      {/* Character sheet: the linked library image + link/change/unlink controls */}
      <div className="mb-2 flex items-center gap-2">
        {sheet && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            title="Change character sheet"
            className="shrink-0 overflow-hidden rounded-md border transition-colors hover:border-primary/60"
          >
            <img
              src={sheet.thumb || sheet.url}
              alt={sheet.name || `${char.name || "character"} sheet`}
              className="h-14 w-14 object-cover"
            />
          </button>
        )}
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <ImagePlus size={13} /> {sheet ? "Change character sheet" : "Link character sheet"}
        </Button>
        {sheet && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Unlink character sheet"
            onClick={() => onField("sheetImage", null)}
            className="text-muted-foreground hover:text-destructive"
          >
            <X size={14} />
          </Button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {CHAR_FIELDS.map((f) => (
          <label key={f.key} className={cn("space-y-0.5", !f.short && "sm:col-span-2")}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</span>
            <WorldField
              value={char[f.key]}
              placeholder={f.placeholder}
              rows={f.short ? 2 : 2}
              onCommit={(val) => onField(f.key, val)}
            />
          </label>
        ))}
      </div>

      <CharacterSheetPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(im) => {
          onField("sheetImage", { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name });
          setPickerOpen(false);
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

  const refetch = useCallback(() => {
    invalidateTabCache("world");
    revalidator.revalidate();
  }, [revalidator]);

  // The agent just wrote the world (save_world) → refresh when its turn ends.
  useEffect(() => { if (agent.status === "ready") refetch(); }, [agent.status, refetch]);

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

  const createWithAgent = () => agent.send({ message: createWorldMessage() }).catch(() => {});

  const characters = world.characters || [];
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
          {agentBusy && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> agent working…</Badge>}
          <span>press “Let's create the world” to have the agent interview you, or fill any field in directly.</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Title + logline */}
      <Panel title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> The series</span>}>
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
          meta={<Badge variant="outline">{mapFilled}/{MAP.length}</Badge>}
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
          meta={<Badge variant="outline">{depthFilled}/{DEPTH.length}</Badge>}
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
          <Button variant="outline" size="sm" onClick={addChar}>
            <UserPlus size={13} /> Add character
          </Button>
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

      <ConfirmModal
        open={!!confirm}
        title="Remove character"
        message={`Remove “${confirm?.name || "this character"}” from the world? This can't be undone.`}
        onConfirm={() => removeChar(confirm)}
        onCancel={() => setConfirm(null)}
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
