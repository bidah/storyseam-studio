import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { CheckCircle2, CircleAlert, Clock, Loader2, MapPin, OctagonX, RotateCw, Sparkles, Users } from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
    const [current, status, allowance] = await Promise.all([
      getJSON("/api/auto/films/current"),
      getJSON("/api/auto/status").catch(() => null),
      getJSON("/api/auto/allowance").catch(() => null),
    ]);
    return { job: current.job || null, queue: current.queue || [], status, allowance };
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

// One card per step. Stages a later slice adds render their summary until they
// get a result view of their own here.
const RESULT_VIEWS = { world: WorldResult };

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
        {step.status === "running" && (
          <p className="text-sm text-muted-foreground">Working on it…</p>
        )}
        {step.status === "retrying" && (
          <p className="text-sm text-muted-foreground">
            The first try failed{step.error ? ` (${step.error})` : ""} — trying once more.
          </p>
        )}
        {step.status === "failed" && <ErrorNote>{step.error || "This step failed."}</ErrorNote>}
        {step.status === "done" && step.summary && (
          <p className="text-xs text-muted-foreground">{step.summary}</p>
        )}
        {step.status === "done" && View && <View result={step.result} />}
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
  const { job, queue, status, allowance } = useLoaderData();
  const { revalidate } = useRevalidator();
  useRevalidateOnMount(KEY);

  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState(null);
  // The POST answer, shown until the loader catches up with the same job.
  const [started, setStarted] = useState(null);
  const [queuedNote, setQueuedNote] = useState(null);

  // A newer job (a queued Film that has since started) wins over the POST answer.
  const shown =
    !started ? job
    : !job ? started
    : job.id === started.id || (job.createdAt || "") > (started.createdAt || "") ? job
    : started;
  const running = shown?.status === "running";
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
          <span className="text-xs text-muted-foreground">
            {allowance?.ok ? `${allowance.remaining} of ${allowance.limit} Films left this month` : null}
          </span>
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
          </div>
          {shown.steps.length === 0 && running && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Starting…
            </p>
          )}
          {shown.status === "refused" && (
            <ErrorNote>This queued Film couldn't start: {shown.error}</ErrorNote>
          )}
          {shown.steps.map((s) => (
            <StepCard key={s.key} step={s} />
          ))}
          {shown.status === "stopped" && <StoppedCard job={shown} />}
        </section>
      )}
    </div>
  );
}

export function Component() {
  return <AutoSurface />;
}
