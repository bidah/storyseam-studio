// /director-story — text to story. The whole product on one page: a prompt in,
// a Film back (CONTEXT.md › Auto). The pieces BOTH of its routes share:
//
//   /director-story                    routes/director-story.jsx — the SIMPLE
//                                      view (hero + input). Submitting starts a
//                                      Film and moves the URL to…
//   /director-story/create/:filmId     routes/director-story-film.jsx — the
//                                      STORY view of THAT Film: one 100dvh
//                                      screen with the prompt, the pipeline's
//                                      steps, and the Film filling ~70% of the
//                                      height when it is done.
//
// The URL is the state: a reload anywhere in a run lands back on the same Film,
// because the page reads it by id (GET /api/auto/films/:id — the running job, a
// queued one, or a finished one from the project's history).
//
// Both are SIBLINGS of RootLayout (src/router.jsx), like /login: no studio
// header, no tab bar, no agent panel. That means none of the shell's plumbing
// runs here either, and this module does the three things the shell would have
// done:
//
//   1. Auth. No session → /login?next=<the full current path>, which returns
//      here after Google sign-in (routes/login.jsx honours `next`).
//   2. Project scope. /api/auto/* is project-scoped through the projectFetch
//      shim (installed in main.jsx for every route). We pick the project exactly
//      the way ProjectProvider does — the last-used one in this browser if it is
//      still reachable, else the server's active one, else the first — and set
//      it on the shim. `GET /api/projects` always answers with at least one
//      project (it creates "My Project" for a user who has none), so there is no
//      separate "make a project" path to get wrong, and the Film lands in the
//      same project the studio would open — its Editor media pool lists it.
//   3. Live updates. The FilmJobs DO broadcasts every step on the project's
//      `data` channel as `{ resource: "auto", job }`; `useProjectEvents` works
//      without the shell, so <LiveSync> subscribes directly and the story page
//      takes its Film's job straight off the frame. A slow poll backs it up
//      while the Film is running or queued (and a reconnect refetches, since
//      the DO keeps no replay).
//
// No loading screen on either route: everything renders at once and the
// session, the project and the Film resolve quietly behind it.
//
// Auto is always on here: there is no toggle and no confirm card. If the
// user's stored Auto setting is off we turn it on before starting.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { ArrowUp, Check, Circle, CircleAlert, Loader2, Mic, Plus, RotateCw, Square, X } from "lucide-react";
import { useVoiceRecording, transcribeAudio, formatDuration } from "@/lib/useVoiceRecording";
import { useSession } from "@/lib/auth-client";
import { getProjectId, setProjectId } from "@/lib/projectFetch";
import { useProjectEvents } from "@/lib/useProjectEvents";
import { HUD, DISPLAY, BODY, MONO } from "@/lib/hudTheme";
import { cn } from "@/lib/utils";

export const PATH = "/director-story";
/** The story page of one Film — the URL that holds it across a reload. */
export const filmPath = (id) => `${PATH}/create/${encodeURIComponent(id)}`;

// Mirrors FILM_STAGES in worker/src/lib/film-job.js (keys are stable public
// ids). The job only lists a step once it has STARTED, so the ones still ahead
// come from here; a label on the job wins over this one.
const STAGES = [
  { key: "world", label: "Idea + World" },
  { key: "sheets", label: "Reference sheets" },
  { key: "shotlist", label: "Shot list" },
  { key: "cuesheet", label: "Cue sheet" },
  { key: "run", label: "Shot sheet run" },
  { key: "stills", label: "Stills" },
  { key: "sitting", label: "Sitting" },
  { key: "score", label: "Score" },
];

// Statuses of a Film still being made (or waiting to be): the story page
// polls as a backstop while its Film is in one of these.
export const ACTIVE = new Set(["running", "awaiting-confirm"]);
export const POLL_MS = 5000;

