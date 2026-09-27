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
//   2. Project scope. Every Film runs in a NEW project of its own, made by the
//      Worker when it starts (POST /api/auto/films answers with its
//      `projectId`) — never in the studio's current project, whose World would
//      bleed into the Film's. The story page therefore finds its project from
//      the Film id (GET /api/auto/films/:id/project, user-scoped) and sets it on
//      the projectFetch shim before it reads the job, so a reload or a shared
//      link lands in the right project whatever the "current" one is
//      (useFilmProject). The simple page still resolves a project the way
//      ProjectProvider does (useDirectorProject) — only for the per-user
//      settings call, which the middleware scopes like any other write.
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
import {
  ArrowUp, Check, ChevronDown, Circle, Clapperboard, CircleAlert, Copy, Download, Film, Link2Off, Loader2, Mic, PenLine, Plus, RotateCw, Settings2,
  Share2, Square, Users, X, icons as LUCIDE,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_DEEP_SPECIALISTS, FILM_DEFAULT_SECONDS, FILM_DEPTHS, FILM_STEPS, FILM_STYLES, FILM_WRITERS, STORY_FLOW_DEFAULT_SECONDS,
  STORY_FLOW_STEPS, formatLength, roomEstimate,
} from "@/lib/film-plan";
import { SPECIALISTS, STAGE_ORDER, isSpecialistId } from "@/lib/specialists";
import { useVoiceRecording, transcribeAudio, formatDuration } from "@/lib/useVoiceRecording";
import { authClient, useSession } from "@/lib/auth-client";
import { isDesktop } from "@/lib/desktop";
import { getProjectId, setProjectId } from "@/lib/projectFetch";
import { useProjectEvents } from "@/lib/useProjectEvents";
import { HUD, DISPLAY, BODY, MONO } from "@/lib/hudTheme";
import { cn } from "@/lib/utils";

// Mirrors FILM_STAGES in worker/src/lib/film-job.js (keys are stable public
// ids). The job only lists a step once it has STARTED, so the ones still ahead
// come from here; a label on the job wins over this one.
const STAGES = [
  { key: "look", label: "Look" },
  { key: "world", label: "Idea + World" },
  { key: "script", label: "Script" },
  { key: "sheets", label: "Reference sheets" },
  { key: "shotlist", label: "Shot list" },
  { key: "cuesheet", label: "Cue sheet" },
  { key: "run", label: "Shot sheet run" },
  { key: "stills", label: "Stills" },
  { key: "sitting", label: "Sitting" },
  { key: "score", label: "Score" },
];

// Mirrors STORY_FLOW_STAGES (the Seedance 2.5 pipeline) the same way.
const STORY_FLOW_STAGES = [
  { key: "look", label: "Look" },
  { key: "world", label: "Idea + World" },
  { key: "script", label: "Script" },
  { key: "sheets", label: "Character & location sheets" },
  { key: "shotlist", label: "Shot list" },
  { key: "prompts", label: "Segment prompts" },
  { key: "run", label: "Video run" },
  { key: "stitch", label: "Final cut" },
];

// ── Flows: one page, a pipeline per GEN MODE ────────────────────────────────
//
// `/` makes a Film either with the live Director (fal's H3
// Director) or from the same prompt on Seedance 2.5 (film-plan.ts › The STORY
// FLOW). The input's Gen mode picker is the choice: the chosen flow sends
// `engine` with the prompt, offers its own lengths (the story flow adds 1:00,
// for testing a story cheaply), and remembers its own length. Every Film's page
// is /create/:filmId and follows the Film's engine, so a link lands on the
// right steps. /director-story and /story-flow survive only as redirects.
export const FLOWS = {
  director: {
    id: "director",
    path: "/",
    engine: null,
    steps: FILM_STEPS,
    defaultSeconds: FILM_DEFAULT_SECONDS,
    stages: STAGES,
    storage: "director-story",
    label: "fal H3 Director",
    blurb: "A drawn frame every ~4s, played live as one sitting, then scored.",
  },
  seedance: {
    id: "seedance",
    path: "/",
    engine: "seedance",
    steps: STORY_FLOW_STEPS,
    defaultSeconds: STORY_FLOW_DEFAULT_SECONDS,
    stages: STORY_FLOW_STAGES,
    storage: "story-flow",
    label: "Seedance 2.5",
    blurb: "15s segments, each extending the last, at 480p. Seedance writes the sound; can be 1:00.",
  },
};
export const GEN_MODES = [FLOWS.director, FLOWS.seedance];
/** A flow by its id (a stored or URL value) → the flow | null. */
export const flowById = (id) => (typeof id === "string" && Object.hasOwn(FLOWS, id) ? FLOWS[id] : null);
/** The flow a Film was made on, from its job's `engine`. */
export const flowOf = (engine) => (engine === "seedance" ? FLOWS.seedance : FLOWS.director);

