import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { Ban, CheckCircle2, CircleAlert, CircleHelp, Clapperboard, Clock, ExternalLink, Loader2, MapPin, OctagonX, Play, RotateCw, Sparkles, Users } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote, Eyebrow } from "@/components/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Auto — the author writes a prompt and gets a Film back.             *
 *                                                                     *
 * NOT a chat (CONTEXT.md › Auto): a job on the Worker (the FilmJobs   *
 * Durable Object) runs every step in order, and this surface draws    *
 * one card per step — a card appears when its step starts and is      *
 * marked complete with what it produced. The job's state lives on the *
 * server: the loader reads it, and every step transition arrives on   *
 * the project's `data` live-sync channel, which RootLayout turns into *
 * a revalidate. Nothing here polls, and a reload shows the same cards.*
 * ------------------------------------------------------------------ */

const KEY = "auto";

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 404) throw new Error(data.error || `${url} → ${res.status}`);
  return data;
}

export function loader() {
  return swr(KEY, async () => {
    const [current, status, allowance, settings] = await Promise.all([
      getJSON("/api/auto/films/current"),
      getJSON("/api/auto/status").catch(() => null),
      getJSON("/api/auto/allowance").catch(() => null),
      getJSON("/api/auto/settings").catch(() => null),
    ]);
    return {
      job: current.job || null,
      queue: current.queue || [],
      status,
      allowance,
      auto: settings?.auto !== false,
    };
  });
}

function StepIcon({ status }) {
  if (status === "done") return <CheckCircle2 size={16} className="text-emerald-500" aria-hidden />;
  if (status === "failed") return <CircleAlert size={16} className="text-destructive" aria-hidden />;
  if (status === "retrying") return <RotateCw size={16} className="animate-spin text-amber-500" aria-hidden />;
  return <Loader2 size={16} className="animate-spin text-muted-foreground" aria-hidden />;
}

const STATUS_BADGE = {
  running: { variant: "info", label: "Running" },
  retrying: { variant: "warning", label: "Retrying" },
  done: { variant: "success", label: "Complete" },
  failed: { variant: "destructive", label: "Failed" },
};

