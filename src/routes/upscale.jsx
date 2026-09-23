import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  AlertTriangle, CheckCircle2, Clapperboard, Download, Film, Loader2, Sparkles,
} from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { useFalKey } from "@/lib/falKey";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, ErrorNote, Eyebrow, fmtTime } from "@/components/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Upscale — a finished film, taken to a higher resolution on fal.     *
 *                                                                     *
 * Everything this studio finishes is 720p by construction: the Stage *
 * streams at 720p and the Editor renders a 1280×720 timeline. This   *
 * lists both kinds of finished video and upscales one on the         *
 * author's own fal key. The original is never touched — the result   *
 * is a new file beside it.                                            *
 * ------------------------------------------------------------------ */

async function upscaleApi(url, opts) {
  const res = await fetch(url, {
    headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

const POLL_MS = 5000;
const FILTERS = [
  { id: "all", label: "All" },
  { id: "stage", label: "Stage" },
  { id: "editor", label: "Editor" },
];

function fmtBytes(n) {
  if (!n) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1e6))} MB`;
}

function JobRow({ job }) {
  const label = `${job.modelLabel} · ${job.resolution}`;
  if (job.status === "done") {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-2 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-emerald-500" /> {label}
            {job.width && job.height ? <span className="text-muted-foreground">· {job.width}×{job.height}</span> : null}
            {job.bytes ? <span className="text-muted-foreground">· {fmtBytes(job.bytes)}</span> : null}
          </span>
          <a
            href={job.url}
            download={job.file}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            aria-label="Download the upscaled video"
          >
            <Download size={13} /> Download
          </a>
        </div>
        <video src={job.url} controls preload="metadata" className="w-full rounded" />
      </div>
    );
  }
  if (job.status === "error") {
    return (
      <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 p-2 text-xs">
        <AlertTriangle size={13} className="mt-px shrink-0 text-destructive" />
        <span>
          {label} failed — <span className="text-muted-foreground">{job.error}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border p-2 text-xs text-muted-foreground">
      <Loader2 size={13} className="animate-spin" />
      {label} — {job.queue === "IN_QUEUE" ? "queued on fal" : "upscaling on fal"}
      {job.queuePosition != null ? ` (position ${job.queuePosition})` : ""}
    </div>
  );
}

function SourceRow({ source, jobs, model, resolution, busy, onUpscale, onMeasured }) {
  const offered = model?.resolutions?.includes(resolution);
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[220px_1fr]">
      <video
        src={source.url}
        controls
        preload="metadata"
        className="w-full rounded bg-black"
        onLoadedMetadata={(e) => onMeasured(source.id, e.currentTarget.videoHeight)}
      />
      <div className="min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {source.origin === "stage" ? <Film size={14} /> : <Clapperboard size={14} />}
              <span className="truncate text-sm font-medium">{source.label}</span>
              <Badge variant="muted">{source.detail}</Badge>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {[
                source.origin === "stage" ? "Stage" : "Editor",
                source.height ? `${source.height}p` : null,
                source.seconds ? fmtTime(source.seconds) : null,
                source.bytes ? fmtBytes(source.bytes) : null,
                source.at ? new Date(source.at).toLocaleString() : null,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
          <Button
            size="sm"
            disabled={!offered || busy}
            onClick={() => onUpscale(source)}
            title={!offered ? `${model?.label} does not offer ${resolution}` : undefined}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Upscale
          </Button>
        </div>
        {jobs.length ? (
          <div className="space-y-2">
            {jobs.map((j) => <JobRow key={j.id} job={j} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UpscaleTab() {
  const initial = useLoaderData();
  const { revalidate } = useRevalidator();
  useRevalidateOnMount("upscale");
  const falKey = useFalKey();

  const models = initial.models || [];
  const [modelId, setModelId] = useState(models[0]?.id || "seedvr");
  const [resolution, setResolution] = useState("1080p");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(null);
  // Live job state, seeded from the loader and advanced by polling.
  const [jobs, setJobs] = useState(initial.jobs || []);
  // Heights measured off each row's <video>, which Topaz needs for its factor.
  const [measured, setMeasured] = useState({});

  useEffect(() => { setJobs(initial.jobs || []); }, [initial.jobs]);

  const model = models.find((m) => m.id === modelId) || models[0];
  // A model that doesn't offer the current resolution falls back to its first one.
  useEffect(() => {
    if (model && !model.resolutions.includes(resolution)) setResolution(model.resolutions[0]);
  }, [model, resolution]);

  const running = jobs.filter((j) => j.status === "running").map((j) => j.id).join(",");
  useEffect(() => {
    if (!running) return undefined;
    let stop = false;
    let timer;
    // Chained rather than on an interval: the poll that finds a job finished
    // also copies a possibly-4K file into the bucket, and a second tick must
    // not start while that one is still running.
    const tick = async () => {
      const updates = await Promise.all(
        running.split(",").map((id) =>
          upscaleApi(`/api/upscale/jobs/${encodeURIComponent(id)}`).catch(() => null)),
      );
      if (stop) return;
      const byId = new Map(updates.filter((u) => u?.job).map((u) => [u.job.id, u.job]));
      setJobs((prev) => prev.map((j) => byId.get(j.id) || j));
      if ([...byId.values()].some((j) => j.status !== "running")) {
        invalidateTabCache("upscale");
        revalidate();
        return; // `running` changes, which restarts this effect for whatever is left
      }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [running, revalidate]);

  const onMeasured = useCallback((id, height) => {
    if (height) setMeasured((m) => (m[id] === height ? m : { ...m, [id]: height }));
  }, []);

  const upscale = async (source) => {
    setError("");
    setStarting(source.id);
    try {
      const { job } = await upscaleApi("/api/upscale", {
        method: "POST",
        body: JSON.stringify({
          source: source.id,
          model: model.id,
          resolution,
          ...(measured[source.id] ? { sourceHeight: measured[source.id] } : {}),
        }),
      });
      setJobs((prev) => [job, ...prev]);
      invalidateTabCache("upscale");
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(null);
    }
  };

  const sources = useMemo(
    () => (initial.sources || [])
      .filter((s) => filter === "all" || s.origin === filter)
      .map((s) => ({ ...s, height: measured[s.id] || null })),
    [initial.sources, filter, measured],
  );
  const jobsFor = (id) => jobs.filter((j) => j.source?.id === id);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={18} />
        <h1 className="text-lg font-semibold">Upscale</h1>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-3">
        <label className="space-y-1">
          <Eyebrow>Model</Eyebrow>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={model?.id || ""}
            onChange={(e) => setModelId(e.target.value)}
          >
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <Eyebrow>Resolution</Eyebrow>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            {(model?.resolutions || []).map((r) => (
              <option key={r} value={r}>{r === "2160p" ? "2160p (4K)" : r}</option>
            ))}
          </select>
        </label>
        <p className="min-w-[12rem] flex-1 text-xs text-muted-foreground">{model?.blurb}</p>
      </div>

      {!falKey ? (
        <p className="text-xs text-muted-foreground">
          An upscale is billed to your own fal key — add it in Settings.
        </p>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              filter === f.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {sources.length ? (
        <div className="space-y-3">
          {sources.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              jobs={jobsFor(s.id)}
              model={model}
              resolution={resolution}
              busy={starting === s.id}
              onUpscale={upscale}
              onMeasured={onMeasured}
            />
          ))}
        </div>
      ) : (
        <Empty>
          Nothing to upscale yet. Keep a sitting on the Stage, or Deliver a render from the Editor —
          both show up here.
        </Empty>
      )}
    </div>
  );
}

export function loader() {
  return swr("upscale", async () => {
    const data = await fetch("/api/upscale").then((r) => r.json());
    if (data.error) throw new Error(data.error);
    return data;
  });
}

export function Component() {
  return <UpscaleTab />;
}