export async function getJSON(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// Same pick order as ProjectProvider.load().
export async function resolveProject() {
  const { res, data } = await getJSON("/api/projects");
  if (!res.ok) throw new Error(data.error || `Couldn't open your projects (${res.status}).`);
  const list = data.projects || [];
  const saved = getProjectId();
  const pick =
    (saved && list.some((p) => p.id === saved) && saved) ||
    (data.activeId && list.some((p) => p.id === data.activeId) && data.activeId) ||
    list[0]?.id ||
    null;
  if (!pick) throw new Error("No project to make the story in.");
  setProjectId(pick);
  if (pick !== data.activeId) {
    fetch(`/api/projects/${encodeURIComponent(pick)}/activate`, { method: "POST" }).catch(() => {});
  }
  return pick;
}

export async function fetchCurrent() {
  const { res, data } = await getJSON("/api/auto/films/current");
  if (!res.ok) throw new Error(data.error || `Couldn't read the current story (${res.status}).`);
  return data.job || null;
}

/**
 * One Film by id in the current project → the job, or `null` when this project
 * has no such Film (a 404: another project's id, or one aged out of history).
 * Any other failure throws.
 */
export async function fetchFilm(id) {
  const { res, data } = await getJSON(`/api/auto/films/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(data.error || `Couldn't read the story (${res.status}).`);
  return data.job || null;
}

// ── Auth gate ──────────────────────────────────────────────────────────────
//
// A signed-out visitor is sent to sign in and brought back to the SAME url —
// a Film's page included. Signed in (or still finding out), the page renders.

export function AuthGate({ children }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  if (!isPending && !session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children(!!session);
}

// The project, resolved in the background once signed in. `ready` is the
// promise (a submit made before it lands waits on it); `projectId` the value.
export function useDirectorProject(signedIn) {
  const [projectId, setPid] = useState(null);
  const [error, setError] = useState(null);
  const ready = useRef(null);
  useEffect(() => {
    if (!signedIn || ready.current) return;
    ready.current = resolveProject();
    ready.current.then(setPid).catch((e) => setError(String(e?.message || e)));
  }, [signedIn]);
  return { projectId, error, ready };
}

// Live updates for one project. A component of its own so the event stream
// only opens once the project is known (the fetch shim scopes it).
export function LiveSync({ onEvent, onResync }) {
  const { last, resyncs } = useProjectEvents("/api/data/events", { data: true });
  useEffect(() => { if (last) onEvent(last); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [last]);
  useEffect(() => { if (resyncs) onResync(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [resyncs]);
  return null;
}

export function Page({ children, className }) {
  return (
    <div
      className={cn("flex min-h-dvh flex-col bg-[var(--br-neutral)] text-[var(--br-primary)]", className)}
      style={{ ...HUD, fontFamily: BODY, fontSize: "0.92rem", lineHeight: 1.5 }}
      data-director-story
    >
      {children}
    </div>
  );
}

// ── The dots behind the hero ───────────────────────────────────────────────
//
// Vanta's DOTS field (three.js r134, which Vanta is built against) with
// `showLines: false` — the radiating sphere of lines in the middle is gone and
// only the dots remain. Loaded lazily so three.js ships with this page alone,
// and coloured from the page's own tokens so it follows the theme.

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const probe = document.createElement("span");
  probe.style.color = v || fallback;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  probe.remove();
  return (Math.round(rgb[0]) << 16) | (Math.round(rgb[1]) << 8) | Math.round(rgb[2]);
}

function DotsBackground() {
  const ref = useRef(null);
  useEffect(() => {
    let effect = null;
    let host = null;
    let cancelled = false;
    (async () => {
      // Vanta writes onto the THREE it is handed and also looks for
      // window.THREE; an ES module namespace is frozen, so it gets a plain copy.
      const THREE = { ...(await import("three")) };
      window.THREE = THREE;
      const { default: DOTS } = await import("vanta/dist/vanta.dots.min");
      if (cancelled || !ref.current) return;
      // Vanta rewrites the element it is given, so it gets one React never
      // renders: created here, removed on cleanup.
      host = document.createElement("div");
      host.style.cssText = "position:absolute;inset:0";
      ref.current.appendChild(host);
      const dot = cssColor("--br-tertiary", "#e8622c");
      effect = DOTS({
        el: host,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200,
        minWidth: 200,
        scale: 1,
        scaleMobile: 1,
        color: dot,
        color2: dot,
        backgroundColor: cssColor("--br-neutral", "#0b0c0e"),
        size: 3,
        spacing: 35,
        showLines: false,
      });
    })().catch(() => { /* no WebGL: the plain background stands */ });
    return () => {
      cancelled = true;
      try { effect?.destroy(); } catch { /* already torn down */ }
      host?.remove();
    };
  }, []);
  return <div ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-0" />;
}

// ── Simple view: hero + input ──────────────────────────────────────────────

export function SimpleView({ onSubmit, submitting, note, running }) {
  const [prompt, setPrompt] = useState("");
  const ref = useRef(null);
  // Dictation: the same Whisper path the studio's composers use. The one
  // button is a mic while the box is empty and the send arrow once it isn't.
  const rec = useVoiceRecording();
  const [transcribing, setTranscribing] = useState(false);
  const [voiceNote, setVoiceNote] = useState(null);

  const startRecording = async () => {
    setVoiceNote(null);
    try { await rec.start(); } catch (e) { setVoiceNote(e?.message || "Couldn't start recording."); }
  };
  const stopAndTranscribe = async () => {
    setTranscribing(true);
    try {
      const blob = await rec.stop();
      if (!blob || blob.size < 100) return; // nothing usable captured
      const { text } = await transcribeAudio(blob);
      const heard = (text || "").trim();
      if (heard) setPrompt((v) => (v.trim() ? `${v.trim()} ${heard}` : heard));
      else setVoiceNote("Didn't catch that — try again.");
      ref.current?.focus();
    } catch (e) {
      setVoiceNote(e?.message || "Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  };
  const listening = rec.recording || transcribing;

  // A real text area: five lines tall to start, grows with the text up to a
  // cap, then scrolls inside.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(Math.min(el.scrollHeight, 360), 136)}px`;
  }, [prompt]);

  const submit = async (e) => {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || submitting) return;
    if (await onSubmit(text)) setPrompt("");
  };

  return (
    <Page className="relative items-center justify-center px-4 animate-in fade-in duration-300">
      <DotsBackground />
      {/* The headline sets the column's width (one line, sized with the
          viewport so it never wraps) and the input fills exactly that width. */}
      <main className="relative z-10 flex w-fit max-w-full flex-col items-stretch gap-8 text-center">
        <h1
          className="whitespace-nowrap leading-none"
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            letterSpacing: "0.02em",
            fontSize: "min(2.8rem, calc((100vw - 2rem) / 22))",
          }}
        >
          TEXT TO LONG FORM VIDEO STORIES IN SECONDS
        </h1>
        <form onSubmit={submit} className="w-full">
          <div className="flex items-end gap-2 border border-[var(--br-secondary)]/40 bg-[var(--br-surface)] p-2 text-left focus-within:border-[var(--br-primary)]">
            <textarea
              ref={ref}
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
              }}
              placeholder="Tell what story premise you have"
              aria-label="Story premise"
              disabled={submitting}
              className="min-h-34 flex-1 resize-none bg-transparent px-3 py-3 text-base leading-relaxed text-[var(--br-primary)] placeholder:text-[var(--br-secondary)] focus:outline-none disabled:opacity-60"
            />
            {listening ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs tabular-nums text-[var(--br-secondary)]">
                  {transcribing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <span className="size-2 animate-pulse rounded-full bg-[var(--br-tertiary)]" />
                  )}
                  {transcribing ? "Transcribing…" : formatDuration(rec.duration)}
                </span>
                <button
                  type="button"
                  onClick={() => rec.cancel()}
                  disabled={transcribing}
                  aria-label="Cancel recording"
                  className="flex size-10 items-center justify-center text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)] disabled:opacity-40"
                >
                  <X size={18} />
                </button>
                <button
                  type="button"
                  onClick={stopAndTranscribe}
                  disabled={transcribing}
                  aria-label="Stop and transcribe"
                  className="flex size-10 items-center justify-center bg-[var(--br-tertiary)] text-[var(--br-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {transcribing ? <Loader2 size={18} className="animate-spin" /> : <Square size={16} fill="currentColor" />}
                </button>
              </div>
            ) : prompt.trim() ? (
              <button
                type="submit"
                aria-label="Make the story"
                disabled={submitting}
                className="flex size-10 shrink-0 items-center justify-center bg-[var(--br-tertiary)] text-[var(--br-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                aria-label="Dictate your premise"
                className="flex size-10 shrink-0 items-center justify-center bg-[var(--br-tertiary)] text-[var(--br-on-primary)] transition-opacity hover:opacity-90"
              >
                <Mic size={18} />
              </button>
            )}
          </div>
        </form>
        <p className="min-h-5 text-sm text-[var(--br-secondary)]" aria-live="polite" data-note>
          {voiceNote || note}
        </p>
        {/* A Film already being made on this project: never hijack the page
            onto it, just offer the way there. */}
        {running?.id ? (
          <Link
            to={filmPath(running.id)}
            className="-mt-6 self-center text-sm text-[var(--br-secondary)] underline-offset-4 transition-colors hover:text-[var(--br-primary)] hover:underline"
            data-running-link
          >
            A story is being made → view it
          </Link>
        ) : null}
      </main>
    </Page>
  );
}

