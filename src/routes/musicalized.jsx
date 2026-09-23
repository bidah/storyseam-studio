import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  ArrowDown, ArrowUp, AudioLines, Bot, Check, FilePlus2, Loader2, Merge, Music4, Plus, RotateCcw,
  Save, Sparkles, Tags, Trash2,
} from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnAgentIdle, useRevalidateOnMount } from "@/lib/swr";
import { agentIsBusy, musicalizeMessage, useAgent } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, Panel, ErrorNote, Eyebrow, fmtTime } from "@/components/shared";
import {
  ADHERENCE, chunkStarts, fitToFilm, mergeIntoPrevious, planFromPrompt, planTotalMs,
  USD_PER_MINUTE, renderCostUsd, splitAt, starterPlan, styleTags, validatePlan,
} from "@/lib/music-plan";
import { SAMPLE_RATE, contactSheet, fetchFilm, readCue, readFilmAudio, writeScoredFilm } from "@/director/film";
import { clock, duckWindows, findTurns, loudnessPerSecond } from "@/director/measure";
import { DEFAULT_MIX, levelExpression, mixDown, nullTestDb } from "@/director/mix";
import { energyProfile } from "@/director/energy";
import { makePreview } from "@/director/preview";

/* ------------------------------------------------------------------ *
 * Musicalized — one continuous cue, written under a kept sitting.     *
 *                                                                     *
 * THE RULE THE WHOLE THING TURNS ON: the plan is measured from the     *
 * FILM, never from the cue sheet. The Director's chunks run long, so   *
 * a plan built from beat offsets is early by two to seven seconds —    *
 * the score arriving before the cut it was written for, every time,    *
 * getting worse as the piece goes on. So this tab decodes the film     *
 * first and everything downstream is measured off that.                *
 *                                                                     *
 * Five steps, in the order a score is made: the film measured, the     *
 * composition plan (with the Series' standing music brief), the cue    *
 * checked by its bands, the mix under the film, and keeping it — which *
 * also writes down the brief and the mix it was made with, so the next *
 * take starts from them.                                               *
 *                                                                     *
 * And the mix happens HERE, in the browser, because the picture's      *
 * packets are COPIED rather than re-encoded: the film you scored is    *
 * bit-for-bit the film you kept.                                       *
 * ------------------------------------------------------------------ */

// The models a cue can be rendered on. ONE today, on purpose: the Worker's cue
// route is a narrow door to a single fal endpoint (see worker/src/routes/
// musicalized.js), so a second entry here means a second door there first.
// Shown as a picker anyway so the author can SEE what the score is made on.
const MUSIC_MODELS = [
  { id: "elevenlabs/music/v2.5", label: "ElevenLabs Music v2.5", via: "fal", note: "composition plan, up to 30 chunks" },
];

const POLL_MS = 5_000;
const CONTACT_EVERY_SEC = 5;

