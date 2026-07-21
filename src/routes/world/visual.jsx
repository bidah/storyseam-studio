import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  Wand2, Loader2, Sparkles, ImagePlus, X, Plus, Trash2, RefreshCw,
  Copy, Library, Pencil, Layers, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy, createVisualWorldMessage } from "@/components/AgentProvider";
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
import { Empty, Eyebrow, Panel, Spinner, ErrorNote } from "@/components/shared";

const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const COUNTS = [1, 2, 3, 4];
// Radix Select forbids an empty-string item value, so the "none"/"default"
// choices use sentinels mapped back to "" (server resolves the default model).
const NO_PRESET = "__none__";
const DEFAULT_MODEL = "__default__";

/* ---------------------------------------------------------------- *
 * Reference picker — pick a library image to condition generation.  *
 * Same source as the written world's CharacterSheetPicker.          *
 * ---------------------------------------------------------------- */

function LibraryPicker({ open, onOpenChange, onPick }) {
  const [folders, setFolders] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFolders(null); setError(null); setQ("");
    fetch("/api/library")
      .then((r) => r.json())
      .then((j) => { if (cancelled) return; if (j.error) throw new Error(j.error); setFolders(j.folders || []); })
      .catch((e) => { if (!cancelled) setError(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [open]);

  const images = useMemo(() => {
    const all = (folders || []).flatMap((f) => f.images.map((im) => ({ ...im, folder: f.folder })));
    const term = q.trim().toLowerCase();
    return term ? all.filter((im) => `${im.name} ${im.folder}`.toLowerCase().includes(term)) : all;
  }, [folders, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>Add a reference image</DialogTitle></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the asset library…" className="h-8 text-sm" />
        {error && <ErrorNote>{error}</ErrorNote>}
        {folders === null && !error ? (
          <div className="py-10"><Spinner /></div>
        ) : images.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>no images in the asset library yet — generate some, or import on the Library tab.</Empty>
          </div>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5">
            {images.map((im) => (
              <button
                key={im.rel}
                onClick={() => onPick({ kind: "library", rel: im.rel, url: im.url, thumb: im.thumb || im.url, name: im.name })}
                className="group relative overflow-hidden rounded-lg border border-border bg-muted text-left transition-colors hover:border-primary/60"
                title={`${im.folder} / ${im.name}`}
              >
                <img src={im.thumb || im.url} loading="lazy" alt={im.name} className="aspect-square w-full object-cover" />
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

function GenerationCard({ gen, onOpen }) {
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

function GenerationDetail({ gen, onClose, onRecreate, onUseAsRef, onAddToCanvas, onSaveToLibrary, onDelete }) {
  const { setModalImage } = useShell();
  const [savedRel, setSavedRel] = useState(null);
  if (!gen) return null;
  return (
    <Dialog open={!!gen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle className="text-sm font-medium text-muted-foreground">Generation</DialogTitle></DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <button
            type="button"
            onClick={() => setModalImage({ url: gen.url, name: gen.prompt || "generation", role: "asset" })}
            className="overflow-hidden rounded-lg border bg-muted"
            title="View full image"
          >
            <img src={gen.url} alt={gen.prompt} className="max-h-[70vh] w-full object-contain" />
          </button>
          <div className="space-y-3">
            <div>
              <Eyebrow className="normal-case tracking-normal text-foreground/70">Prompt</Eyebrow>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{gen.prompt || "—"}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {gen.model && <Badge variant="outline">{gen.model}</Badge>}
              <Badge variant="outline">{gen.aspectRatio}</Badge>
              {gen.refs?.length > 0 && <Badge variant="info"><ImagePlus size={11} /> {gen.refs.length} ref</Badge>}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => onRecreate(gen)}><RefreshCw size={13} /> Recreate</Button>
              <Button size="sm" variant="outline" onClick={() => onUseAsRef(gen)}><ImagePlus size={13} /> Use as reference</Button>
              <Button size="sm" variant="outline" onClick={() => onAddToCanvas(gen)}><Layers size={13} /> Add to canvas</Button>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(gen.prompt || "")}><Copy size={13} /> Copy prompt</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm" variant="outline"
                onClick={async () => { const rel = await onSaveToLibrary(gen); if (rel) setSavedRel(rel); }}
              >
                <Library size={13} /> {savedRel ? "Saved to library" : "Save to library"}
              </Button>
              {savedRel && <span className="text-xs text-muted-foreground">→ {savedRel}</span>}
              <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => { onDelete(gen); onClose(); }}>
                <Trash2 size={13} /> Delete
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Route                                                             *
 * ---------------------------------------------------------------- */

function Visual() {
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const world = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("visual-world");
  useRevalidateOnAgentIdle("visual-world", agent.status);

  const revalidate = revalidator.revalidate;
  const refetch = useCallback(() => { invalidateTabCache("visual-world"); revalidate(); }, [revalidate]);

  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // generation open in the detail modal
  const [pickRef, setPickRef] = useState(false);
  const [editPrompts, setEditPrompts] = useState(false);

  // Composer state — seeded from remembered settings.
  const s = world.settings || {};
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(s.model || "");
  const [count, setCount] = useState(String(s.count || 1));
  const [aspectRatio, setAspectRatio] = useState(s.aspectRatio || "16:9");
  const [presetId, setPresetId] = useState(s.presetId || (world.prompts?.[0]?.id ?? ""));
  const [refs, setRefs] = useState([]);

  // The real Higgsfield image-model catalog for the selector. Best-effort — if not
  // signed in, the empty value still works (the server resolves Nano Banana Pro).
  const [models, setModels] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/visual-world/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.models) setModels(j.models); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const generations = world.generations || [];
  const prompts = world.prompts || [];

  // Poll while any card is still processing.
  const pollingRef = useRef(false);
  useEffect(() => {
    if (!generations.some((g) => g.status === "processing")) return;
    let stop = false;
    const tick = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try { await fetch("/api/visual-world/poll"); } catch { /* transient */ }
      finally { pollingRef.current = false; }
      if (!stop) refetch();
    };
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [generations, refetch]);

  const api = useCallback(async (path, init) => {
    setError(null);
    const res = await fetch(path, { headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Request failed");
    return j;
  }, []);

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api("/api/visual-world/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt, model, count: Number(count), aspectRatio, presetId,
          refs: refs.map((r) => ({ kind: r.kind, rel: r.rel, genId: r.genId })),
        }),
      });
      refetch();
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(false); }
  };

  const recreate = (g) => {
    setPrompt(g.prompt || "");
    if (g.model) setModel(g.model);
    if (g.aspectRatio) setAspectRatio(g.aspectRatio);
    if (g.presetId) setPresetId(g.presetId);
    setRefs((g.refs || []).map((r) => ({ ...r, thumb: r.url })));
    setOpen(null);
  };
  const useAsRef = (g) => {
    setRefs((cur) => (cur.some((r) => r.genId === g.id) ? cur : [...cur, { kind: "generation", genId: g.id, url: g.url, thumb: g.url, name: "gen" }]));
    setOpen(null);
  };
  const addToCanvas = async (g) => {
    const board = structuredClone(world.board || { nodes: [], edges: [], viewport: null });
    if (!board.nodes.some((n) => n.genId === g.id)) {
      const i = board.nodes.length;
      board.nodes.push({ id: `node-${g.id}`, genId: g.id, x: 60 + (i % 5) * 220, y: 60 + Math.floor(i / 5) * 220, w: null, h: null });
      try { await api("/api/visual-world/board", { method: "PUT", body: JSON.stringify({ board }) }); refetch(); }
      catch (e) { setError(String(e.message || e)); }
    }
  };
  const saveToLibrary = async (g) => {
    try {
      const j = await api("/api/visual-world/save-to-library", { method: "POST", body: JSON.stringify({ id: g.id, name: g.id }) });
      return j.rel;
    } catch (e) { setError(String(e.message || e)); return null; }
  };
  const del = async (g) => {
    try { await api(`/api/visual-world/generation/${g.id}`, { method: "DELETE" }); refetch(); }
    catch (e) { setError(String(e.message || e)); }
  };
  const savePrompts = async (list) => {
    try { await api("/api/visual-world/prompts", { method: "PUT", body: JSON.stringify({ prompts: list }) }); refetch(); }
    catch (e) { setError(String(e.message || e)); }
  };

  const pending = generations.filter((g) => g.status === "processing").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Visual world</h2>
          <p className="text-sm text-muted-foreground">
            Explore how the world looks — generate concept images to find your characters and places.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 && <Badge variant="warning"><Loader2 size={11} className="animate-spin" /> {pending} generating</Badge>}
          <Button
            variant="outline"
            onClick={() => agent.send({ message: createVisualWorldMessage(prompt.trim() || undefined) }).catch(() => {})}
            disabled={agentBusy}
            title={agentBusy ? "Agent is busy — wait for the current turn" : "Let the agent explore the look for you"}
          >
            {agentBusy ? <><Loader2 size={14} className="animate-spin" /> agent working…</> : <><Wand2 size={14} /> Let the agent explore</>}
          </Button>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Results grid */}
      <Panel title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> Generations</span>}>
        {generations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Empty>no images yet — describe a character or place below and hit Generate.</Empty>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {generations.map((g) => <GenerationCard key={g.id} gen={g} onOpen={setOpen} />)}
          </div>
        )}
      </Panel>

      {/* Composer */}
      <div className="sticky bottom-4 z-10 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
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
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate(); }}
          placeholder="Describe a character or a place — e.g. “Sara, 9, standing at the edge of the birch forest at dawn…”"
          rows={2}
          className="mb-2 resize-none text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* Prompt preset */}
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
            <SelectContent>{COUNTS.map((n) => <SelectItem key={n} value={String(n)}>{n} image{n > 1 ? "s" : ""}</SelectItem>)}</SelectContent>
          </Select>

          {/* Aspect */}
          <Select value={aspectRatio} onValueChange={setAspectRatio}>
            <SelectTrigger className="h-8 w-[84px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => setPickRef(true)}><ImagePlus size={13} /> Reference</Button>

          <Button className="ml-auto" onClick={generate} disabled={busy || !prompt.trim()}>
            {busy ? <><Loader2 size={14} className="animate-spin" /> generating…</> : <><Wand2 size={14} /> Generate</>}
          </Button>
        </div>
      </div>

      <GenerationDetail
        gen={open}
        onClose={() => setOpen(null)}
        onRecreate={recreate}
        onUseAsRef={useAsRef}
        onAddToCanvas={addToCanvas}
        onSaveToLibrary={saveToLibrary}
        onDelete={del}
      />
      <LibraryPicker open={pickRef} onOpenChange={setPickRef} onPick={(r) => { setRefs((cur) => [...cur, r]); setPickRef(false); }} />
      <PromptLibraryDialog open={editPrompts} onOpenChange={setEditPrompts} prompts={prompts} onSave={savePrompts} />
    </div>
  );
}

export function loader() {
  return swr("visual-world", async () => {
    const res = await fetch("/api/visual-world");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export function Component() { return <Visual />; }