// What the Idea + World step produced: the Idea, then the World's cast and places.
function WorldResult({ result }) {
  if (!result) return null;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Eyebrow>Idea</Eyebrow>
        <p className="text-sm leading-relaxed">{result.idea}</p>
      </div>
      {(result.title || result.logline) && (
        <div className="space-y-1">
          <Eyebrow>World</Eyebrow>
          {result.title && <p className="text-sm font-semibold">{result.title}</p>}
          {result.logline && <p className="text-sm text-muted-foreground">{result.logline}</p>}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Eyebrow className="flex items-center gap-1.5"><Users size={12} /> Characters</Eyebrow>
          <ul className="space-y-1.5">
            {(result.characters || []).map((c) => (
              <li key={c.name} className="text-sm">
                <span className="font-medium">{c.name}</span>
                {c.role && <span className="text-muted-foreground"> · {c.role}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <Eyebrow className="flex items-center gap-1.5"><MapPin size={12} /> Places</Eyebrow>
          <ul className="space-y-1.5">
            {(result.places || []).map((p) => (
              <li key={p.name} className="text-sm">
                <span className="font-medium">{p.name}</span>
                {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// What the Reference sheets step filed on the Film's Series: one thumbnail each,
// style first — the same pictures the Director tab lists as model sheets.
function SheetsResult({ result }) {
  const sheets = result?.sheets || [];
  if (!sheets.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {sheets.map((s) => (
        <li key={s.name} className="space-y-1">
          <img
            src={s.imageUrl}
            alt={s.name}
            loading="lazy"
            className="aspect-video w-full rounded-md border bg-muted object-cover"
          />
          <p className="truncate text-xs">
            <span className="font-medium">{s.name}</span>
            <span className="text-muted-foreground"> · {s.kind}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

// The Shot sheet run: the plan (reels, the seams they open on, the frames those
// seams cost), then one card per clip — each completing with its take's video.
// Drawn while the step is still pending, so clips fill in as fal finishes them.
function RunResult({ result }) {
  const plan = result?.plan;
  const clips = result?.clips || [];
  if (!plan) return null;
  const at = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3 text-xs" data-run-plan>
        <Eyebrow>Plan</Eyebrow>
        <p className="mt-1">
          {plan.reels.length} reel{plan.reels.length === 1 ? "" : "s"}
          {plan.seams.length ? ` · seams at ${plan.seams.map(at).join(", ")}` : " · no seams"}
          {` · ${plan.skipped.length} frame${plan.skipped.length === 1 ? "" : "s"} skipped`}
        </p>
        {plan.skipped.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {plan.skipped.map((f) => (
              <li key={f.offset}>{at(f.offset)} — {f.reason}</li>
            ))}
          </ul>
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {clips.map((c) => (
          <li key={c.part} className="space-y-1 rounded-md border p-2" data-clip={c.part} data-status={c.status}>
            <p className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">Clip {c.part} · reel {c.reel}</span>
              <span className="text-muted-foreground">
                {c.frames} frames from {at(c.opensAt)}
              </span>
            </p>
            {c.status === "done" && c.videoUrl ? (
              <video src={c.videoUrl} controls muted playsInline className="aspect-video w-full rounded bg-muted" />
            ) : (
              <p className="flex aspect-video items-center justify-center gap-2 rounded bg-muted text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Rendering…
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The Stills: the frames cut out of the clips and pinned on the Series — the
// opening frame (the Series' first frame) and then every pin, in offset order.
function StillsResult({ result }) {
  const frames = result?.frames || [];
  if (!frames.length) return null;
  const at = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-stills>
      {frames.map((f) => (
        <li key={f.offset} className="space-y-1">
          <img
            src={f.imageUrl}
            alt={f.kind === "opening" ? "First frame" : `Pin at ${at(f.offset)}`}
            loading="lazy"
            className="aspect-video w-full rounded-md border bg-muted object-cover"
          />
          <p className="truncate text-xs">
            <span className="font-medium">{f.kind === "opening" ? "First frame" : at(f.offset)}</span>
            <span className="text-muted-foreground"> · clip {f.part}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

// One card per step. Stages without a result view render their summary alone.
// The Score has none: the scored film it files plays once, on the Film card.
const RESULT_VIEWS = { world: WorldResult, sheets: SheetsResult, run: RunResult, stills: StillsResult };

function StepCard({ step }) {
  const badge = STATUS_BADGE[step.status] || STATUS_BADGE.running;
  const View = RESULT_VIEWS[step.key];
  return (
    <Card className="gap-0 py-0" data-step={step.key} data-status={step.status}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <StepIcon status={step.status} /> {step.label}
        </CardTitle>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {step.status === "running" && !step.pending && (
          <p className="text-sm text-muted-foreground">Working on it…</p>
        )}
        {step.status === "retrying" && (
          <p className="text-sm text-muted-foreground">
            The first try failed{step.error ? ` (${step.error})` : ""} — trying once more.
          </p>
        )}
        {step.status === "failed" && <ErrorNote>{step.error || "This step failed."}</ErrorNote>}
        {(step.status === "done" || step.pending) && step.summary && (
          <p className="text-xs text-muted-foreground">{step.summary}</p>
        )}
        {(step.status === "done" || step.pending) && View && <View result={step.result} />}
      </CardContent>
    </Card>
  );
}

const dollars = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// A Film that failed twice on one step: say plainly what was kept and what was
// spent. Nothing made before the stop is deleted, and it doesn't count against
// the allowance (CONTEXT.md › Film allowance).
function StoppedCard({ job }) {
  const stopped = job.stopped || {};
  const kept = stopped.kept || [];
  const spend = Object.entries(job.spend || {}).filter(([, n]) => Number(n) > 0);
  const labelOf = (key) => job.steps.find((s) => s.key === key)?.label || key;
  return (
    <Card className="gap-0 border-destructive/40 py-0" data-step="stopped">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <OctagonX size={16} className="text-destructive" aria-hidden /> Stopped
        </CardTitle>
        <Badge variant="destructive">Stopped</Badge>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <p className="text-sm">
          {stopped.label || "A step"} failed twice, so the Film stopped there
          {stopped.reason ? `: ${stopped.reason}` : "."} This Film doesn't count against your allowance.
        </p>
        <div className="space-y-1.5">
          <Eyebrow>Kept</Eyebrow>
          {kept.length ? (
            <ul className="space-y-1">
              {kept.map((k) => (
                <li key={k.key} className="text-sm">
                  <span className="font-medium">{k.label}</span>
                  {k.summary && <span className="text-muted-foreground"> · {k.summary}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing was finished before the stop.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Eyebrow>Spent</Eyebrow>
          {spend.length ? (
            <ul className="space-y-1">
              {spend.map(([key, n]) => (
                <li key={key} className="flex justify-between text-sm">
                  <span>{labelOf(key)}</span>
                  <span className="tabular-nums">{dollars(n)}</span>
                </li>
              ))}
              <li className="flex justify-between border-t pt-1 text-sm font-medium">
                <span>Total</span>
                <span className="tabular-nums">{dollars(stopped.spent)}</span>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing was spent.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// "2:04" — the Film's measured length.
const clockOf = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// The Film: what the prompt came back as, at the end of the cards. The scored
// film plays large, titled with the Idea's title; it is also a project file
// (the Editor's media pool lists it as "Film — <title>"). What it cost sits
// small beneath it — the per-stage breakdown stays on the stored job.
function FilmCard({ job }) {
  const film = job.film;
  if (!film?.url) return null;
  return (
    <Card className="gap-0 border-emerald-500/40 py-0" data-step="film">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3 [.border-b]:pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <Clapperboard size={18} className="shrink-0 text-emerald-500" aria-hidden />
          <span className="truncate">{film.title || "Your Film"}</span>
        </CardTitle>
        <Badge variant="success">Film</Badge>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <video
          src={film.url}
          controls
          preload="metadata"
          className="aspect-video w-full rounded-md border bg-black"
          data-film
        />
        {film.idea && <p className="text-sm text-muted-foreground">{film.idea}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-3">
            {film.seconds ? <span className="tabular-nums">{clockOf(film.seconds)}</span> : null}
            <a href={film.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline">
              <ExternalLink size={12} aria-hidden /> Open the file
            </a>
            <span>In the Editor's media pool as “Film — {film.title}”</span>
          </span>
          {job.spent != null && (
            <span className="tabular-nums" title="What this Film cost StorySeam">Cost {dollars(job.spent)}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const STAGE_LABELS = {
  referenceSheets: "Reference sheets",
  clips: "Shot sheet clips",
  sitting: "The sitting",
  score: "Score",
  sandbox: "Sandbox time",
};

// Auto off: the one question the job asks — after the World, before anything
// is paid for. Built from the Film plan the job stored on `job.confirm`.
function ConfirmCard({ job, onAnswer, answering }) {
  const confirm = job.confirm || {};
  const plan = confirm.plan || {};
  const perStage = Object.entries(plan.estimate?.perStage || {});
  const awaiting = job.status === "awaiting-confirm";
  const badge =
    confirm.status === "confirmed" ? { variant: "success", label: "Confirmed" }
    : confirm.status === "declined" ? { variant: "muted", label: "Declined" }
    : { variant: "warning", label: "Waiting for you" };
  return (
    <Card className="gap-0 border-amber-500/40 py-0" data-step="confirm" data-status={confirm.status}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <CircleHelp size={16} className="text-amber-500" aria-hidden /> Confirm
        </CardTitle>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <p className="text-sm">
          {awaiting
            ? "The World is ready. Nothing has been paid for yet — here is the Film this prompt will make."
            : confirm.status === "declined"
              ? "Declined. Nothing was spent after the World, and this Film doesn't count against your allowance."
              : "Confirmed — the Film is being made."}
        </p>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Length</dt>
            <dd className="font-medium tabular-nums">{plan.length}{plan.capped ? " (capped)" : ""}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reels</dt>
            <dd className="font-medium tabular-nums">{plan.reels}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Sheets</dt>
            <dd className="font-medium tabular-nums">{plan.sheets}</dd>
          </div>
        </dl>
        {perStage.length > 0 && (
          <div className="space-y-1.5">
            <Eyebrow>Estimated cost</Eyebrow>
            <ul className="space-y-1">
              {perStage.map(([key, s]) => (
                <li key={key} className="flex justify-between text-sm">
                  <span>{STAGE_LABELS[key] || key}</span>
                  <span className="tabular-nums">{dollars(s.usd)}</span>
                </li>
              ))}
              <li className="flex justify-between border-t pt-1 text-sm font-medium">
                <span>Total</span>
                <span className="tabular-nums">{dollars(plan.estimate?.total)}</span>
              </li>
            </ul>
          </div>
        )}
        {awaiting && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => onAnswer("decline")} disabled={!!answering}>
              {answering === "decline" ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
              Decline
            </Button>
            <Button onClick={() => onAnswer("confirm")} disabled={!!answering}>
              {answering === "confirm" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Confirm
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Films waiting behind the running one — one Film at a time per project.
function QueueList({ queue }) {
  if (!queue?.length) return null;
  return (
    <section className="space-y-2" aria-live="polite">
      <Eyebrow className="flex items-center gap-1.5"><Clock size={12} /> Queued behind the current Film</Eyebrow>
      <ol className="space-y-1.5">
        {queue.map((q) => (
          <li key={q.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm" data-queued={q.id}>
            <Badge variant="muted">{q.position}</Badge>
            <span className="line-clamp-2">{q.prompt}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AutoSurface() {
  const { job, queue, status, allowance, auto: savedAuto } = useLoaderData();
  const { revalidate } = useRevalidator();
  useRevalidateOnMount(KEY);

  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState(null);
  // The POST answer, shown until the loader catches up with the same job.
  const [started, setStarted] = useState(null);
  const [queuedNote, setQueuedNote] = useState(null);
  // The Auto toggle — per user, server-side. Local state is the optimistic view.
  const [autoOverride, setAutoOverride] = useState(null);
  const auto = autoOverride ?? savedAuto;
  const [answering, setAnswering] = useState(null);
  const [answerError, setAnswerError] = useState(null);

  const setAuto = async (next) => {
    setAutoOverride(next);
    try {
      const res = await fetch("/api/auto/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto: next }),
      });
      if (!res.ok) throw new Error(`Couldn't save the Auto setting (${res.status}).`);
      invalidateTabCache(KEY);
      revalidate();
    } catch (err) {
      setAutoOverride(!next);
      setRefusal(String(err?.message || err));
    }
  };

  // A newer job (a queued Film that has since started) wins over the POST answer.
  const shown =
    !started ? job
    : !job ? started
    : job.id === started.id || (job.createdAt || "") > (started.createdAt || "") ? job
    : started;
  const running = shown?.status === "running" || shown?.status === "awaiting-confirm";

  const answer = async (kind) => {
    if (!shown?.id || answering) return;
    setAnswering(kind);
    setAnswerError(null);
    try {
      const id = encodeURIComponent(shown.id);
      const url = kind === "confirm" ? `/api/auto/films/${id}/confirm` : `/api/auto/films/${id}/decline`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Couldn't ${kind} (${res.status}).`);
      if (data.job) setStarted(data.job);
    } catch (err) {
      setAnswerError(String(err?.message || err));
    } finally {
      setAnswering(null);
      invalidateTabCache(KEY);
      revalidate();
    }
  };
  const paused = status && !status.ok ? status.reason : null;
  const overAllowance = allowance && allowance.ok === false ? allowance.message : null;
  const blocked = paused || overAllowance;

  const submit = async (e) => {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setRefusal(null);
    setQueuedNote(null);
    try {
      const res = await fetch("/api/auto/films", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setRefusal(data.refusal?.message || data.error || `Couldn't start (${res.status}).`);
      } else if (data.queued) {
        setQueuedNote(`Queued behind the current Film (position ${data.position}). It starts when that one ends.`);
        setPrompt("");
      } else {
        setStarted(data.job);
        setPrompt("");
      }
    } catch (err) {
      setRefusal(String(err?.message || err));
    } finally {
      setSubmitting(false);
      invalidateTabCache(KEY);
      revalidate();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-2">
      <div className="space-y-1">
        <Eyebrow>Auto</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight">Prompt to Film</h1>
        <p className="text-sm text-muted-foreground">
          Describe the film you want. Each step appears below as it starts, and stays when you reload.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <Textarea
          aria-label="Film prompt"
          placeholder="A lighthouse keeper's cat has one stormy night to relight the lamp…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          rows={4}
          disabled={submitting}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="auto-toggle" checked={auto} onCheckedChange={setAuto} aria-describedby="auto-toggle-hint" />
              <Label htmlFor="auto-toggle" className="text-sm">Auto</Label>
              <span id="auto-toggle-hint" className="text-xs text-muted-foreground">
                {auto ? "Nothing asks" : "Asks once, before anything is paid for"}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {allowance?.ok ? `${allowance.remaining} of ${allowance.limit} Films left this month` : null}
            </span>
          </div>
          <Button type="submit" disabled={!prompt.trim() || submitting || !!blocked}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : running ? <Clock size={14} /> : <Sparkles size={14} />}
            {running ? "Queue Film" : "Make Film"}
          </Button>
        </div>
      </form>

      {(refusal || blocked) && <ErrorNote>{refusal || blocked}</ErrorNote>}
      {queuedNote && !refusal && <p className="text-sm text-muted-foreground">{queuedNote}</p>}

      <QueueList queue={queue} />

      {shown && (
        <section className="space-y-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className={cn("line-clamp-2 text-sm", !shown.prompt && "italic text-muted-foreground")}>
              {shown.prompt}
            </p>
            {shown.status === "stopped" && <Badge variant="destructive">Stopped</Badge>}
            {shown.status === "refused" && <Badge variant="muted">Didn't start</Badge>}
            {shown.status === "declined" && <Badge variant="muted">Declined</Badge>}
          </div>
          {shown.steps.length === 0 && running && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Starting…
            </p>
          )}
          {shown.status === "refused" && (
            <ErrorNote>This queued Film couldn't start: {shown.error}</ErrorNote>
          )}
          {/* The confirm card sits right after the step it followed (the World). */}
          {shown.steps.map((s) => (
            <div key={s.key} className="space-y-3">
              <StepCard step={s} />
              {shown.confirm?.after === s.key && (
                <>
                  <ConfirmCard job={shown} onAnswer={answer} answering={answering} />
                  {answerError && <ErrorNote>{answerError}</ErrorNote>}
                </>
              )}
            </div>
          ))}
          {shown.status === "stopped" && <StoppedCard job={shown} />}
          {shown.status === "done" && <FilmCard job={shown} />}
        </section>
      )}
    </div>
  );
}

export function Component() {
  return <AutoSurface />;
}
