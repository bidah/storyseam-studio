import { useCallback, useEffect, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  AlertTriangle, Grid2x2, Loader2, Pin, Scissors, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Empty, Panel, ErrorNote, Eyebrow, fmtTime } from "@/components/shared";
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, grabTimes } from "@/lib/shot-sheet";
import { grabFrames } from "@/director/frames";

/* ------------------------------------------------------------------ *
 * Shot sheet — a whole cue sheet's pins drawn as ONE short film.      *
 *                                                                     *
 * A pinned frame is the exact picture the Director continues from, so *
 * the cheapest way for a pin to hold a style is for the VIDEO model   *
 * to have drawn it. Frames made in an image model are frames the      *
 * Director has to translate, and seventeen separate generations are   *
 * also seventeen lightings and seventeen readings of the same set.    *
 *                                                                     *
 * The render is the Worker's (it needs a key and a long queue poll);  *
 * the CUTTING is here, because this tab already has the clip decoded  *
 * on screen and a frame grab costs nothing.                           *
 *                                                                     *
 * THE RULE: a beat's closing frame is the pin on the NEXT beat's      *
 * offset. The slots below have already done that arithmetic — read    *
 * them rather than working the offsets out again.                     *
 * ------------------------------------------------------------------ */

async function sheetApi(url, opts) {
  const res = await fetch(url, {
    headers: opts?.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

/* ---- the slots ----------------------------------------------------------- */

function Slots({ slots, chosen, onToggle }) {
  if (!slots.length) {
    return <Empty>No frames to draw — this Series’ cue sheet pins nothing yet.</Empty>;
  }
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {slots.map((slot) => {
        const on = chosen.includes(slot.offset);
        return (
          <label
            key={slot.offset}
            className={cn(
              "flex cursor-pointer items-start gap-3 p-3",
              slot.refused && "opacity-60",
            )}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={on}
              disabled={slot.refused}
              onChange={() => onToggle(slot.offset)}
            />
            <div className="w-14 shrink-0">
              <div className="font-mono text-sm">{fmtTime(slot.offset)}</div>
              <Badge variant={slot.kind === "opening" ? "info" : "muted"}>{slot.kind}</Badge>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{slot.brief}</p>
              {slot.refused ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-500">
                  <AlertTriangle size={11} /> {slot.refused}
                </p>
              ) : null}
              {slot.filled ? (
                <p className="mt-1 text-xs text-muted-foreground">already drawn</p>
              ) : null}
            </div>
          </label>
        );
      })}
    </div>
  );
}

/* ---- cutting the take back into frames ----------------------------------- */

function CutTake({ take, seriesId, onPinned }) {
  const [cutting, setCutting] = useState(false);
  const [frames, setFrames] = useState([]);
  const [error, setError] = useState("");

  // The grab times come out of the SAME array the prompt's shot list does, so
  // the clip and the cut cannot disagree about which frame is which.
  const times = take.sheet ? grabTimes(take.sheet) : [];
  const offsets = (take.sheet?.shots || []).map((shot) => shot.offset);

  const cut = async () => {
    setCutting(true);
    setError("");
    setFrames([]);
    try {
      const film = await (await fetch(take.url)).blob();
      const out = [];
      for await (const grabbed of grabFrames(film, times)) out.push(grabbed);
      setFrames(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setCutting(false);
    }
  };

  const pinAll = async () => {
    setCutting(true);
    setError("");
    try {
      // Uploaded as one multipart POST, each frame naming the second it pins.
      const form = new FormData();
      form.append("seriesId", seriesId);
      form.append("takeId", take.id);
      frames.forEach((frame, i) => {
        form.append("frame", frame.blob, `pin-${offsets[i]}.png`);
        form.append("offset", String(offsets[i]));
      });
      const stored = await sheetApi("/api/shotsheet/pins", { method: "POST", body: form });

      // Pinning runs the whole cue sheet's validation — spacing, count, the
      // opening chunk — so it happens one frame at a time through the Director's
      // own route rather than being written behind its back.
      for (const frame of stored.frames) {
        await sheetApi(`/api/director/series/${encodeURIComponent(seriesId)}/pin`, {
          method: "POST",
          body: JSON.stringify({
            offset: frame.offset,
            imageUrl: frame.imageUrl,
            prompt: take.sheet?.premise ?? null,
            model: take.endpoint,
          }),
        });
      }
      onPinned();
    } catch (e) {
      setError(e.message);
    } finally {
      setCutting(false);
    }
  };

  return (
    <div className="space-y-3">
      <video src={take.url} controls className="w-full rounded-md border border-border" />
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={cut} disabled={cutting || !times.length}>
          {cutting ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
          Cut {times.length} frames
        </Button>
        {frames.length ? (
          <Button size="sm" onClick={pinAll} disabled={cutting}>
            <Pin size={14} /> Pin them to their beats
          </Button>
        ) : null}
      </div>

      {frames.length ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {frames.map((frame, i) => (
            <figure key={offsets[i]} className="space-y-1">
              <img src={frame.href} alt="" className="w-full rounded border border-border" />
              <figcaption className="text-center font-mono text-[10px] text-muted-foreground">
                {fmtTime(offsets[i])}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---- the tab ------------------------------------------------------------- */

function ShotSheetTab() {
  const initial = useLoaderData();
  const { revalidate } = useRevalidator();
  useRevalidateOnMount("shotsheet");

  const [seriesId, setSeriesId] = useState(initial.selectedId);
  const [sheet, setSheet] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [duration, setDuration] = useState(MAX_DURATION_SECONDS);
  const [preview, setPreview] = useState(null);
  const [take, setTake] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (id) => {
    if (!id) { setSheet(null); return; }
    setError("");
    try {
      const next = await sheetApi(`/api/shotsheet/${encodeURIComponent(id)}`);
      setSheet(next);
      setChosen(next.slots.filter((s) => !s.refused).map((s) => s.offset));
      setTake(next.takes?.find((t) => t.status === "done") || null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(seriesId); }, [seriesId, load]);

  // A render finishes in a `waitUntil` on the Worker, so the tab polls the
  // ledger rather than running a second poller of its own — two pollers racing
  // to write one row is how a take lands twice.
  useEffect(() => {
    if (!take || take.status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const next = await sheetApi(`/api/shotsheet/take/${encodeURIComponent(take.id)}`);
        if (next.status !== "running") {
          setTake(next);
          invalidateTabCache("shotsheet");
          revalidate();
        }
      } catch { /* a transient failure is not a finished render */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [take, revalidate]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try { return await fn(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const url = `/api/shotsheet/${encodeURIComponent(seriesId || "")}`;
  const body = { slots: chosen, duration: Number(duration) };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Grid2x2 size={18} />
        <h1 className="text-lg font-semibold">Shot sheet</h1>
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={seriesId || ""}
          onChange={(e) => setSeriesId(e.target.value)}
        >
          <option value="">Pick a Series…</option>
          {(initial.series || []).map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {sheet ? (
        <>
          <Panel>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Eyebrow>Frames to draw</Eyebrow>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Clip length
                  <input
                    type="number"
                    min={MIN_DURATION_SECONDS}
                    max={MAX_DURATION_SECONDS}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="h-8 w-16 rounded-md border border-input bg-transparent px-2 text-sm"
                  />
                  s
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                One finished frame per pin, each held under a second and hard cut to the next.
                One pass, so one lighting and one design across every frame.
              </p>
              <Slots
                slots={sheet.slots}
                chosen={chosen}
                onToggle={(offset) =>
                  setChosen((prev) =>
                    prev.includes(offset) ? prev.filter((o) => o !== offset) : [...prev, offset],
                  )
                }
              />
            </div>
          </Panel>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !chosen.length}
              onClick={() => run(async () => setPreview(await sheetApi(`${url}/preview`, {
                method: "POST", body: JSON.stringify(body),
              })))}
            >
              Preview the prompt — free
            </Button>
            <Button
              size="sm"
              disabled={busy || !chosen.length || preview?.errors?.length}
              onClick={() => run(async () => {
                const started = await sheetApi(`${url}/render`, {
                  method: "POST", body: JSON.stringify(body),
                });
                setTake(started.take);
              })}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Render — costs money
            </Button>
          </div>

          {preview ? (
            <Panel>
              <div className="space-y-2">
                <Eyebrow>What the model will be asked for</Eyebrow>
                {preview.errors?.length ? (
                  <div className="space-y-1">
                    {preview.errors.map((e, i) => (
                      <p key={i} className="flex items-center gap-1.5 text-sm text-amber-500">
                        <AlertTriangle size={12} /> {e.message}
                      </p>
                    ))}
                  </div>
                ) : null}
                <Textarea readOnly rows={12} value={preview.request?.prompt || ""} className="font-mono text-xs" />
                <p className="text-xs text-muted-foreground">
                  {preview.endpoint} · frames cut at{" "}
                  {(preview.sheet ? grabTimes(preview.sheet) : []).map((t) => t.toFixed(2)).join("s, ")}s
                </p>
              </div>
            </Panel>
          ) : null}

          {take ? (
            <Panel>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Eyebrow>Take</Eyebrow>
                  <Badge variant={take.status === "done" ? "success" : take.status === "error" ? "warning" : "info"}>
                    {take.status}
                  </Badge>
                </div>
                {take.error ? <ErrorNote>{take.error}</ErrorNote> : null}
                {take.status === "done" && take.url ? (
                  <CutTake
                    take={take}
                    seriesId={seriesId}
                    onPinned={() => { invalidateTabCache("shotsheet"); revalidate(); load(seriesId); }}
                  />
                ) : take.status === "running" ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" /> drawing — this takes a few minutes
                  </p>
                ) : null}
              </div>
            </Panel>
          ) : null}
        </>
      ) : (
        <Empty>Pick a Series whose pins need drawing.</Empty>
      )}
    </div>
  );
}

export function loader() {
  return swr("shotsheet", async () => {
    const res = await fetch("/api/director");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load the Shot sheet tab");
    return json;
  });
}

export function Component() {
  return <ShotSheetTab />;
}
