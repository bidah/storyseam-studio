// Visual world — the World tab's image-generation surface. Now a thin adapter
// over the shared <ImageStudio>: this file owns only the visual-world BACKEND
// (the /api/visual-world/* calls, the processing poll, and the canvas board),
// and hands ImageStudio the data + action handlers. The composer/results/detail
// UI lives in src/components/ImageStudio.jsx and is shared with Animatic/Episode.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { Wand2, Loader2 } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy, createVisualWorldMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import ImageStudio from "@/components/ImageStudio";
import { useT } from "@/lib/i18n";

function Visual() {
  const t = useT();
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

  const generate = async ({ prompt, model, count, aspectRatio, presetId, sheetType, refs }) => {
    setBusy(true); setError(null);
    try {
      await api("/api/visual-world/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt, model, count: Number(count), aspectRatio, presetId, sheetType,
          // Library/generation refs resolve to an ungated /files url server-side
          // from rel/genId; PC uploads already carry an absolute /files url, so
          // forward it directly (the server imports whatever `url` it's given).
          refs: refs.map((r) => ({
            kind: r.kind, rel: r.rel, genId: r.genId,
            ...(r.kind === "upload" ? { url: r.url } : {}),
          })),
        }),
      });
      refetch();
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(false); }
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
      refetch(); // pull the persisted savedRel into loader data
      return j.rel;
    } catch (e) { setError(String(e.message || e)); return null; }
  };
  const del = async (g) => {
    try { await api(`/api/visual-world/generation/${g.id}`, { method: "DELETE" }); refetch(); }
    catch (e) { setError(String(e.message || e)); }
  };
  // One save = one revision server-side, so style + sheet prompts go together.
  const savePrompts = async ({ prompts, sheetPrompts }) => {
    try { await api("/api/visual-world/prompts", { method: "PUT", body: JSON.stringify({ prompts, sheetPrompts }) }); refetch(); }
    catch (e) { setError(String(e.message || e)); }
  };

  const pending = generations.filter((g) => g.status === "processing").length;

  return (
    <ImageStudio
      title={t("Visual world")}
      subtitle={t("Explore how the world looks — generate concept images to find your characters and places.")}
      headerExtra={({ prompt }) => (
        <Button
          variant="outline"
          onClick={() => agent.send({ message: createVisualWorldMessage(prompt?.trim() || undefined) }).catch(() => {})}
          disabled={agentBusy}
          title={agentBusy ? t("Agent is busy — wait for the current turn") : t("Let the agent explore the look for you")}
        >
          {agentBusy ? <><Loader2 size={14} className="animate-spin" /> {t("agent working…")}</> : <><Wand2 size={14} /> {t("Let the agent explore")}</>}
        </Button>
      )}
      generations={generations}
      models={models}
      prompts={prompts}
      sheetPrompts={world.sheetPrompts || {}}
      promptRevisions={world.promptRevisions || []}
      settings={world.settings || {}}
      sheetTagging
      busy={busy}
      pending={pending}
      error={error}
      emptyLabel="no images yet — describe a character or place below and hit Generate."
      composerPlaceholder="Describe a character or a place — e.g. “Sara, 9, standing at the edge of the birch forest at dawn…”"
      onGenerate={generate}
      onDelete={del}
      onSaveToLibrary={saveToLibrary}
      onAddToCanvas={addToCanvas}
      onSavePrompts={savePrompts}
    />
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
