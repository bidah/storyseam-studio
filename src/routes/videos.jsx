// Video generation — the motion half of the studio, and the peer of
// src/routes/images.jsx. Same shared <ImageStudio>, same backend document.
//
// ── Why Images and Videos are two surfaces over one store ────────────────────
// There is ONE `visual-world` document, ONE generation array and ONE set of
// style presets. Nothing here forks a backend: a generation record already
// carries `kind: "image" | "video"`, and each surface filters the shared store to
// its own kind. What genuinely differs is the COMPOSER — an image catalog and a
// video catalog are different model lists from the same providers, and the
// controls a clip takes (duration, generated audio, a start frame) are not the
// ones a still takes. A single mixed composer would spend half its rows on
// options that are wrong for whatever you are currently making.
//
// So: `kind === "video"` only, `?type=video` for the catalog, `medium="video"`
// on the studio, and `kind: "video"` in the generate body. Design-sheet tagging
// (character/location/prop) is an IMAGE concept and is deliberately absent.
//
// Style presets are shared with /images, but the block that gets prepended is
// not: the worker uses `kind === "video" ? preset.video : preset.image`
// (fireNodeJob in worker/src/routes/visual-world.js), so the prompt editor here
// leads with the video / motion block and says that is the one in use.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount, useRevalidateOnAgentIdle } from "@/lib/swr";
import { useAgent } from "@/components/AgentProvider";
import ImageStudio from "@/components/ImageStudio";
import { useT } from "@/lib/i18n";

function Videos() {
  const t = useT();
  const agent = useAgent();
  const world = useLoaderData();
  const revalidator = useRevalidator();
  useRevalidateOnMount("visual-world");
  useRevalidateOnAgentIdle("visual-world", agent.status);

  const revalidate = revalidator.revalidate;
  const refetch = useCallback(() => { invalidateTabCache("visual-world"); revalidate(); }, [revalidate]);

  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // The VIDEO half of the provider's catalog — never merged with the image one.
  // Best-effort: an empty list still generates (the server resolves Seedance).
  const [models, setModels] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/visual-world/models?type=video")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.models) setModels(j.models); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const generations = (world.generations || []).filter((g) => g.kind === "video");
  const prompts = world.prompts || [];

  // Poll while a clip is still rendering. /poll advances every pending job on the
  // project — it is the shared store's ticker, not this surface's.
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
    // Video jobs are minutes, not seconds — a slower cadence than the image
    // board's still lands the result well inside one render.
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [generations, refetch]);

  const api = useCallback(async (path, init) => {
    setError(null);
    const res = await fetch(path, { headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Request failed");
    return j;
  }, []);

  // `params` is the composer's per-model bag — MiniMax H3's { duration, resolution },
  // Kling's { duration, mode, sound }, Veo 3's { variant }. It is forwarded as-is
  // and the worker validates it against that model's declared spec, so a control
  // this surface has never heard of still reaches the provider correctly.
  // `duration`/`generateAudio` still ride alongside for the models that declare
  // them: the Nodes canvas and the episode path speak that older shape.
  const generate = async ({ prompt, model, aspectRatio, presetId, duration, generateAudio, params, count, refs }) => {
    setBusy(true); setError(null);
    try {
      await api("/api/visual-world/generate", {
        method: "POST",
        body: JSON.stringify({
          kind: "video",
          prompt, model, aspectRatio, presetId,
          // How many takes, when the model supports a batch; the worker clamps
          // it to that model's own range and returns 1 for models with none.
          count: Number(count) || 1,
          duration, generateAudio, params,
          // The FIRST reference is the clip's start frame server-side; the rest
          // ride as plain references. Same ref shapes as the image surface —
          // library/generation refs resolve to an ungated /files url from
          // rel/genId, uploads already carry one.
          refs: refs.map((r) => ({
            kind: r.kind, rel: r.rel, genId: r.genId,
            ...(r.kind === "upload" ? { url: r.url } : {}),
          })),
        }),
      });
      refetch();
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(false); }
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
  // Remember the composer's model/aspect/params so a reload doesn't drop the
  // author back on the catalog default. ImageStudio debounces this, and only
  // fires it on a real change — never on its initial seed. Best-effort: losing a
  // preference is not worth an error banner over the clip they are composing.
  // (`/generate` also stamps the last successful choice, so this mainly covers
  // the case where they set things up and haven't generated yet.)
  const saveComposer = useCallback(async (videoComposer) => {
    try {
      await api("/api/visual-world/settings", { method: "PUT", body: JSON.stringify({ videoComposer }) });
    } catch { /* a remembered preference is not worth interrupting the author */ }
  }, [api]);

  // One save = one revision server-side. The sheet prompts ride through
  // untouched — this surface doesn't show them, but it shares the document.
  const savePrompts = async ({ prompts, sheetPrompts }) => {
    try { await api("/api/visual-world/prompts", { method: "PUT", body: JSON.stringify({ prompts, sheetPrompts }) }); refetch(); }
    catch (e) { setError(String(e.message || e)); }
  };

  const pending = generations.filter((g) => g.status === "processing").length;

  return (
    <ImageStudio
      medium="video"
      title={t("Video generation")}
      subtitle={t("Generate motion — a clip from a prompt, or from a still you already made. Add a reference and it becomes the first frame.")}
      generations={generations}
      models={models}
      prompts={prompts}
      sheetPrompts={world.sheetPrompts || {}}
      promptRevisions={world.promptRevisions || []}
      settings={world.settings || {}}
      // The composer's remembered choice — model, aspect and that model's own
      // params. Stored under `videoComposer`, deliberately NOT under
      // `videoModel`/`videoResolution`: those two are the SEEDANCE RENDER
      // DEFAULTS the skills and the episode packer read, and writing a catalog
      // id into them would point the render pipeline at a model it isn't
      // written for.
      composerDefaults={world.settings?.videoComposer || null}
      onComposerChange={saveComposer}
      busy={busy}
      pending={pending}
      error={error}
      emptyLabel="no clips yet — describe a shot, or start from a still you already generated."
      composerPlaceholder="Describe the shot — e.g. “slow push in on Sara as the birches shift behind her, dawn light…”"
      onGenerate={generate}
      onDelete={del}
      onSaveToLibrary={saveToLibrary}
      onSavePrompts={savePrompts}
    />
  );
}

// Same `visual-world` key as /images and /nodes on purpose: one document, one
// cache entry, so a clip made here is already in the payload those surfaces read.
export function loader() {
  return swr("visual-world", async () => {
    const res = await fetch("/api/visual-world");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load");
    return json;
  });
}

export function Component() { return <Videos />; }
