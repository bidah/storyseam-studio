// Image generation — the picture half of the studio, and a thin adapter over the
// shared <ImageStudio>. This file owns only the BACKEND (the /api/visual-world/*
// calls, the processing poll, the canvas board); the composer/results/detail UI
// lives in src/components/ImageStudio.jsx.
//
// ── Why Images and Videos are two surfaces over one store ────────────────────
// /images and /videos read and write the SAME `visual-world` document, the same
// generation array and the same style presets — they are not two backends, and
// nothing here forks one. What differs is the COMPOSER: an image model list and
// a video model list are different catalogs from the same providers, and a
// selector that interleaves them is a selector where half the rows are a mistake
// (the user's words: "input is setup to work for showcasing providers rather for
// image or video not both"). So each surface filters the shared store to its own
// `kind` and hands ImageStudio one medium's catalog. A record of the other kind
// still renders sanely if it turns up — the tiles key off `gen.kind`, not the
// surface.
//
// This surface therefore shows `kind !== "video"` (an older record with no kind
// at all IS an image) and offers the image catalog, the count fan-out and the
// character/location/prop sheet tagging, which are image concepts.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { Wand2, Loader2 } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent, agentIsBusy, createVisualWorldMessage } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import ImageStudio from "@/components/ImageStudio";
import { useT } from "@/lib/i18n";

function Images() {
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

  // The real IMAGE model catalog for the selector (the route's default type).
  // Best-effort — if not signed in, the empty value still works (the server
  // resolves Nano Banana Pro).
  const [models, setModels] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/visual-world/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.models) setModels(j.models); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A record written before `kind` existed is an image, so the test is
  // "not video" rather than "is image".
  const generations = (world.generations || []).filter((g) => g.kind !== "video");
  const prompts = world.prompts || [];

  // Poll while any card is still processing. The poll endpoint advances every
  // pending job on the project, video ones included — it is the shared store's
  // ticker, not this surface's.
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
          kind: "image",
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
      medium="image"
      title={t("Image generation")}
      subtitle={t("Generate stills — concept art, character and location sheets, props. Everything you make lands on this board.")}
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

// The `visual-world` key is deliberately shared with /videos and /nodes: one
// document, one cache entry, so a generation made on either surface shows up on
// the other after the usual invalidate + revalidate.
export function loader() {
  return swr("visual-world", async () => {
    const res = await fetch("/api/visual-world");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export function Component() { return <Images />; }