// ── Story view: 100dvh — prompt, steps, and the Film ────────────────────────

function stepsOf(job) {
  const byKey = new Map((job.steps || []).map((s) => [s.key, s]));
  const known = STAGES.map((st) => {
    const s = byKey.get(st.key);
    return {
      key: st.key,
      label: s?.label || st.label,
      status: s ? s.status : "pending",
      summary: s?.status === "failed" ? s.error : s?.summary || null,
    };
  });
  // A stage the worker added later than this list: show it rather than drop it.
  for (const s of job.steps || []) {
    if (!STAGES.some((st) => st.key === s.key)) {
      known.push({ key: s.key, label: s.label, status: s.status, summary: s.summary || null });
    }
  }
  return known;
}

function StepIcon({ status, size = 16 }) {
  if (status === "done") return <Check size={size} className="text-[var(--br-primary)]" aria-hidden />;
  if (status === "failed") return <CircleAlert size={size} className="text-[var(--br-tertiary)]" aria-hidden />;
  if (status === "retrying") return <RotateCw size={size} className="animate-spin text-[var(--br-primary)]" aria-hidden />;
  if (status === "running") return <Loader2 size={size} className="animate-spin text-[var(--br-primary)]" aria-hidden />;
  return <Circle size={size - 4} className="text-[var(--br-secondary)]/60" aria-hidden />;
}

