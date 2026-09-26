import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  AlertTriangle, Check, Grid2x2, Loader2, Pin, Scissors, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Empty, Panel, ErrorNote, Eyebrow, fmtTime } from "@/components/shared";
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, grabTimes, planReels } from "@/lib/shot-sheet";
import { MAX_END_IMAGES, MIN_END_IMAGE_GAP_SECONDS, MIN_OPENING_END_IMAGE_SECONDS } from "@/lib/series";
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
  if (!res.ok) {
    // A refused sheet names its reasons in `errors` — they are the useful part.
    const reasons = (data.errors || []).map((e) => e.message || String(e)).filter(Boolean);
    throw new Error([data.error || `${res.status}`, ...reasons].join(" — "));
  }
  return data;
}

/* ---- the reference images ------------------------------------------------ */

// What the model is handed as `reference_image_urls`, numbered the way the
// prompt addresses them: the first url is "Image 1". The tags in the prompt
// only mean something next to the pictures they name.
function References({ references }) {
  if (!references?.length) {
    return (
      <p className="text-xs text-muted-foreground">
        No reference images — this goes to text-to-video, so nothing holds a character or a place
        to its model sheet. Add sheets on the Director tab.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
      {references.map((ref, i) => (
        <figure key={`${ref.url}-${i}`} className="space-y-1">
          <div className="relative">
            <img src={ref.url} alt="" className="aspect-square w-full rounded border border-border object-cover" />
            <span className="absolute left-1 top-1 rounded bg-background/80 px-1 font-mono text-[10px]">
              Image {i + 1}
            </span>
          </div>
          <figcaption className="truncate text-[11px] text-muted-foreground" title={ref.label}>
            {ref.name || ref.label}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/* ---- the slots ----------------------------------------------------------- */

function Slots({ slots, chosen, skipped, onToggle }) {
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
              {on && skipped?.has(slot.offset) ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-500">
                  <Scissors size={11} /> not drawn — {skipped.get(slot.offset)}
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

function CutTake({ take, seriesId, slots, seams = [], onPinned }) {
  const [cutting, setCutting] = useState(false);
  const [frames, setFrames] = useState([]);
  const [picked, setPicked] = useState([]);
  const [replaceOthers, setReplaceOthers] = useState(false);
  const [error, setError] = useState("");

  // The grab times come out of the SAME array the prompt's shot list does, so
  // the clip and the cut cannot disagree about which frame is which.
  const times = take.sheet ? grabTimes(take.sheet) : [];
  const shots = take.sheet?.shots || [];

  const cut = async () => {
    setCutting(true);
    setError("");
    setFrames([]);
    try {
      const film = await (await fetch(take.url)).blob();
      const out = [];
      for await (const grabbed of grabFrames(film, times)) out.push(grabbed);
      setFrames(out);
      setPicked(out.map((_, i) => i));
    } catch (e) {
      setError(e.message);
    } finally {
      setCutting(false);
    }
  };

  // What pressing Pin would leave on the cue sheet, checked HERE against the
  // same ceilings the Director's route enforces — pins are written one at a
  // time, and a refusal half way through leaves half a sheet pinned.
  //
  // Every ceiling is PER REEL, as the Series counts it: `seams` are its reel
  // changes, a seam's own beat carries no pin on the wire, and "replace the
  // other pins" only replaces pins in the reels this clip draws — never another
  // clip's reel.
  const planFor = useCallback((indices, clearOthers) => {
    const cuts = [...seams].sort((a, b) => a - b);
    const reelOf = (offset) => cuts.filter((c) => c <= offset).length;
    const opensAt = (reel) => (reel === 0 ? 0 : cuts[reel - 1]);
    const chosen = indices.map((i) => ({ index: i, ...shots[i] })).filter((s) => s.offset !== undefined);
    const opening = chosen.find((s) => s.kind === "opening") || null;
    const pins = chosen.filter((s) => s.kind !== "opening");
    const pinOffsets = new Set(pins.map((s) => s.offset));
    const ownReels = new Set(shots.map((s) => reelOf(s.offset)));
    const existing = slots
      .filter((s) => s.kind === "pin" && s.filled && !cuts.includes(s.offset))
      .map((s) => s.offset);
    const toClear = clearOthers ? existing.filter((o) => !pinOffsets.has(o) && ownReels.has(reelOf(o))) : [];
    const final = [...new Set([...existing.filter((o) => !toClear.includes(o)), ...pinOffsets])].sort((a, b) => a - b);
    const issues = [];
    for (const s of pins) {
      const slot = slots.find((x) => x.offset === s.offset);
      if (!slot) issues.push(`${fmtTime(s.offset)} is no longer a beat on this cue sheet — untick it.`);
      else if (slot.refused) issues.push(`${fmtTime(s.offset)}: ${slot.refused}.`);
      else if (cuts.includes(s.offset)) issues.push(`${fmtTime(s.offset)} opens a reel, and a reel's opening beat has no pin — untick it.`);
    }
    const many = cuts.length > 0;
    for (let reel = 0; reel <= cuts.length; reel++) {
      const inReel = final.filter((o) => reelOf(o) === reel);
      const where = many ? `Reel ${reel + 1}: ` : "";
      if (inReel.length > MAX_END_IMAGES) {
        const existingHere = existing.filter((o) => reelOf(o) === reel).length;
        issues.push(
          `${where}that leaves ${inReel.length} pins and the limit is ${MAX_END_IMAGES} per reel. ` +
          (clearOthers
            ? `Untick ${inReel.length - MAX_END_IMAGES}.`
            : `${existingHere} are already pinned — tick "replace the other pins", or untick ${inReel.length - MAX_END_IMAGES}.`),
        );
      }
      if (reel > 0 && inReel.length && inReel[0] - opensAt(reel) < MIN_OPENING_END_IMAGE_SECONDS) {
        issues.push(`${where}a pin at ${fmtTime(inReel[0])} is under ${MIN_OPENING_END_IMAGE_SECONDS}s after the reel change at ${fmtTime(opensAt(reel))}.`);
      }
      for (let i = 1; i < inReel.length; i++) {
        if (inReel[i] - inReel[i - 1] < MIN_END_IMAGE_GAP_SECONDS) {
          issues.push(`${where}pins at ${fmtTime(inReel[i - 1])} and ${fmtTime(inReel[i])} are closer than ${MIN_END_IMAGE_GAP_SECONDS}s.`);
        }
      }
    }
    return { opening, pins, toClear, final, issues, replaced: pins.filter((s) => existing.includes(s.offset)).length };
  }, [shots, slots, seams]);
  const plan = useMemo(() => planFor(picked, replaceOthers), [planFor, picked, replaceOthers]);

  // One frame, confirmed in a dialog first. Checked against the pins already on
  // the cue sheet, never clearing any of them.
  const [confirming, setConfirming] = useState(null);
  const single = confirming === null ? null : planFor([confirming], false);

  const pinPlan = async (plan) => {
    setCutting(true);
    setError("");
    try {
      const chosen = [plan.opening, ...plan.pins].filter(Boolean);
      // Uploaded as one multipart POST, each frame naming the second it pins.
      const form = new FormData();
      form.append("seriesId", seriesId);
      form.append("takeId", take.id);
      for (const s of chosen) {
        form.append("frame", frames[s.index].blob, `pin-${s.offset}.png`);
        form.append("offset", String(s.offset));
      }
      const stored = await sheetApi("/api/shotsheet/pins", { method: "POST", body: form });
      const urlAt = new Map(stored.frames.map((f) => [f.offset, f.imageUrl]));
      const series = `/api/director/series/${encodeURIComponent(seriesId)}`;

      // The opening frame is not a pin: it is the picture the film STARTS on,
      // the Series' own first frame.
      if (plan.opening) {
        await sheetApi(series, { method: "PUT", body: JSON.stringify({ imageUrl: urlAt.get(plan.opening.offset) }) });
      }
      // Clear before pinning, so the count never passes the ceiling on the way.
      for (const offset of plan.toClear) {
        await sheetApi(`${series}/pin`, { method: "POST", body: JSON.stringify({ offset, clear: true }) });
      }
      // Pinning runs the whole cue sheet's validation — spacing, count, the
      // opening chunk — so it goes through the Director's own route one frame
      // at a time rather than being written behind its back.
      for (const s of [...plan.pins].sort((a, b) => a.offset - b.offset)) {
        await sheetApi(`${series}/pin`, {
          method: "POST",
          body: JSON.stringify({
            offset: s.offset,
            imageUrl: urlAt.get(s.offset),
            prompt: take.sheet?.premise ?? null,
            model: take.endpoint,
          }),
        });
      }
      onPinned();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setCutting(false);
    }
  };

  const toggle = (i) => setPicked((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  return (
    <div className="space-y-3">
      <video src={take.url} controls className="w-full rounded-md border border-border" />
      <div className="space-y-1.5">
        <Eyebrow>Drawn against</Eyebrow>
        <References references={take.sheet?.references} />
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={cut} disabled={cutting || !times.length}>
          {cutting ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
          Cut {times.length} frames
        </Button>
        {frames.length ? (
          <>
            <Button size="sm" onClick={() => pinPlan(plan)} disabled={cutting || !picked.length || plan.issues.length > 0}>
              <Pin size={14} /> Pin {picked.length} to their beats
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={replaceOthers} onChange={(e) => setReplaceOthers(e.target.checked)} />
              replace the other pins
            </label>
          </>
        ) : null}
      </div>

      {frames.length ? (
        <>
          <p className="text-xs text-muted-foreground">
            {plan.opening ? "Replaces the Series' first frame. " : ""}
            {plan.pins.length} pin{plan.pins.length === 1 ? "" : "s"}
            {plan.replaced ? `, ${plan.replaced} replacing a pin already there` : ""}
            {plan.toClear.length ? `; clears ${plan.toClear.length} other pin${plan.toClear.length === 1 ? "" : "s"}` : ""}
            {` — ${plan.final.length} pins on the cue sheet after (${MAX_END_IMAGES} per reel).`}
          </p>
          {plan.issues.map((issue) => (
            <p key={issue} className="flex items-center gap-1.5 text-xs text-amber-500">
              <AlertTriangle size={11} /> {issue}
            </p>
          ))}
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {frames.map((frame, i) => {
              const shot = shots[i] || {};
              const on = picked.includes(i);
              const filled = slots.find((x) => x.offset === shot.offset)?.filled;
              return (
                <div key={`${shot.offset}-${i}`} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-pressed={on}
                  aria-label={`${on ? "Skip" : "Use"} the frame for ${fmtTime(shot.offset ?? 0)}`}
                  className={cn("w-full space-y-1 text-left", !on && "opacity-40")}
                >
                  <div className="relative">
                    <img src={frame.href} alt="" className="w-full rounded border border-border" />
                    {on ? (
                      <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                        <Check size={10} />
                      </span>
                    ) : null}
                  </div>
                  <div className="text-center font-mono text-[10px] text-muted-foreground">
                    {shot.kind === "opening" ? "first frame" : fmtTime(shot.offset ?? 0)}
                    {filled && shot.kind !== "opening" ? " · replaces" : ""}
                  </div>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full text-xs"
                  disabled={cutting || shot.offset === undefined}
                  onClick={() => setConfirming(i)}
                >
                  <Pin size={12} /> Pin
                </Button>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!open && !cutting) setConfirming(null); }}>
        {single ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {single.opening ? "Set as the Series' first frame?" : `Pin this frame at ${fmtTime(shots[confirming]?.offset ?? 0)}?`}
              </DialogTitle>
              <DialogDescription>
                {single.opening
                  ? "The film will start on this picture, replacing the current first frame."
                  : single.replaced
                    ? "This replaces the pin already on that beat."
                    : `The Director will land on this picture at ${fmtTime(shots[confirming]?.offset ?? 0)}.`}
                {single.opening ? "" : ` ${single.final.length} pins on the cue sheet after (${MAX_END_IMAGES} per reel).`}
              </DialogDescription>
            </DialogHeader>
            <img src={frames[confirming]?.href} alt="" className="w-full rounded-md border border-border" />
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            {single.issues.map((issue) => (
              <p key={issue} className="flex items-center gap-1.5 text-xs text-amber-500">
                <AlertTriangle size={11} /> {issue}
              </p>
            ))}
            <DialogFooter>
              <Button variant="outline" disabled={cutting} onClick={() => setConfirming(null)}>Cancel</Button>
              <Button
                disabled={cutting || single.issues.length > 0}
                onClick={async () => { if (await pinPlan(single)) setConfirming(null); }}
              >
                {cutting ? <Loader2 size={14} className="animate-spin" /> : <Pin size={14} />}
                {single.opening ? "Set first frame" : "Pin"}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

/* ---- the reel plan ------------------------------------------------------- */

// How a run will cut the chosen frames: the reels (one clip each), the seams a
// later reel opens on, and the frames those seams cost — which are NOT drawn,
// because the Series would refuse them at pin time. Takes the planner's own
// result or the Worker's `plan` view (offsets in place of shots).
function PlanSummary({ plan }) {
  const reels = plan.reels.map((reel) => {
    const offsets = reel.offsets || (reel.shots || []).map((s) => s.offset);
    return { ...reel, offsets };
  });
  return (
    <div className="space-y-1.5 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Reels · {reels.length}</Eyebrow>
        <span className="text-muted-foreground">
          one clip per reel
          {plan.seams.length
            ? ` · reel changes at ${plan.seams.map((s) => fmtTime(s)).join(", ")}`
            : " · no reel change"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {reels.map((reel) => (
          <Badge key={reel.reel} variant="muted">
            Reel {reel.reel} · {reel.offsets.length} frame{reel.offsets.length === 1 ? "" : "s"}
            {reel.offsets.length ? ` · ${fmtTime(reel.offsets[0])}–${fmtTime(reel.offsets.at(-1))}` : ""}
          </Badge>
        ))}
      </div>
      {plan.skipped.length ? (
        <p className="flex items-start gap-1.5 text-amber-500">
          <Scissors size={12} className="mt-0.5 shrink-0" />
          {plan.skipped.length} chosen frame{plan.skipped.length === 1 ? "" : "s"} not drawn — a reel
          change costs its opening beat and any pin under {MIN_OPENING_END_IMAGE_SECONDS}s after it:{" "}
          {plan.skipped.map((f) => fmtTime(f.offset)).join(", ")}
        </p>
      ) : null}
      {plan.refused ? (
        <p className="flex items-start gap-1.5 text-amber-500">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {plan.refused}
        </p>
      ) : null}
    </div>
  );
}

/* ---- every run this Series has rendered ---------------------------------- */

// A RUN is one press of Render. A cue sheet longer than one reel is planned into
// reels and drawn one clip per reel (see `planReels`), all sharing a `runId`; a
// take filed before runs existed is a run of one.
function groupRuns(takes) {
  const runs = new Map();
  for (const t of takes) {
    const id = t.runId || t.id;
    if (!runs.has(id)) runs.set(id, { id, takes: [], startedAt: t.startedAt });
    runs.get(id).takes.push(t);
  }
  return [...runs.values()].map((run) => {
    const clips = [...run.takes].sort((a, b) => (a.part || 1) - (b.part || 1));
    const status = clips.some((t) => t.status === "running")
      ? "running"
      : clips.every((t) => t.status === "done") ? "done" : clips.some((t) => t.status === "done") ? "partial" : "error";
    const frames = clips.reduce((n, t) => n + (t.sheet?.shots?.length || 0), 0);
    return { ...run, clips, status, frames };
  });
}

const statusVariant = (status) =>
  status === "done" ? "success" : status === "running" ? "info" : "warning";

// The seconds of the cue sheet a clip covers, from its first frame to its last.
function clipRange(take) {
  const shots = take.sheet?.shots || [];
  if (!shots.length) return "";
  return `${fmtTime(shots[0].offset)}–${fmtTime(shots[shots.length - 1].offset)}`;
}

// Newest first. Picking a row loads the run below for cutting; a run still
// drawing can be picked too, and shows its progress in the same place.
function RunList({ runs, selectedId, onSelect }) {
  return (
    <Panel>
      <div className="space-y-2">
        <Eyebrow>Runs · {runs.length}</Eyebrow>
        <div className="divide-y divide-border rounded-md border border-border">
          {runs.map((r, i) => {
            const poster = r.clips.find((t) => t.status === "done" && t.url);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50",
                  r.id === selectedId && "bg-muted",
                )}
              >
                {poster ? (
                  <video src={poster.url} muted preload="metadata" className="h-10 w-16 shrink-0 rounded border border-border object-cover" />
                ) : (
                  <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded border border-border text-muted-foreground">
                    {r.status === "running" ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Run {runs.length - i}</span>
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.startedAt ? new Date(r.startedAt).toLocaleString() : ""}
                    {` · ${r.clips.length} clip${r.clips.length === 1 ? "" : "s"}`}
                    {r.frames ? ` · ${r.frames} frames` : ""}
                  </div>
                </div>
                {r.id === selectedId ? <Check size={14} className="shrink-0 text-emerald-500" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// The run's finished clips played back to back, as the one film they are.
function RunPlayer({ clips }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const ref = useRef(null);
  const current = clips[Math.min(index, clips.length - 1)];
  useEffect(() => {
    if (playing) ref.current?.play().catch(() => {});
  }, [index, playing]);
  if (!current) return null;
  return (
    <div className="space-y-2">
      <video
        ref={ref}
        key={current.id}
        src={current.url}
        controls
        className="w-full rounded-md border border-border"
        onPlay={() => setPlaying(true)}
        onPause={(e) => { if (!e.currentTarget.ended) setPlaying(false); }}
        onEnded={() => {
          if (index + 1 < clips.length) setIndex(index + 1);
          else setPlaying(false);
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {clips.map((clip, i) => (
          <Button
            key={clip.id}
            size="sm"
            variant={i === index ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => { setIndex(i); setPlaying(true); }}
          >
            Clip {clip.part || i + 1} · {clipRange(clip)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function RunPanel({ run, seriesId, slots, seams, onPinned }) {
  const done = run.clips.filter((t) => t.status === "done" && t.url);
  const many = run.clips.length > 1;
  return (
    <Panel>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Eyebrow>{many ? `Run · ${run.clips.length} clips` : "Take"}</Eyebrow>
          <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
        </div>
        {many && done.length ? <RunPlayer clips={done} /> : null}
        {run.clips.map((take) => (
          <div key={take.id} className={cn("space-y-3", many && "rounded-md border border-border p-3")}>
            {many ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {/* Runs planned by reel file `opensAt`; older runs were split by count. */}
                  {take.opensAt === undefined ? "Clip" : "Reel"} {take.part} of {take.parts}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{clipRange(take)}</span>
                <Badge variant={statusVariant(take.status)}>{take.status}</Badge>
              </div>
            ) : null}
            {take.error ? <ErrorNote>{take.error}</ErrorNote> : null}
            {take.status === "done" && take.url ? (
              <CutTake key={take.id} take={take} seriesId={seriesId} slots={slots} seams={seams} onPinned={onPinned} />
            ) : take.status === "running" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> drawing — this takes a few minutes
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
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
  // Every render is its own take and its own file — a new Render adds a row,
  // it never takes over the one you were cutting from.
  const [takes, setTakes] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (id) => {
    if (!id) { setSheet(null); return; }
    setError("");
    try {
      const next = await sheetApi(`/api/shotsheet/${encodeURIComponent(id)}`);
      setSheet(next);
      setChosen(next.slots.filter((s) => !s.refused).map((s) => s.offset));
      const list = next.takes || [];
      setTakes(list);
      // Keep the run being cut from selected across a reload (pinning reloads).
      const runIdOf = (t) => t?.runId || t?.id || null;
      setSelectedRunId((prev) =>
        list.some((t) => runIdOf(t) === prev) ? prev : runIdOf(list.find((t) => t.status === "done") || list[0]));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(seriesId); }, [seriesId, load]);

  // A render finishes in a `waitUntil` on the Worker, so the tab polls the
  // ledger rather than running a second poller of its own — two pollers racing
  // to write one row is how a take lands twice.
  const runningIds = takes.filter((t) => t.status === "running").map((t) => t.id).join(",");
  useEffect(() => {
    if (!runningIds) return;
    const ids = runningIds.split(",");
    const timer = setInterval(async () => {
      const settled = [];
      await Promise.all(ids.map(async (id) => {
        try {
          const next = await sheetApi(`/api/shotsheet/take/${encodeURIComponent(id)}`);
          if (next.status !== "running") settled.push(next);
        } catch { /* a transient failure is not a finished render */ }
      }));
      if (!settled.length) return;
      setTakes((prev) => prev.map((t) => settled.find((n) => n.id === t.id) || t));
      invalidateTabCache("shotsheet");
      revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [runningIds, revalidate]);

  const runs = useMemo(() => groupRuns(takes), [takes]);
  const selectedRun = runs.find((r) => r.id === selectedRunId) || null;

  // The reels the chosen frames will be planned into, worked out with the same
  // function the Worker runs — so the page can say "3 clips", where the seams
  // fall and which frames they cost before anything is spent.
  const plan = useMemo(() => {
    if (!sheet) return null;
    const wanted = new Set(chosen);
    const shots = sheet.slots
      .filter((slot) => wanted.has(slot.offset) && !slot.refused)
      .map((slot) => ({ offset: slot.offset, kind: slot.kind, text: slot.brief }));
    const secs = Number(duration);
    const beats = sheet.slots.map((slot) => slot.offset);
    return planReels(shots, {
      duration: Number.isInteger(secs) && secs >= MIN_DURATION_SECONDS ? secs : MAX_DURATION_SECONDS,
      beats,
    });
  }, [sheet, chosen, duration]);
  const clipCount = plan?.clips.length || 0;
  const skippedAt = useMemo(() => new Map((plan?.skipped || []).map((f) => [f.offset, f.reason])), [plan]);

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

      {error && !sheet ? <ErrorNote>{error}</ErrorNote> : null}

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
                skipped={skippedAt}
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
              disabled={busy || !chosen.length || preview?.errors?.length || Boolean(plan?.refused)}
              onClick={() => run(async () => {
                const started = await sheetApi(`${url}/render`, {
                  method: "POST", body: JSON.stringify(body),
                });
                const fresh = started.takes || [started.take];
                const ids = new Set(fresh.map((t) => t.id));
                setTakes((prev) => [...fresh, ...prev.filter((t) => !ids.has(t.id))]);
                setSelectedRunId(started.runId || started.take.id);
                // The run wrote its seams onto the Series; cutting counts pins per reel.
                if (started.plan) setSheet((prev) => (prev ? { ...prev, reelChanges: started.plan.seams } : prev));
                // Some clips queued, a later one refused: the queued ones are
                // real renders, so they are kept — and the refusal is shown.
                if (started.error) setError(started.error);
              })}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {`Render ${clipCount} clip${clipCount === 1 ? "" : "s"} — costs money`}
            </Button>
          </div>
          {plan ? <PlanSummary plan={plan} /> : null}
          {/* Next to the buttons, not at the top of the page: Render sits below
              a long list of frames, and an error up there is one nobody sees. */}
          {error ? <ErrorNote>{error}</ErrorNote> : null}

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
                {preview.plan ? <PlanSummary plan={{ ...preview.plan, refused: null }} /> : null}
                {(preview.parts || [preview]).map((part, i, all) => (
                  <div key={i} className={cn("space-y-2", all.length > 1 && "rounded-md border border-border p-3")}>
                    {all.length > 1 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          Reel {part.reel || i + 1} of {all.length}
                          {part.opensAt ? ` · opens at ${fmtTime(part.opensAt)}` : ""}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{part.sheet ? clipRange(part) : ""}</span>
                      </div>
                    ) : null}
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        Reference images, in the order the prompt names them — each name in a shot is tagged with its image.
                      </p>
                      <References references={part.sheet?.references} />
                    </div>
                    <Textarea readOnly rows={12} value={part.request?.prompt || ""} className="font-mono text-xs" />
                    <p className="text-xs text-muted-foreground">
                      {part.endpoint} · frames cut at{" "}
                      {(part.sheet ? grabTimes(part.sheet) : []).map((t) => t.toFixed(2)).join("s, ")}s
                    </p>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {runs.length > 1 ? (
            <RunList runs={runs} selectedId={selectedRunId} onSelect={setSelectedRunId} />
          ) : null}

          {selectedRun ? (
            <RunPanel
              key={selectedRun.id}
              run={selectedRun}
              seriesId={seriesId}
              slots={sheet.slots}
              seams={sheet.reelChanges || []}
              onPinned={() => { invalidateTabCache("shotsheet"); revalidate(); load(seriesId); }}
            />
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