// The Gen mode is remembered per browser, like the look.
const MODE_KEY = "director-story:mode";
export function readStoredFlow() {
  try {
    return flowById(window.localStorage.getItem(MODE_KEY)) || FLOWS.director;
  } catch {
    return FLOWS.director;
  }
}
export function storeFlow(flow) {
  try { window.localStorage.setItem(MODE_KEY, flow.id); } catch { /* private mode: not remembered */ }
}

// A Deep Film runs the writers' room after the Script (worker stagesFor).
const ROOM_STAGE = { key: "room", label: "Writers' room" };
export function stagesOf(job) {
  const base = flowOf(job?.engine).stages;
  if (job?.depth !== "deep") return base;
  const at = base.findIndex((s) => s.key === "script") + 1;
  return [...base.slice(0, at), ROOM_STAGE, ...base.slice(at)];
}

export const PATH = FLOWS.director.path;
/** The story page of one Film — the URL that holds it across a reload. */
export const filmPath = (id) => `/create/${encodeURIComponent(id)}`;

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

/**
 * The signed-in user's latest Film, wherever it runs (user-scoped) → the job
 * (with its id) | null.
 */
export async function fetchLatest() {
  const { res, data } = await getJSON("/api/auto/films/latest");
  if (!res.ok) throw new Error(data.error || `Couldn't read your latest story (${res.status}).`);
  return data.job || null;
}

/**
 * Which project a Film runs in (user-scoped: only the user's own Films) →
 * project id | null (unknown id, someone else's, or a Film started before every
 * Film had a project of its own). Any other failure throws.
 */
export async function fetchFilmProject(id) {
  const { res, data } = await getJSON(`/api/auto/films/${encodeURIComponent(id)}/project`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(data.error || `Couldn't find the story (${res.status}).`);
  return data.projectId || null;
}

/**
 * One Film by id → the job, or `null` when there is no such Film (a 404: an
 * unknown id, someone else's, or one aged out of history). The Worker finds the
 * Film's own project itself; the shim's project only matters for a Film older
 * than the lookup. Any other failure throws.
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

// The project ONE Film runs in, looked up from its id and set on the shim
// before anything reads the job — so the live channel and every call are
// scoped to the Film's own project. A Film the lookup doesn't know (started
// before every Film had its own project) falls back to the studio's project,
// the only place it can be. → { projectId, error }
export function useFilmProject(signedIn, filmId) {
  const [projectId, setPid] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!signedIn || !filmId) return;
    let live = true;
    setPid(null);
    setError(null);
    fetchFilmProject(filmId)
      .then((pid) => {
        if (!pid) return resolveProject();
        setProjectId(pid);
        return pid;
      })
      .then((pid) => { if (live) setPid(pid); })
      .catch((e) => { if (live) setError(String(e?.message || e)); });
    return () => { live = false; };
  }, [signedIn, filmId]);
  return { projectId, error };
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

// ── Story settings: the gear beside the send button ────────────────────────
//
// The defaults a story is made with, changeable before sending. For now that is
// the Film's LENGTH: 2:00 unless changed, any 30s step up to the ceiling
// (film-plan.ts FILM_STEPS). Once the author has CHOSEN a length here it is
// sent as `seconds` and wins over a length the prompt's wording states; until
// then nothing is sent, so "a four-minute short" in the prompt still counts. Remembered per browser — a
// convenience only, so every storage access is allowed to fail.

const lengthKey = (flow) => `${flow.storage}:length`;

export function readStoredLength(flow = FLOWS.director) {
  try {
    const n = Number(window.localStorage.getItem(lengthKey(flow)));
    return flow.steps.includes(n) ? n : flow.defaultSeconds;
  } catch {
    return flow.defaultSeconds;
  }
}

function hasStoredLength(flow) {
  try { return flow.steps.includes(Number(window.localStorage.getItem(lengthKey(flow)))); } catch { return false; }
}

function storeLength(flow, seconds) {
  try { window.localStorage.setItem(lengthKey(flow), String(seconds)); } catch { /* private mode: not remembered */ }
}

// The Film's look (film-plan.ts FILM_STYLES). "" = read it off the premise
// ("a pixar like story") and fall back to the default — so nothing is sent.
const STYLE_KEY = "director-story:style";
function readStoredStyle() {
  try {
    const v = window.localStorage.getItem(STYLE_KEY) || "";
    return FILM_STYLES.some((s) => s.id === v) ? v : "";
  } catch {
    return "";
  }
}
function storeStyle(style) {
  try { window.localStorage.setItem(STYLE_KEY, style); } catch { /* private mode: not remembered */ }
}
const STYLE_CHOICES = [{ id: "", label: "Auto" }, ...FILM_STYLES.map((s) => ({ id: s.id, label: s.label }))];

function SettingsLabel({ id, children, hint }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-6">
      <span
        id={id}
        className="text-[0.72rem] uppercase text-[var(--br-secondary)]"
        style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
      >
        {children}
      </span>
      {hint ? <span className="text-[0.72rem] text-[var(--br-secondary)]">{hint}</span> : null}
    </div>
  );
}