async function musApi(url, opts) {
  const res = await fetch(url, {
    headers: opts?.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = data.issues ? ` — ${Object.values(data.issues).flat().join("; ")}` : "";
    throw new Error((data.error || `${res.status}`) + issues);
  }
  return data;
}

/* ---- what this browser remembers between visits: the draft plan and mix -- */

const draftKey = (seriesId) => `shot-studio.musicalized.${seriesId}`;

function readDraft(seriesId) {
  try {
    const raw = localStorage.getItem(draftKey(seriesId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearDraft(seriesId) {
  try {
    localStorage.removeItem(draftKey(seriesId));
  } catch {
    /* nothing to forget */
  }
}

function writeDraft(seriesId, draft) {
  try {
    localStorage.setItem(draftKey(seriesId), JSON.stringify(draft));
  } catch {
    /* a browser with storage off starts from the Series each time */
  }
}

/** The music pieces on the Series that were made from a plan, newest first. */
function plannedCues(series) {
  return (series?.cues || [])
    .map((piece) => ({ piece, plan: planFromPrompt(piece.prompt) }))
    .filter((entry) => entry.plan !== null);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const list = (value) => value.split(",").map((s) => s.trim()).filter(Boolean);

function Step({ n, title, meta, children }) {
  return (
    <Panel>
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{n} · {title}</h2>
          {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
        </div>
        {children}
      </div>
    </Panel>
  );
}

function Busy({ children }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 size={12} className="animate-spin" /> {children}
    </span>
  );
}

function NumberField({ label, unit, value, onChange, step = 0.5, min, max, className = "w-20" }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`h-8 ${className}`}
      />
      {unit}
    </label>
  );
}

/* ---- the loudness strip: one bar a second, turns marked, chunks drawn ---- */

function LoudnessStrip({ loudness, turns, starts, playhead, onSeek, onSplit }) {
  const width = 1000;
  const height = 96;
  const seconds = loudness.length;
  const x = (t) => (t / seconds) * width;
  const floor = -60;
  const y = (db) => height - ((Math.max(floor, Math.min(0, db)) - floor) / -floor) * height;
  return (
    <svg
      className="h-28 w-full cursor-pointer select-none rounded-md border border-border bg-muted/30"
      viewBox={`0 0 ${width} ${height + 16}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="loudness per second"
    >
      {loudness.map((db, s) => (
        <rect
          key={s}
          x={x(s)}
          y={y(db)}
          width={Math.max(0.5, width / seconds - 0.4)}
          height={height - y(db)}
          className="fill-muted-foreground/50 hover:fill-foreground"
          onClick={() => onSeek(s)}
        >
          <title>{`${clock(s)} · ${db} dBFS`}</title>
        </rect>
      ))}
      {starts.slice(1).map((start) => (
        <line key={`c${start}`} x1={x(start)} x2={x(start)} y1={0} y2={height} className="stroke-primary" strokeWidth={2} />
      ))}
      {turns.map((turn) => (
        <g
          key={`t${turn.at}`}
          className={turn.kind === "jump" ? "stroke-emerald-500 fill-emerald-500" : "stroke-amber-500 fill-amber-500"}
          onClick={() => onSplit(turn.at)}
        >
          <title>{`${turn.kind === "jump" ? "jumps" : "drops"} ${Math.abs(turn.by)} dB at ${clock(turn.at)} — click to cut the plan here`}</title>
          <line x1={x(turn.at)} x2={x(turn.at)} y1={0} y2={height + 4} strokeDasharray="3 3" strokeWidth={1.5} />
          <text x={x(turn.at) + 3} y={height + 14} fontSize={11} stroke="none">{clock(turn.at)}</text>
        </g>
      ))}
      <line x1={x(playhead)} x2={x(playhead)} y1={0} y2={height} className="stroke-foreground" strokeWidth={1.5} />
    </svg>
  );
}

/* ---- the plan: one row per chunk, in seconds on the film's clock -------- */

function PlanEditor({ plan, filmMs, errors, onChange, onReset }) {
  const starts = chunkStarts(plan);
  const total = planTotalMs(plan);
  const set = (index, patch) =>
    onChange({ ...plan, chunks: plan.chunks.map((chunk, i) => (i === index ? { ...chunk, ...patch } : chunk)) });
  const off = filmMs !== null && Math.abs(total - filmMs) > 50;
  return (
    <div className="space-y-2">
      {plan.chunks.map((chunk, index) => {
        const rowErrors = errors.filter((e) => e.chunk === index);
        return (
          <div
            key={index}
            className={`space-y-2 rounded-md border p-3 ${rowErrors.length ? "border-amber-500/60" : "border-border"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 font-mono text-xs text-muted-foreground">{clock(starts[index] ?? 0)}</span>
              <Input
                className="h-8 min-w-40 flex-1"
                value={chunk.text}
                placeholder="[Section]"
                onChange={(e) => set(index, { text: e.target.value })}
              />
              <NumberField
                unit="s"
                step={0.1}
                min={3}
                max={120}
                value={(chunk.duration_ms / 1000).toFixed(1)}
                onChange={(v) => set(index, { duration_ms: Math.round(v * 1000) })}
              />
              <select
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                title="context adherence — how hard this chunk holds to what came before"
                aria-label="context adherence"
                value={chunk.context_adherence ?? "high"}
                onChange={(e) => set(index, { context_adherence: e.target.value })}
              >
                {ADHERENCE.map((level) => (
                  <option key={level} value={level}>adherence: {level}</option>
                ))}
              </select>
              <Button
                size="sm"
                variant="ghost"
                disabled={index === 0}
                onClick={() => onChange(mergeIntoPrevious(plan, index))}
              >
                <Merge size={14} /> Join up
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={chunk.positive_styles.join(", ")}
                placeholder="what arrives — gated reverb drums enter, heroic brass melody enters…"
                onChange={(e) => set(index, { positive_styles: list(e.target.value) })}
              />
              <Input
                value={(chunk.negative_styles ?? []).join(", ")}
                placeholder="what leaves, and what never — vocals, lyrics, drums…"
                onChange={(e) => set(index, { negative_styles: list(e.target.value) })}
              />
            </div>
            {rowErrors.map((e) => (
              <p key={e.message} className="text-xs text-amber-500">{e.message}</p>
            ))}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          seed
          <Input
            type="number"
            className="h-8 w-28"
            placeholder="none"
            value={plan.seed ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const next = { ...plan };
              if (raw === "") delete next.seed;
              else next.seed = Math.round(Number(raw));
              onChange(next);
            }}
          />
        </label>
        <Button size="sm" variant="ghost" disabled={filmMs === null} onClick={() => onChange(fitToFilm(plan, filmMs))}>
          Fit the last chunk to the film
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset}>
          <RotateCcw size={14} /> Start over
        </Button>
        <span className={`text-xs ${off ? "text-amber-500" : "text-muted-foreground"}`}>
          {(total / 1000).toFixed(1)} s of {filmMs !== null ? (filmMs / 1000).toFixed(1) : "—"} s
        </span>
      </div>
      {errors.filter((e) => e.chunk === undefined).map((e) => (
        <p key={e.message} className="text-xs text-amber-500">{e.message}</p>
      ))}
    </div>
  );
}

/* ---- the mix: the bed's level, where it changes, where the dialogue is -- */

function MixEditor({ mix, onChange, playhead }) {
  const setSpan = (index, patch) =>
    onChange({ ...mix, spans: mix.spans.map((span, i) => (i === index ? { ...span, ...patch } : span)) });
  const setDuck = (index, from, to) =>
    onChange({ ...mix, ducks: mix.ducks.map((duck, i) => (i === index ? [from, to] : duck)) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <NumberField label="bed level" unit="dB" value={mix.baseDb} onChange={(v) => onChange({ ...mix, baseDb: v })} />
        <NumberField label="fade in" unit="s" min={0} value={mix.fadeInSec} onChange={(v) => onChange({ ...mix, fadeInSec: v })} />
        <NumberField label="duck by" unit="dB" value={mix.duckDb} onChange={(v) => onChange({ ...mix, duckDb: v })} />
        <span className="text-xs text-muted-foreground">−21 dB in interiors, −16 dB in vacuum, where −21 vanishes.</span>
      </div>

      <div className="space-y-2">
        <Eyebrow>Where it sits elsewhere — exteriors, mostly</Eyebrow>
        {mix.spans.map((span, index) => (
          <div key={index} className="flex flex-wrap items-center gap-3">
            <NumberField label="from" unit="s" min={0} value={span.from} onChange={(v) => setSpan(index, { from: v })} />
            <NumberField label="to" unit="s" min={0} value={span.to} onChange={(v) => setSpan(index, { to: v })} />
            <NumberField label="at" unit="dB" value={span.db} onChange={(v) => setSpan(index, { db: v })} />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove span"
              onClick={() => onChange({ ...mix, spans: mix.spans.filter((_, i) => i !== index) })}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange({ ...mix, spans: [...mix.spans, { from: Math.round(playhead), to: Math.round(playhead) + 30, db: -16 }] })}
        >
          <Plus size={14} /> Span from the playhead ({clock(playhead)})
        </Button>
      </div>

      <div className="space-y-2">
        <Eyebrow>Dialogue to duck under — measured off this take, never the cue sheet’s</Eyebrow>
        {mix.ducks.map(([from, to], index) => (
          <div key={index} className="flex flex-wrap items-center gap-3">
            <NumberField label="from" unit="s" step={0.1} min={0} value={from} onChange={(v) => setDuck(index, v, to)} />
            <NumberField label="to" unit="s" step={0.1} min={0} value={to} onChange={(v) => setDuck(index, from, v)} />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove duck"
              onClick={() => onChange({ ...mix, ducks: mix.ducks.filter((_, i) => i !== index) })}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const at = Math.round(playhead * 10) / 10;
            onChange({ ...mix, ducks: [...mix.ducks, [at, at + 3]] });
          }}
        >
          <Plus size={14} /> Duck from the playhead ({clock(playhead)})
        </Button>
      </div>
    </div>
  );
}

/* ---- one sitting, scored ------------------------------------------------- */

function Workbench({ sitting, series, model, onChanged, fresh, onNew }) {
  const seriesId = sitting.seriesId;
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  // A NEW run starts from the brief and the film alone: no draft, no earlier
  // cue. Earlier cues stay on the Series, one click away under "Plans on the
  // Series" — New forgets the draft, it deletes nothing.
  const draft = useMemo(() => (fresh ? null : readDraft(seriesId)), [seriesId, fresh]);
  const kept = useMemo(() => plannedCues(series), [series]);

  // ------------------------------------------------------------ measuring
  const [blob, setBlob] = useState(null);
  const [audio, setAudio] = useState(null);
  const [frames, setFrames] = useState([]);
  const [measure, setMeasure] = useState({ step: "idle" });

  useEffect(() => {
    if (!sitting.url) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    setMeasure({ step: "busy" });
    (async () => {
      const bytes = await fetchFilm(sitting.url, controller.signal);
      if (cancelled) return;
      setBlob(bytes);
      const decoded = await readFilmAudio(bytes);
      if (cancelled) return;
      setAudio(decoded);
      setMeasure({ step: "done" });
      for await (const frame of contactSheet(bytes, CONTACT_EVERY_SEC, decoded.durationMs / 1000)) {
        if (cancelled) return;
        setFrames((have) => [...have, frame]);
      }
    })().catch((caught) => {
      if (!cancelled && caught.name !== "AbortError") setMeasure({ step: "failed", error: caught.message });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sitting.url]);

  const loudness = useMemo(() => (audio ? loudnessPerSecond(audio.samples, SAMPLE_RATE) : []), [audio]);
  const turns = useMemo(() => findTurns(loudness), [loudness]);
  const filmMs = audio?.durationMs ?? null;

  // ------------------------------------------------------------- the brief
  // The row's brief wins over this browser's draft: it is the standing prompt
  // the Series is made by, and a draft is only what was typed here before it
  // was saved.
  const savedBrief = series?.musicStyle || "";
  const [brief, setBrief] = useState(() => savedBrief || draft?.brief || "");
  const [briefSave, setBriefSave] = useState({ step: "idle" });
  const saveBrief = useCallback(async () => {
    setBriefSave({ step: "busy" });
    try {
      // `prompts` is replaced whole by a patch, so the other standing briefs
      // (the shot sheet's house clause) ride along untouched.
      await musApi(`/api/director/series/${encodeURIComponent(seriesId)}`, {
        method: "PUT",
        body: JSON.stringify({ prompts: { ...(series?.prompts || {}), musicStyle: brief.trim() || null } }),
      });
      setBriefSave({ step: "done", at: new Date().toLocaleTimeString() });
      onChanged();
    } catch (e) {
      setBriefSave({ step: "failed", error: e.message });
    }
  }, [seriesId, series?.prompts, brief, onChanged]);

  // -------------------------------------------------------------- the plan
  const [plan, setPlan] = useState(() => draft?.plan ?? (fresh ? null : kept[0]?.plan) ?? null);
  const [mix, setMix] = useState(() => draft?.mix ?? DEFAULT_MIX);

  // A plan needs the film's length to start from; it is made the moment the
  // length is known and there is nothing to start from. The ducks likewise
  // come off this take the first time it is measured.
  useEffect(() => {
    if (plan === null && filmMs !== null) setPlan(starterPlan(brief, filmMs));
  }, [plan, filmMs, brief]);
  useEffect(() => {
    if (!loudness.length || draft?.mix) return;
    setMix((m) => (m.ducks.length ? m : { ...m, ducks: duckWindows(loudness) }));
  }, [loudness, draft]);

  useEffect(() => {
    if (plan) writeDraft(seriesId, { plan, mix, brief });
  }, [seriesId, plan, mix, brief]);

  const planErrors = useMemo(() => (plan ? validatePlan(plan, filmMs ?? undefined) : []), [plan, filmMs]);
  const totalMs = plan ? planTotalMs(plan) : 0;
  const starts = plan ? chunkStarts(plan) : [];

  // --------------------------------------------------------------- the cue
  const [cueUrl, setCueUrl] = useState(() => (fresh ? null : sitting.cueUrl || kept[0]?.piece.audioUrl || null));

  // A cue that lands while this page is open — rendered by the agent from the
  // chat, or by this page — becomes the one on screen, with the plan it was
  // made from.
  const newestId = kept[0]?.piece.id ?? null;
  const seenNewest = useRef(newestId);
  useEffect(() => {
    if (!newestId || newestId === seenNewest.current) return;
    seenNewest.current = newestId;
    setPlan(kept[0].plan);
    if (kept[0].piece.audioUrl) setCueUrl(kept[0].piece.audioUrl);
  }, [newestId, kept]);
  const [cueAudio, setCueAudio] = useState(null);
  const [render, setRender] = useState({ step: "idle" });
  const pollRef = useRef(null);

  useEffect(() => {
    setCueAudio(null);
    if (!cueUrl) return undefined;
    const controller = new AbortController();
    readCue(cueUrl, controller.signal)
      .then(setCueAudio)
      .catch((e) => {
        if (e.name !== "AbortError") setRender({ step: "failed", error: `could not read the cue: ${e.message}` });
      });
    return () => controller.abort();
  }, [cueUrl]);

  // Checking a cue WITHOUT listening. Per ten seconds: how loud it is, and how
  // many kick-band and snare-band transients are in it. Plain onset counting
  // cannot tell a sequencer from a drum kit — which is how a "calm" opening
  // once passed both by ear and by count with a full kit in it.
  const energy = useMemo(() => (cueAudio ? energyProfile(cueAudio.samples, SAMPLE_RATE, 10) : []), [cueAudio]);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const submitRender = useCallback(async () => {
    if (!plan || filmMs === null || planErrors.length) return;
    setRender({ step: "busy", note: "submitting…" });
    try {
      const ticket = await musApi("/api/musicalized/cue", {
        method: "POST",
        body: JSON.stringify({ seriesId, plan, filmMs }),
      });
      // Polled here rather than held open on the Worker: a cue takes a minute
      // or more and a Worker request does not.
      const poll = async () => {
        try {
          const state = await musApi(
            `/api/musicalized/cue/${encodeURIComponent(ticket.requestId)}?seriesId=${encodeURIComponent(seriesId)}`,
          );
          if (state.status === "done") {
            setCueUrl(state.url);
            setRender({ step: "done", note: `kept as ${state.file}${state.bytes ? ` (${mb(state.bytes)})` : ""}` });
            onChanged();
            return;
          }
          if (state.status === "error") {
            setRender({ step: "failed", error: state.error });
            return;
          }
          setRender({
            step: "busy",
            note: state.queue === "IN_QUEUE"
              ? `in the queue${state.queuePosition != null ? ` at ${state.queuePosition}` : ""}…`
              : "rendering…",
          });
          pollRef.current = setTimeout(poll, POLL_MS);
        } catch (e) {
          setRender({ step: "failed", error: e.message });
        }
      };
      pollRef.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      setRender({ step: "failed", error: e.message });
    }
  }, [plan, filmMs, planErrors.length, seriesId, onChanged]);

  // --------------------------------------------------------------- the mix
  const videoRef = useRef(null);
  const previewRef = useRef(null);
  const [previewing, setPreviewing] = useState(false);
  const [playhead, setPlayhead] = useState(0);

  useEffect(() => {
    previewRef.current?.close();
    previewRef.current = cueAudio ? makePreview(cueAudio.samples, mix) : null;
    return () => {
      previewRef.current?.close();
      previewRef.current = null;
    };
  }, [cueAudio]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    previewRef.current?.retune(mix);
  }, [mix]);

  const onVideoPlay = useCallback(() => {
    const video = videoRef.current;
    if (video && previewing) previewRef.current?.follow(video);
  }, [previewing]);
  const onVideoHold = useCallback(() => previewRef.current?.hold(), []);
  useEffect(() => {
    // Switching the preview off mid-play silences the bed; on, it joins at the playhead.
    const video = videoRef.current;
    if (!video) return;
    if (previewing && !video.paused) previewRef.current?.follow(video);
    else previewRef.current?.hold();
  }, [previewing]);

  const seek = (t) => { if (videoRef.current) videoRef.current.currentTime = t; };

  const [scored, setScored] = useState(null);
  const [writing, setWriting] = useState({ step: "idle" });
  useEffect(() => () => { if (scored) URL.revokeObjectURL(scored.url); }, [scored]);

  const writeFilm = useCallback(async () => {
    if (!blob || !audio || !cueAudio) return;
    setWriting({ step: "busy", note: "mixing…" });
    try {
      const mixed = mixDown(audio.samples, cueAudio.samples, SAMPLE_RATE, mix);
      // The film's own audio must still be in there at full strength. A null
      // test against the original says so in one number instead of by ear.
      const nullDb = nullTestDb(mixed, audio.samples);
      const out = await writeScoredFilm(blob, mixed, SAMPLE_RATE, (f) =>
        setWriting({ step: "busy", note: `writing the file… ${Math.round(f * 100)}%` }),
      );
      setScored({ blob: out.blob, url: URL.createObjectURL(out.blob), nullDb, videoCopied: out.videoCopied });
      setWriting({ step: "done" });
    } catch (e) {
      setWriting({ step: "failed", error: e.message });
    }
  }, [blob, audio, cueAudio, mix]);

  // --------------------------------------------------------------- keeping
  const [keeping, setKeeping] = useState({ step: "idle" });
  const keep = useCallback(async () => {
    if (!scored) return;
    setKeeping({ step: "busy" });
    try {
      const form = new FormData();
      form.append("sittingId", sitting.id);
      form.append("seriesId", seriesId);
      form.append("film", scored.blob, "scored.mp4");
      if (plan) form.append("plan", JSON.stringify(plan));
      if (cueUrl) form.append("cueUrl", cueUrl);
      form.append("mix", JSON.stringify(mix));
      form.append("musicStyle", brief);
      const res = await musApi("/api/musicalized/scored", { method: "POST", body: form });
      setKeeping({ step: "done", url: res.scoredUrl });
      onChanged();
    } catch (e) {
      setKeeping({ step: "failed", error: e.message });
    }
  }, [scored, sitting.id, seriesId, plan, cueUrl, mix, brief, onChanged]);

  const briefChanged = (brief.trim() || null) !== (savedBrief || null);

  const [request, setRequest] = useState("");
  const askAgent = () => {
    agent
      .send({
        message: musicalizeMessage({
          sitting,
          seriesTitle: series?.title,
          filmMs,
          turns,
          brief,
          savedBrief,
          plan,
          request,
        }),
      })
      .then(() => setRequest(""))
      .catch(() => {});
  };

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 min-w-48 flex-1"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !agentBusy) askAgent(); }}
            placeholder="What should the score do? e.g. quiet until the reveal, then brass — optional"
          />
          <Button
            size="sm"
            disabled={agentBusy}
            title={agentBusy ? "The agent is busy — wait for it to finish" : "Send this film, its turns, the brief and the draft plan to the agent to score"}
            onClick={askAgent}
          >
            {agentBusy ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
            Ask the agent to musicalize
          </Button>
          <Button
            size="sm"
            variant="outline"
            title="Start a new run from the brief and the film — earlier cues stay on the Series"
            onClick={() => {
              clearDraft(seriesId);
              onNew();
            }}
          >
            <FilePlus2 size={14} /> New
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The agent writes the plan and renders the cue; the cue appears here when it lands, and the mix below stays yours.
        </p>
      </Panel>

      {/* 1 · THE FILM ------------------------------------------------------ */}
      <Step
        n={1}
        title="The film, measured"
        meta={filmMs !== null
          ? `${(filmMs / 1000).toFixed(1)} s — the length the plan must add up to`
          : measure.step === "busy" ? <Busy>decoding the film…</Busy> : null}
      >
        {measure.error ? <ErrorNote>{measure.error}</ErrorNote> : null}
        <video
          ref={videoRef}
          src={sitting.url}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-md border border-border"
          onPlay={onVideoPlay}
          onSeeked={onVideoPlay}
          onRateChange={onVideoPlay}
          onPause={onVideoHold}
          onEnded={onVideoHold}
          onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
        />
        {loudness.length ? (
          <LoudnessStrip
            loudness={loudness}
            turns={turns}
            starts={starts}
            playhead={playhead}
            onSeek={seek}
            onSplit={(t) => plan && setPlan(splitAt(plan, t))}
          />
        ) : null}
        {turns.length ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {turns.map((turn) => (
                <Badge
                  key={turn.at}
                  variant={turn.kind === "jump" ? "success" : "warning"}
                  className="cursor-pointer gap-1"
                  onClick={() => seek(turn.at)}
                >
                  {turn.kind === "jump" ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                  {clock(turn.at)} · {Math.abs(turn.by)} dB
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {turns.length} place{turns.length === 1 ? "" : "s"} where the sound turns. Click a dashed mark on
              the strip to cut the plan there; the frames say which turn it was.
            </p>
          </div>
        ) : null}
        {frames.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {frames.map((frame) => (
              <button
                key={frame.at}
                type="button"
                className="shrink-0 space-y-0.5 text-left"
                onClick={() => seek(frame.at)}
              >
                <img src={frame.dataUrl} alt={`frame at ${clock(frame.at)}`} className="h-16 rounded border border-border" />
                <span className="block font-mono text-[10px] text-muted-foreground">{clock(frame.at)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </Step>

      {/* 2 · THE PLAN ------------------------------------------------------ */}
      <Step
        n={2}
        title="The composition plan"
        meta={plan ? `${plan.chunks.length} chunks · ${(totalMs / 1000).toFixed(1)} s · about $${renderCostUsd(totalMs).toFixed(2)} a render` : null}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Music model</span>
          <Select value={model} onValueChange={() => {}}>
            <SelectTrigger size="sm" className="w-[260px]" aria-label="Music model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(MUSIC_MODELS.some((m) => m.id === model)
                ? MUSIC_MODELS
                : [...MUSIC_MODELS, { id: model, label: model, via: "fal", note: "" }]
              ).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} · {m.via}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {MUSIC_MODELS.find((m) => m.id === model)?.note || model} · ~${USD_PER_MINUTE}/min of cue · the default, and today the only one
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor="music-brief" className="text-sm font-medium">The Series’ music brief</label>
            <span className="text-xs text-muted-foreground">
              the standing prompt every cue is made by — the first chunk carries it as tags
            </span>
          </div>
          <Textarea
            id="music-brief"
            rows={4}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Psychedelic funk, in E minor at 106 BPM, in 4/4 time. Center the track on a syncopated electric-bass riff…"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={briefSave.step === "busy" || !briefChanged} onClick={saveBrief}>
              {briefSave.step === "busy" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save the brief on the Series
            </Button>
            {plan ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={!styleTags(brief).length}
                onClick={() => {
                  const tags = styleTags(brief);
                  const first = plan.chunks[0];
                  // The first chunk's tags are the genre of the whole piece:
                  // replace what came from the old brief, keep the mood tags
                  // typed after it.
                  const old = styleTags(savedBrief);
                  const own = first.positive_styles.filter((tag) => !old.includes(tag) && !tags.includes(tag));
                  setPlan({ ...plan, chunks: [{ ...first, positive_styles: [...tags, ...own] }, ...plan.chunks.slice(1)] });
                }}
              >
                <Tags size={14} /> Put the brief’s tags on the first chunk
              </Button>
            ) : null}
            {briefSave.at && !briefChanged ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check size={12} /> saved at {briefSave.at}</span>
            ) : null}
          </div>
          {briefSave.error ? <ErrorNote>{briefSave.error}</ErrorNote> : null}
        </div>

        {plan ? (
          <PlanEditor
            plan={plan}
            filmMs={filmMs}
            errors={planErrors}
            onChange={setPlan}
            onReset={() => filmMs !== null && setPlan(starterPlan(brief, filmMs))}
          />
        ) : (
          <p className="text-xs text-muted-foreground">The plan starts from the film’s length — it appears once the film is measured.</p>
        )}

        {kept.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Plans on the Series:</span>
            {kept.map(({ piece, plan: past }) => (
              <Button
                key={piece.id}
                size="sm"
                variant="outline"
                onClick={() => {
                  setPlan(past);
                  if (piece.audioUrl) setCueUrl(piece.audioUrl);
                }}
              >
                {piece.createdAt?.slice(0, 10) ?? "undated"} · {past.chunks.length} chunks
                {past.seed !== undefined ? ` · seed ${past.seed}` : ""}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!plan || filmMs === null || planErrors.length > 0 || render.step === "busy"}
            onClick={submitRender}
          >
            {render.step === "busy" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {render.step === "busy" ? "Rendering…" : `Render the cue (${plan ? `$${renderCostUsd(totalMs).toFixed(2)}` : "—"})`}
          </Button>
          <span className="text-xs text-muted-foreground">on {MUSIC_MODELS.find((m) => m.id === model)?.label || model}</span>
          {render.note ? <span className="text-xs text-muted-foreground">{render.note}</span> : null}
        </div>
        {render.error ? <ErrorNote>{render.error}</ErrorNote> : null}
      </Step>

      {/* 3 · THE CUE ------------------------------------------------------- */}
      <Step
        n={3}
        title="The cue, checked by its bands"
        meta={cueAudio ? `${(cueAudio.durationMs / 1000).toFixed(2)} s measured` : cueUrl ? <Busy>reading…</Busy> : "nothing rendered yet"}
      >
        {cueUrl ? <audio src={cueUrl} controls preload="metadata" className="w-full" /> : null}
        {energy.length ? (
          <>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3 font-normal">window</th>
                    <th className="py-1 pr-3 font-normal">rms dBFS</th>
                    <th className="py-1 pr-3 font-normal">kick</th>
                    <th className="py-1 pr-3 font-normal">snare</th>
                    <th className="py-1 font-normal">chunk</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {energy.map((row) => {
                    const chunkIndex = starts.filter((start) => start <= row.from).length - 1;
                    return (
                      <tr key={row.from}>
                        <td className="py-0.5 pr-3">{clock(row.from)}–{clock(row.to)}</td>
                        <td className="py-0.5 pr-3">{row.rmsDb.toFixed(1)}</td>
                        <td className="py-0.5 pr-3">{row.kick}</td>
                        <td className="py-0.5 pr-3">{row.snare}</td>
                        <td className="py-0.5 font-sans text-muted-foreground">{plan?.chunks[chunkIndex]?.text ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              A calm chunk is a low RMS and ~0 snare; drums arriving is both bands jumping; a drop is both falling.
              A turn a bar late is a plan change; a bad ending is a re-render, not a fade.
            </p>
          </>
        ) : null}
      </Step>

      {/* 4 · THE MIX ------------------------------------------------------- */}
      <Step n={4} title="Under the film" meta={<span className="font-mono">{levelExpression(mix)}</span>}>
        <MixEditor mix={mix} onChange={setMix} playhead={playhead} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={previewing} disabled={!cueAudio} onCheckedChange={(v) => setPreviewing(!!v)} />
          Hear the bed under the film while it plays
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!blob || !audio || !cueAudio || writing.step === "busy"} onClick={writeFilm}>
            {writing.step === "busy" ? <Loader2 size={14} className="animate-spin" /> : <AudioLines size={14} />}
            {writing.step === "busy" ? "Writing…" : "Write the musicalized version"}
          </Button>
          {writing.note && writing.step === "busy" ? <span className="text-xs text-muted-foreground">{writing.note}</span> : null}
        </div>
        {writing.error ? <ErrorNote>{writing.error}</ErrorNote> : null}
        {scored ? (
          <>
            <video src={scored.url} controls playsInline preload="metadata" className="w-full rounded-md border border-border" />
            <p className="text-xs text-muted-foreground">
              {mb(scored.blob.size)} · null test (mix − film) {scored.nullDb.toFixed(1)} dBFS — should sit near the bed’s
              own level, not near 0 · {scored.videoCopied ? "picture copied, not re-encoded" : "picture re-encoded (the film was not an mp4)"}
            </p>
          </>
        ) : null}
      </Step>

      {/* 5 · KEEP ---------------------------------------------------------- */}
      <Step n={5} title="Keep it, and write it down">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!scored || keeping.step === "busy"} onClick={keep}>
            {keeping.step === "busy" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {keeping.step === "busy" ? "Keeping…" : "Keep beside the original"}
          </Button>
          {keeping.url ? (
            <a className="text-xs text-muted-foreground underline" href={keeping.url} target="_blank" rel="noreferrer">
              kept — {keeping.url.split("/").pop()}
            </a>
          ) : null}
        </div>
        {keeping.error ? <ErrorNote>{keeping.error}</ErrorNote> : null}
        <p className="text-xs text-muted-foreground">
          Keeping files the scored film beside the sitting it came from, and writes down what it was made with: the
          brief becomes the Series’ music style, and the bed level, fade, spans and ducks go on the cue’s own piece —
          whose prompt is already the plan, verbatim, seed included. The next take starts from all of it, and the seed
          is what makes “the same but quieter” a small change instead of a new piece.
        </p>
        {sitting.scoredUrl ? (
          <div className="space-y-2">
            <Eyebrow>Scored version on file</Eyebrow>
            <video src={sitting.scoredUrl} controls className="w-full rounded-md border border-border" />
          </div>
        ) : null}
      </Step>
    </>
  );
}

/* ---- the tab ------------------------------------------------------------- */

function MusicalizedTab() {
  const initial = useLoaderData();
  const { revalidate } = useRevalidator();
  const agent = useAgent();
  useRevalidateOnMount("musicalized");
  // The agent's render_cue files the cue on the Series; the turn settling is
  // when to look for it.
  useRevalidateOnAgentIdle("musicalized", agent.status);
  const [run, setRun] = useState(0);

  const sittings = initial.sittings || [];
  const [sittingId, setSittingId] = useState(sittings[0]?.id || "");
  const sitting = sittings.find((s) => s.id === sittingId) || null;
  const series = sitting ? initial.series?.[sitting.seriesId] || null : null;

  const onChanged = useCallback(() => {
    invalidateTabCache("musicalized");
    revalidate();
  }, [revalidate]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Music4 size={18} />
        <h1 className="text-lg font-semibold">Musicalized</h1>
        <select
          className="h-8 max-w-full rounded-md border border-input bg-transparent px-2 text-sm"
          aria-label="Sitting to score"
          value={sittingId}
          onChange={(e) => { setSittingId(e.target.value); setRun(0); }}
        >
          <option value="">Pick a sitting…</option>
          {sittings.map((s) => (
            <option key={s.id} value={s.id}>
              {initial.series?.[s.seriesId]?.title || s.title} — {fmtTime(s.seconds || 0)}
              {s.recordedAt ? ` · ${String(s.recordedAt).slice(0, 10)}` : ""}
              {s.scoredUrl ? " (scored)" : ""}
            </option>
          ))}
        </select>
      </div>

      {!sittings.length ? (
        <Empty>Nothing to score yet — the Stage has to keep a sitting first.</Empty>
      ) : !sitting ? (
        <Empty>Pick a sitting.</Empty>
      ) : (
        <Workbench
          key={`${sitting.id}:${run}`}
          sitting={sitting}
          fresh={run > 0}
          onNew={() => setRun((n) => n + 1)}
          series={series}
          model={initial.model || "elevenlabs/music/v2.5"}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

export function loader() {
  return swr("musicalized", async () => {
    const res = await fetch("/api/musicalized");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load the Musicalized tab");
    return json;
  });
}

export function Component() {
  return <MusicalizedTab />;
}