const STATUS_WORD = { done: "done", failed: "failed", retrying: "retrying", running: "in progress", pending: "waiting" };

export function StoryView({ job, onNew }) {
  const steps = stepsOf(job);
  const done = job.status === "done" && job.film?.url;
  const stopped = job.status === "stopped";
  const waiting = job.status === "awaiting-confirm";
  const queued = job.status === "queued";
  // Ended without a Film worth showing: one line says why.
  const ended =
    job.status === "declined"
      ? "This story was declined before anything was made."
      : job.status === "refused"
        ? `This story couldn't start${job.error ? `: ${job.error}` : "."}`
        : null;

  return (
    <Page className="h-dvh min-h-0 overflow-hidden animate-in fade-in zoom-in-[0.98] duration-500" >
      <div className="flex h-dvh flex-col" data-story-view data-status={job.status}>
        {/* The prompt, small, and the way back to a new one. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--br-secondary)]/25 px-4 py-3 sm:px-8">
          <p className="min-w-0 flex-1 truncate text-sm text-[var(--br-secondary)]" title={job.prompt} data-prompt>
            {job.prompt}
          </p>
          <button
            type="button"
            onClick={onNew}
            className="flex shrink-0 items-center gap-1.5 border border-[var(--br-secondary)]/40 px-3 py-1.5 text-[0.72rem] uppercase text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)]"
            style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
          >
            <Plus size={12} aria-hidden /> New story
          </button>
        </div>

        {done ? (
          <div className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-700">
            <div className="flex h-[70dvh] shrink-0 items-center justify-center bg-black px-4 py-3 sm:px-8">
              <video
                src={job.film.url}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
                data-film
              />
            </div>
            <div className="flex min-h-0 flex-1 items-center overflow-y-auto px-4 py-3 sm:px-8">
              <ol className="mx-auto flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="Steps" data-steps="compact">
                {steps.map((s) => (
                  <li key={s.key} className="flex items-center gap-1.5 text-xs text-[var(--br-secondary)]" data-step={s.key} data-status={s.status}>
                    <StepIcon status={s.status} size={14} />
                    <span>{s.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-6">
            <div className="w-full max-w-md space-y-6">
              <ol className="space-y-3" aria-label="Steps" aria-live="polite" data-steps="full">
                {steps.map((s) => (
                  <li
                    key={s.key}
                    className={cn(
                      "flex items-start gap-3 transition-opacity duration-300",
                      s.status === "pending" && "opacity-50",
                    )}
                    data-step={s.key}
                    data-status={s.status}
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                      <StepIcon status={s.status} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={cn(s.status === "running" || s.status === "retrying" ? "text-[var(--br-primary)]" : "text-[var(--br-primary)]/80")}>
                          {s.label}
                        </span>
                        <span
                          className="shrink-0 text-[0.72rem] uppercase text-[var(--br-secondary)]"
                          style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
                        >
                          {STATUS_WORD[s.status] || s.status}
                        </span>
                      </span>
                      {s.summary && s.status !== "pending" && (
                        <span className="block truncate text-xs text-[var(--br-secondary)]">{s.summary}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
              {stopped && (
                <p className="text-sm text-[var(--br-tertiary)]" data-stopped>
                  This story couldn't be finished. It doesn't count against your allowance.
                </p>
              )}
              {queued && (
                <p className="text-sm text-[var(--br-secondary)]" data-queued>
                  Queued — position {job.position ?? "?"}. It starts on its own when the story ahead of it ends.
                </p>
              )}
              {ended && (
                <p className="text-sm text-[var(--br-tertiary)]" data-ended>
                  {ended}
                </p>
              )}
              {waiting && (
                <p className="text-sm text-[var(--br-secondary)]">
                  This story is waiting for a confirmation in the studio's Auto view.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