function Choice({ on, onClick, children }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "-ml-px border px-2.5 py-1.5 text-[0.72rem] tabular-nums transition-colors first:ml-0",
        on
          ? "relative z-10 border-[var(--br-tertiary)] bg-[var(--br-tertiary)] text-[var(--br-on-primary)]"
          : "border-[var(--br-secondary)]/40 text-[var(--br-primary)]/80 hover:text-[var(--br-primary)]",
      )}
      style={{ fontFamily: MONO }}
    >
      {children}
    </button>
  );
}

function StorySettings({ flow, seconds, onSeconds, style, onStyle, writer, onWriter, disabled }) {
  const writers = useWriterChoices();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Story settings"
          disabled={disabled}
          className="flex h-10 shrink-0 items-center gap-1.5 px-2 text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)] disabled:opacity-40 data-[state=open]:text-[var(--br-primary)]"
          data-story-settings
        >
          <Settings2 size={16} aria-hidden />
          {/* The look rides on the button too: it is remembered per browser, so
              what will be sent must be visible before sending — an unseen
              "Auto" once made a story the author meant as anime live action. */}
          <span className="text-[0.72rem] uppercase tabular-nums" style={{ fontFamily: MONO, letterSpacing: "0.08em" }} data-story-settings-summary>
            {formatLength(seconds)} · {FILM_STYLES.find((st) => st.id === style)?.label || "Auto look"}
          </span>
        </button>
      </PopoverTrigger>
      {/* Portaled out of the page, so it carries the page's tokens itself. */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-auto border-[var(--br-secondary)]/40 bg-[var(--br-surface)] p-3 text-[var(--br-primary)]"
        style={{ ...HUD, fontFamily: BODY }}
        data-story-settings-panel
      >
        <SettingsLabel
          id="story-length-label"
          hint={seconds === flow.defaultSeconds ? "default" : `default ${formatLength(flow.defaultSeconds)}`}
        >
          Length
        </SettingsLabel>
        <div role="radiogroup" aria-labelledby="story-length-label" className="flex">
          {flow.steps.map((step) => (
            <Choice key={step} on={step === seconds} onClick={() => onSeconds(step)}>
              {formatLength(step)}
            </Choice>
          ))}
        </div>
        <div className="mt-4">
          <SettingsLabel id="story-style-label">Look</SettingsLabel>
          <div role="radiogroup" aria-labelledby="story-style-label" className="flex" data-story-style>
            {STYLE_CHOICES.map((c) => (
              <Choice key={c.id || "auto"} on={c.id === style} onClick={() => onStyle(c.id)}>
                {c.label}
              </Choice>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <SettingsLabel id="story-model-label">Writing model</SettingsLabel>
          <div role="radiogroup" aria-labelledby="story-model-label" className="flex" data-story-writer>
            {writers.map((w) => (
              <Choice key={w.id} on={w.id === writer} onClick={() => onWriter(w.id)}>
                {w.label}
              </Choice>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// The LLM that writes the Film — Idea, World, sheet prompts, Shot list, cues
// (film-plan.ts FILM_WRITERS). "default" is the Worker's own writer, so nothing
// is sent for it. Remembered per browser, and — like the look — always named
// on the input, so what will be sent is visible before sending.
const WRITER_KEY = "director-story:writer";
function readStoredWriter() {
  try {
    const v = window.localStorage.getItem(WRITER_KEY) || "default";
    return FILM_WRITERS.some((w) => w.id === v) ? v : "default";
  } catch {
    return "default";
  }
}
function storeWriter(writer) {
  try { window.localStorage.setItem(WRITER_KEY, writer); } catch { /* private mode: not remembered */ }
}

// The Worker names the default writer for what it is (GET /api/auto/status
// `writers`); signed out, or before it answers, the shared labels stand in.
function useWriterChoices() {
  const [writers, setWriters] = useState(FILM_WRITERS);
  useEffect(() => {
    let live = true;
    fetch("/api/auto/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && Array.isArray(d?.writers) && d.writers.length) setWriters(d.writers); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return writers;
}

// ── The writer: how much STORY work a Film gets (film-plan.ts FILM_DEPTHS) ──
//
// Fast: one screenwriter writes the script and it is shot. Deep: the chosen
// specialists (src/lib/specialists.ts — the same fifteen the chat delegates
// to) read the draft and it is rewritten on their notes. The room is picked in
// a dialog and quoted in time; both are remembered per browser and, like the
// look, named on the button so what will be sent is visible before sending.
const DEPTH_KEY = "director-story:depth";
const ROOM_KEY = "director-story:room";
function readStoredDepth() {
  try {
    const v = window.localStorage.getItem(DEPTH_KEY) || "fast";
    return FILM_DEPTHS.some((d) => d.id === v) ? v : "fast";
  } catch {
    return "fast";
  }
}
function storeDepth(depth) {
  try { window.localStorage.setItem(DEPTH_KEY, depth); } catch { /* private mode: not remembered */ }
}
function readStoredRoom() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(ROOM_KEY) || "null");
    const ids = Array.isArray(saved) ? saved.filter(isSpecialistId) : [];
    return ids.length ? ids : [...DEFAULT_DEEP_SPECIALISTS];
  } catch {
    return [...DEFAULT_DEEP_SPECIALISTS];
  }
}
function storeRoom(room) {
  try { window.localStorage.setItem(ROOM_KEY, JSON.stringify(room)); } catch { /* private mode: not remembered */ }
}

const STAGE_LABELS = { outline: "Outline", draft: "Draft", polish: "Polish", lock: "Lock" };
const STAGE_HINTS = {
  outline: "the shape, before scenes",
  draft: "scenes that can be read end to end",
  polish: "line- and beat-level",
  lock: "ready for production",
};

/** The room dialog: the fifteen specialists by stage, toggled, with the time it costs. */
function RoomDialog({ open, onOpenChange, room, onRoom }) {
  const [draft, setDraft] = useState(room);
  useEffect(() => { if (open) setDraft(room); }, [open, room]);
  const toggle = (id) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const est = roomEstimate(draft);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-none border-[var(--br-secondary)]/40 bg-[var(--br-surface)] text-[var(--br-primary)]"
        style={{ ...HUD, fontFamily: BODY }}
        data-story-room
      >
        <DialogTitle style={{ fontFamily: DISPLAY, letterSpacing: "0.04em" }} className="text-2xl font-bold uppercase">
          The writers' room
        </DialogTitle>
        <DialogDescription className="text-[var(--br-secondary)]">
          Each specialist reads the first draft and hands back notes; the script is then rewritten on all of
          them. More passes, a better script, a longer wait.
        </DialogDescription>
        <div className="flex flex-col gap-4">
          {STAGE_ORDER.map((stage) => {
            const members = SPECIALISTS.filter((sp) => sp.stage === stage);
            if (!members.length) return null;
            return (
              <div key={stage}>
                <SettingsLabel id={`room-${stage}`} hint={STAGE_HINTS[stage]}>{STAGE_LABELS[stage]}</SettingsLabel>
                <div role="group" aria-labelledby={`room-${stage}`} className="flex flex-col">
                  {members.map((sp) => {
                    const on = draft.includes(sp.id);
                    const Icon = LUCIDE[sp.icon] || Users;
                    return (
                      <button
                        key={sp.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(sp.id)}
                        className={cn(
                          "flex w-full items-start gap-3 border-t border-[var(--br-secondary)]/20 px-1 py-2 text-left transition-colors hover:bg-[var(--br-secondary)]/10",
                          on ? "text-[var(--br-primary)]" : "text-[var(--br-primary)]/70",
                        )}
                        data-room-specialist={sp.id}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                            on ? "border-[var(--br-tertiary)] bg-[var(--br-tertiary)] text-[var(--br-on-primary)]" : "border-[var(--br-secondary)]/60",
                          )}
                        >
                          {on ? <Check size={12} aria-hidden /> : null}
                        </span>
                        <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--br-secondary)]" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm">{sp.title}</span>
                          <span className="text-xs text-[var(--br-secondary)]">{sp.label} — {sp.does}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-[var(--br-secondary)]/40 pt-3">
          <span className="text-[0.72rem] uppercase tabular-nums text-[var(--br-secondary)]" style={{ fontFamily: MONO, letterSpacing: "0.08em" }} data-room-estimate>
            {est.passes} {est.passes === 1 ? "pass" : "passes"} · {est.label}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDraft([...DEFAULT_DEEP_SPECIALISTS])}
              className="px-2 py-1.5 text-[0.72rem] uppercase text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)]"
              style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
            >
              Core four
            </button>
            <button
              type="button"
              disabled={!est.passes}
              onClick={() => { onRoom(draft); onOpenChange(false); }}
              className="bg-[var(--br-tertiary)] px-3 py-1.5 text-[0.72rem] uppercase text-[var(--br-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
            >
              Use this room
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DepthPicker({ depth, onDepth, room, onRoom, disabled }) {
  const [open, setOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const est = roomEstimate(room);
  const label = depth === "deep" ? `Deep · ${est.passes} ${est.passes === 1 ? "pass" : "passes"} · ${est.label}` : "Fast";
  const pick = (id) => {
    onDepth(id);
    setOpen(false);
    if (id === "deep") setRoomOpen(true);
  };
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Writer: ${label}`}
            disabled={disabled}
            className="flex h-10 shrink-0 items-center gap-1.5 px-2 text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)] disabled:opacity-40 data-[state=open]:text-[var(--br-primary)]"
            data-story-depth
          >
            <PenLine size={16} aria-hidden />
            <span className="text-[0.72rem] uppercase tabular-nums" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
              {label}
            </span>
            <ChevronDown size={12} aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-80 border-[var(--br-secondary)]/40 bg-[var(--br-surface)] p-1 text-[var(--br-primary)]"
          style={{ ...HUD, fontFamily: BODY }}
          data-story-depth-panel
        >
          <div className="px-2 pb-1 pt-2">
            <SettingsLabel id="story-depth-label">Writer</SettingsLabel>
          </div>
          <div role="radiogroup" aria-labelledby="story-depth-label">
            {FILM_DEPTHS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={d.id === depth}
                onClick={() => pick(d.id)}
                className="flex w-full items-start gap-2 px-2 py-2 text-left transition-colors hover:bg-[var(--br-secondary)]/10"
              >
                <Check size={14} aria-hidden className={cn("mt-0.5 shrink-0", d.id === depth ? "opacity-100" : "opacity-0")} />
                <span className="flex flex-col">
                  <span className="text-sm">{d.label}</span>
                  <span className="text-xs text-[var(--br-secondary)]">{d.blurb}</span>
                </span>
              </button>
            ))}
          </div>
          {depth === "deep" ? (
            <button
              type="button"
              onClick={() => { setOpen(false); setRoomOpen(true); }}
              className="mt-1 flex w-full items-center gap-2 border-t border-[var(--br-secondary)]/20 px-2 py-2 text-left text-xs text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)]"
            >
              <Users size={14} aria-hidden />
              Choose the room — {est.passes} {est.passes === 1 ? "pass" : "passes"}, {est.label}
            </button>
          ) : null}
        </PopoverContent>
      </Popover>
      <RoomDialog open={roomOpen} onOpenChange={setRoomOpen} room={room} onRoom={onRoom} />
    </>
  );
}

// ── Gen mode: which video model makes the Film ─────────────────────────────
//
// Named on its button, like the look and the writer: the two modes differ a lot
// in cost and in what comes back, so what will be sent is visible before sending.
function GenModePicker({ flow, onFlow, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Gen mode: ${flow.label}`}
          disabled={disabled}
          className="flex h-10 shrink-0 items-center gap-1.5 px-2 text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)] disabled:opacity-40 data-[state=open]:text-[var(--br-primary)]"
          data-gen-mode={flow.id}
        >
          <Clapperboard size={16} aria-hidden />
          <span className="text-[0.72rem] uppercase" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
            {flow.label}
          </span>
          <ChevronDown size={12} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-80 border-[var(--br-secondary)]/40 bg-[var(--br-surface)] p-1 text-[var(--br-primary)]"
        style={{ ...HUD, fontFamily: BODY }}
        data-gen-mode-panel
      >
        <div className="px-2 pb-1 pt-2">
          <SettingsLabel id="story-gen-mode-label">Gen mode</SettingsLabel>
        </div>
        <div role="radiogroup" aria-labelledby="story-gen-mode-label">
          {GEN_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === flow.id}
              onClick={() => { onFlow(m); setOpen(false); }}
              className="flex w-full items-start gap-2 px-2 py-2 text-left transition-colors hover:bg-[var(--br-secondary)]/10"
            >
              <Check size={14} aria-hidden className={cn("mt-0.5 shrink-0", m.id === flow.id ? "opacity-100" : "opacity-0")} />
              <span className="flex flex-col">
                <span className="text-sm">{m.label}</span>
                <span className="text-xs text-[var(--br-secondary)]">{m.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Simple view: hero + input ──────────────────────────────────────────────

export function SimpleView({ flow = FLOWS.director, onFlow, onSubmit, submitting, note, running, below = null }) {
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(() => readStoredLength(flow));
  const [chosen, setChosen] = useState(() => hasStoredLength(flow));
  // Each mode remembers its own length (only Seedance offers 1:00).
  useEffect(() => {
    setSeconds(readStoredLength(flow));
    setChosen(hasStoredLength(flow));
  }, [flow]);
  const [style, setStyle] = useState(readStoredStyle);
  const [writer, setWriter] = useState(readStoredWriter);
  const chooseWriter = (id) => {
    setWriter(id);
    storeWriter(id);
  };
  const [depth, setDepth] = useState(readStoredDepth);
  const chooseDepth = (id) => {
    setDepth(id);
    storeDepth(id);
  };
  const [room, setRoom] = useState(readStoredRoom);
  const chooseRoom = (ids) => {
    setRoom(ids);
    storeRoom(ids);
  };
  const chooseStyle = (id) => {
    setStyle(id);
    storeStyle(id);
  };
  const chooseSeconds = (s) => {
    setSeconds(s);
    setChosen(true);
    storeLength(flow, s);
  };
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
    const opts = {
      seconds: chosen ? seconds : undefined,
      style: style || undefined,
      writer: writer !== "default" ? writer : undefined,
      depth: depth === "deep" ? depth : undefined,
      specialists: depth === "deep" ? room : undefined,
    };
    if (await onSubmit(text, opts)) setPrompt("");
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
            {!listening && onFlow && <GenModePicker flow={flow} onFlow={onFlow} disabled={submitting} />}
            {!listening && <DepthPicker depth={depth} onDepth={chooseDepth} room={room} onRoom={chooseRoom} disabled={submitting} />}
            {!listening && (
              <StorySettings
                flow={flow} seconds={seconds} onSeconds={chooseSeconds} style={style} onStyle={chooseStyle}
                writer={writer} onWriter={chooseWriter} disabled={submitting}
              />
            )}
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
        {/* A Film of this user's still being made: never hijack the page
            onto it, just offer the way there. */}
        {running?.id ? (
          <Link
            to={filmPath(running.id)}
            state={{ engine: running.engine || null }}
            className="-mt-6 self-center text-sm text-[var(--br-secondary)] underline-offset-4 transition-colors hover:text-[var(--br-primary)] hover:underline"
            data-running-link
          >
            A story is being made → view it
          </Link>
        ) : null}
        {below}
      </main>
    </Page>
  );
}

// ── Signed out: the premise waits across the Google round trip ──────────────
//
// /director-story opens WITHOUT a session: the hero and the box are the pitch.
// Submitting signed out keeps the premise (and the gear's length) in
// localStorage and opens the sign-in modal; Google returns to
// `/director-story?resume=1`, which starts that premise and moves to its Film's
// own page — the visitor never types it twice. An hour old and it is dropped:
// a premise from yesterday is not what someone signing in today meant.
// One key for both modes: the saved premise carries the mode it was sent in.
const PENDING_KEY = "director-story:pending";
const PENDING_TTL_MS = 60 * 60 * 1000;
export const RESUME_PARAM = "resume";

export function savePendingStory(flow, prompt, opts = {}) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      prompt, flow: flow.id,
      seconds: opts.seconds ?? null, style: opts.style ?? null, writer: opts.writer ?? null,
      depth: opts.depth ?? null, specialists: opts.specialists ?? null,
      at: Date.now(),
    }));
  } catch { /* private mode */ }
}

/** The premise saved before sign-in, taken (read AND cleared) → { prompt, opts, flow } | null. */
export function takePendingStory() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved?.prompt || Date.now() - Number(saved.at) > PENDING_TTL_MS) return null;
    return {
      prompt: String(saved.prompt),
      flow: flowById(saved.flow) || FLOWS.director,
      opts: {
        seconds: saved.seconds ?? undefined, style: saved.style ?? undefined, writer: saved.writer ?? undefined,
        depth: saved.depth ?? undefined, specialists: Array.isArray(saved.specialists) ? saved.specialists : undefined,
      },
    };
  } catch {
    return null;
  }
}

export function SignInDialog({ flow = FLOWS.director, open, onOpenChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const callbackURL = `/?${RESUME_PARAM}=1`;
  const signIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      // The desktop app runs OAuth in its own window through /login; the
      // premise is already saved, so it resumes the same way.
      if (isDesktop) {
        window.location.assign(`/login?next=${encodeURIComponent(callbackURL)}`);
        return;
      }
      await authClient.signIn.social({ provider: "google", callbackURL });
    } catch (e) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm rounded-none border-[var(--br-secondary)]/40 bg-[var(--br-surface)] text-[var(--br-primary)]"
        style={{ ...HUD, fontFamily: BODY }}
      >
        <DialogTitle style={{ fontFamily: DISPLAY, letterSpacing: "0.04em" }} className="text-2xl font-bold uppercase">
          Sign in to make your story
        </DialogTitle>
        <DialogDescription className="text-[var(--br-secondary)]">
          Your premise is saved — it starts the moment you are back.
        </DialogDescription>
        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="mt-2 flex h-11 items-center justify-center gap-2 bg-[var(--br-tertiary)] font-semibold text-[var(--br-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-60"
          data-google-signin
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          Continue with Google
        </button>
        {err ? <p className="text-sm text-[var(--br-tertiary)]">{err}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

// ── Latest stories: under the box, a list in a modal ────────────────────────

/** The signed-in user's Films, newest first (user-scoped). */
export async function fetchMyFilms() {
  const { res, data } = await getJSON("/api/auto/films/mine");
  // A Worker without the list yet answers through `/films/:id` — "no such
  // Film" — which, from here, means there is nothing to list.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(data.error || `Couldn't read your stories (${res.status}).`);
  return data.films || [];
}

const FILM_STATUS = {
  done: "Done",
  running: "Being made",
  "awaiting-confirm": "Waiting on you",
  queued: "Queued",
  stopped: "Stopped",
  declined: "Declined",
  refused: "Refused",
};

// A premise can run to paragraphs: at most PREMISE_CHARS, cut on a word, then
// an ellipsis — and the row clamps it to four lines on top of that.
const PREMISE_CHARS = 240;
function clip(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= PREMISE_CHARS) return t;
  const cut = t.slice(0, PREMISE_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 180 ? cut.lastIndexOf(" ") : PREMISE_CHARS).trimEnd()}…`;
}

function when(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function LatestStories({ onPick }) {
  const [films, setFilms] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  // Read on open, so a story finished since the page loaded is listed.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    fetchMyFilms().then((f) => live && setFilms(f)).catch((e) => live && setError(String(e?.message || e)));
    return () => { live = false; };
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-mt-10 flex items-center gap-1.5 self-center border border-[var(--br-secondary)]/40 bg-black/50 px-3 py-1.5 text-sm text-[var(--br-secondary)] backdrop-blur-sm transition-colors hover:border-[var(--br-primary)]/60 hover:text-[var(--br-primary)]"
        aria-haspopup="dialog"
        data-latest-stories
      >
        Latest stories <ChevronDown size={14} aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex max-h-[80dvh] max-w-lg flex-col gap-3 rounded-none border border-[var(--br-secondary)]/40 bg-black/70 p-0 text-[var(--br-primary)] backdrop-blur-md"
          style={{ ...HUD, fontFamily: BODY }}
        >
          <div className="px-5 pt-5">
            <DialogTitle style={{ fontFamily: DISPLAY, letterSpacing: "0.04em" }} className="text-2xl font-bold uppercase">
              Latest stories
            </DialogTitle>
            <DialogDescription className="text-[var(--br-secondary)]">
              {films?.length ? "Pick one to open it." : "Everything you make shows up here."}
            </DialogDescription>
          </div>
          {error ? <p className="px-5 pb-5 text-sm text-[var(--br-tertiary)]">{error}</p> : null}
          {!error && films && !films.length ? (
            <p className="px-5 pb-5 text-sm text-[var(--br-secondary)]" data-latest-empty>No stories created yet.</p>
          ) : null}
          {!error && !films ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-[var(--br-secondary)]">
              <Loader2 size={14} className="animate-spin" /> Loading your stories…
            </p>
          ) : null}
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-latest-list>
            {(films || []).map((f) => (
              <li key={f.filmId}>
                <button
                  type="button"
                  onClick={() => { setOpen(false); onPick(f); }}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--br-neutral)]"
                >
                  <Film size={16} className="mt-0.5 shrink-0 text-[var(--br-secondary)]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{f.title || f.prompt || "Untitled story"}</span>
                    {f.prompt && f.title ? (
                      <span className="line-clamp-4 block text-sm text-[var(--br-secondary)]" data-latest-prompt>{clip(f.prompt)}</span>
                    ) : null}
                    <span className="mt-1 block text-xs text-[var(--br-secondary)]" style={{ fontFamily: MONO }}>
                      {[FILM_STATUS[f.status] || f.status, f.seconds ? formatLength(Math.round(f.seconds)) : null, when(f.createdAt)]
                        .filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Story view: 100dvh — prompt, steps, and the Film ────────────────────────

// A DONE Film never runs a stage it has no step for — one made before that
// stage existed (the Look) — so it is not drawn as one still ahead. A stopped
// Film keeps its steps ahead: Retry runs them.

function stepsOf(job) {
  const byKey = new Map((job.steps || []).map((s) => [s.key, s]));
  const all = stagesOf(job);
  const stages = job.status === "done" && byKey.size ? all.filter((st) => byKey.has(st.key)) : all;
  const known = stages.map((st) => {
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
    if (!all.some((st) => st.key === s.key)) {
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

/**
 * Retry a stopped Film from the step that stopped it
 * (POST /api/auto/films/:id/retry). → the running job; throws with the
 * worker's one-line reason when it refuses.
 */
export async function retryFilm(id) {
  const { res, data } = await getJSON(`/api/auto/films/${encodeURIComponent(id)}/retry`, { method: "POST" });
  if (!res.ok) throw new Error(data.message || data.error || `Couldn't retry the story (${res.status}).`);
  return data.job || null;
}

// A Film's media, addressed to ITS project. The page's fetch shim sends
// `x-project-id`, but a <video> element cannot send a header: without the
// project in the url the Worker resolves the user's ACTIVE project, where a
// Film's file (in a project of its own) is a 404 — and the player just spins.
export function filmMediaUrl(url, projectId) {
  if (!url || !projectId || /[?&]projectId=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}`;
}

// ── Share and download a finished Film ──────────────────────────────────────
//
// Share mints (or reads back) the Film's public link — /watch/<token>, which
// anyone can open with no account (routes/watch.jsx) — and can revoke it.
// Download saves the file itself. Both only for a Film with a video.

/** A download name from the Film's title (same rule as the Worker's). */
export function filmFileName(film) {
  const base = String(film?.title || "story").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 80);
  return `${base || "story"}.mp4`;
}

async function shareCall(filmId, method) {
  const { res, data } = await getJSON(`/api/auto/films/${encodeURIComponent(filmId)}/share`, { method });
  if (!res.ok) throw new Error(data.error || `Couldn't ${method === "DELETE" ? "stop sharing" : "share"} the story (${res.status}).`);
  return data;
}

const ACTION =
  "flex items-center gap-1.5 border border-[var(--br-secondary)]/40 px-3 py-1.5 text-[0.72rem] uppercase text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)] disabled:opacity-50";

export function FilmActions({ job, projectId }) {
  const [link, setLink] = useState(undefined); // undefined = not read; null = not shared
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(null);
  const url = link ? `${window.location.origin}${link}` : null;

  const run = async (method) => {
    setBusy(true);
    setErr(null);
    try {
      const data = await shareCall(job.id, method);
      setLink(data.path || null);
      return data.path || null;
    } catch (e) {
      setErr(String(e?.message || e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  // Opening the popover shares it: the author asked for a link, so there is one.
  const onOpen = async (open) => {
    if (!open || link) return;
    setCopied(false);
    await run("POST");
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setErr("Couldn't copy — select the link and copy it.");
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-2" data-film-actions>
      <Popover onOpenChange={onOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={ACTION} style={{ fontFamily: MONO, letterSpacing: "0.08em" }} data-share>
            <Share2 size={12} aria-hidden /> Share
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          className="w-[min(26rem,calc(100vw-2rem))] border-[var(--br-secondary)]/40 bg-[var(--br-surface)] p-3 text-[var(--br-primary)]"
          style={{ ...HUD, fontFamily: BODY }}
          data-share-panel
        >
          <p className="mb-2 text-sm">Anyone with this link can watch and download the story — no account needed.</p>
          {busy && !url ? (
            <p className="flex items-center gap-2 text-sm text-[var(--br-secondary)]">
              <Loader2 size={14} className="animate-spin" /> Making the link…
            </p>
          ) : null}
          {url ? (
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
                aria-label="Share link"
                className="min-w-0 flex-1 border border-[var(--br-secondary)]/40 bg-transparent px-2 py-1.5 text-xs text-[var(--br-primary)]"
                style={{ fontFamily: MONO }}
                data-share-url
              />
              <button type="button" onClick={copy} className={ACTION} style={{ fontFamily: MONO, letterSpacing: "0.08em" }} aria-label="Copy link">
                {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : null}
          {url ? (
            <button
              type="button"
              onClick={() => run("DELETE")}
              disabled={busy}
              className="mt-3 flex items-center gap-1.5 text-xs text-[var(--br-secondary)] transition-colors hover:text-[var(--br-tertiary)] disabled:opacity-50"
              data-unshare
            >
              <Link2Off size={12} aria-hidden /> Stop sharing — the link stops working
            </button>
          ) : null}
          {link === null && !busy ? (
            <button type="button" onClick={() => run("POST")} className={cn(ACTION, "mt-1")} style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
              <Share2 size={12} aria-hidden /> Make a new link
            </button>
          ) : null}
          {err ? <p className="mt-2 text-xs text-[var(--br-tertiary)]">{err}</p> : null}
        </PopoverContent>
      </Popover>
      <a
        href={filmMediaUrl(job.film.url, projectId || job.projectId)}
        download={filmFileName(job.film)}
        className={ACTION}
        style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
        data-download
      >
        <Download size={12} aria-hidden /> Download
      </a>
    </div>
  );
}

export function StoryView({ job, projectId = null, onNew, onRetry, retrying = false, retryError = null }) {
  const steps = stepsOf(job);
  const done = job.status === "done" && job.film?.url;
  const stopped = job.status === "stopped";
  // The step that stopped it — what "Retry from …" names.
  const failedLabel = stopped
    ? job.stopped?.label || job.steps?.find((s) => s.status === "failed")?.label || null
    : null;
  const waiting = job.status === "awaiting-confirm";
  const queued = job.status === "queued";
  // The chosen length; an older Film without one shows what its cue sheet planned.
  const length =
    job.seconds ||
    job.steps?.find((s) => s.key === "cuesheet" || (s.key === "shotlist" && job.engine === "seedance"))?.result?.seconds ||
    null;
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
          {length ? (
            <span
              className="shrink-0 text-[0.72rem] tabular-nums text-[var(--br-secondary)]"
              style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
              title="Length"
              data-length
            >
              {formatLength(length)}
            </span>
          ) : null}
          {stopped && onRetry && failedLabel ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="flex shrink-0 items-center gap-1.5 border border-[var(--br-secondary)]/40 px-3 py-1.5 text-[0.72rem] uppercase text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)] disabled:opacity-50"
              style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
              data-retry
            >
              <RotateCw size={12} className={cn(retrying && "animate-spin")} aria-hidden /> Retry from {failedLabel}
            </button>
          ) : null}
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
                src={filmMediaUrl(job.film.url, projectId || job.projectId)}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
                data-film
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-4 py-3 sm:px-8">
              <FilmActions job={job} projectId={projectId} />
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
                  {retryError || "This story couldn't be finished. It doesn't count against your allowance."}
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
