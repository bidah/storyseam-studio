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
  ArrowUp, AudioLines, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, Clapperboard, CircleAlert, Copy, Download, Film, Link2Off, Loader2, Mic, PenLine, Plus, RotateCw, Search, Settings2,
  Share2, SlidersHorizontal, Square, Users, X, icons as LUCIDE,
} from "lucide-react";
import { studioPath } from "@/lib/home";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_DEEP_SPECIALISTS, DEFAULT_FILM_RESOLUTION, DEFAULT_FILM_SCORE, DEFAULT_FILM_VOICES, FILM_DEFAULT_SECONDS, FILM_RESOLUTIONS, FILM_DEPTHS, FILM_STEPS, FILM_STYLES, FILM_VOICES, FILM_WRITERS, STORY_FLOW_DEFAULT_SECONDS,
  STORY_FLOW_STEPS, filmVoicesOf, formatLength, isStoryEngine, roomEstimate,
} from "@/lib/film-plan";
import { SPECIALISTS, STAGE_ORDER, isSpecialistId } from "@/lib/specialists";
import { useVoiceRecording, transcribeAudio, formatDuration } from "@/lib/useVoiceRecording";
import { authClient, useSession } from "@/lib/auth-client";
import { isDesktop } from "@/lib/desktop";
import { getProjectId, setProjectId } from "@/lib/projectFetch";
import { useProjectEvents } from "@/lib/useProjectEvents";
import { HUD, DISPLAY, DISPLAY_FIT, DISPLAY_TRACKING, BODY, MONO } from "@/lib/hudTheme";
import { HudHeader } from "@/components/HudHeader";
import { useTheme } from "@/lib/theme";
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

// Mirrors STORY_FLOW_STAGES (the Seedance 2.5 pipeline) the same way, with
// the Score the worker's stagesFor adds after the final cut — and the Voices
// stage it inserts after the sheets when the job carries `voices` (stagesOf).
const STORY_FLOW_STAGES = [
  { key: "look", label: "Look" },
  { key: "world", label: "Idea + World" },
  { key: "script", label: "Script" },
  { key: "sheets", label: "Character & location sheets" },
  { key: "shotlist", label: "Shot list" },
  { key: "prompts", label: "Segment prompts" },
  { key: "run", label: "Video run" },
  { key: "stitch", label: "Final cut" },
  { key: "score", label: "Score" },
];
// Mirrors H3_STAGES (the MiniMax H3 pipeline): the story flow's, on H3.
const H3_STAGES = STORY_FLOW_STAGES;

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
    blurb: "Takes of up to 30s, each extending the last, at 480p. Seedance writes the dialogue and effects, then scored; can be 1:00.",
  },
  h3: {
    id: "h3",
    path: "/",
    engine: "h3",
    steps: STORY_FLOW_STEPS,
    defaultSeconds: STORY_FLOW_DEFAULT_SECONDS,
    stages: H3_STAGES,
    storage: "h3-flow",
    label: "MiniMax H3",
    blurb: "The same story in 15s takes on MiniMax H3 (its own ceiling), each continuing the last (Video 1), at 480P. H3 writes the dialogue and effects, then scored; can be 1:00.",
  },
};
export const GEN_MODES = [FLOWS.h3, FLOWS.director, FLOWS.seedance];
/** A flow by its id (a stored or URL value) → the flow | null. */
export const flowById = (id) => (typeof id === "string" && Object.hasOwn(FLOWS, id) ? FLOWS[id] : null);
/** The flow a Film was made on, from its job's `engine`. */
export const flowOf = (engine) => flowById(engine) || FLOWS.director;

// The Gen mode is remembered per browser, like the look. A browser that never
// picked one starts on MiniMax H3.
const MODE_KEY = "director-story:mode";
export const DEFAULT_FLOW = FLOWS.h3;
export function readStoredFlow() {
  try {
    return flowById(window.localStorage.getItem(MODE_KEY)) || DEFAULT_FLOW;
  } catch {
    return DEFAULT_FLOW;
  }
}
export function storeFlow(flow) {
  try { window.localStorage.setItem(MODE_KEY, flow.id); } catch { /* private mode: not remembered */ }
}

// A Deep Film runs the writers' room after the Script (worker stagesFor).
const ROOM_STAGE = { key: "room", label: "Writers' room" };
// A story-engine Film with a Voices pass auditions its cast after the sheets
// (film-plan.ts › Voices); a job without `voices` — from before — runs none.
const VOICES_STAGE = { key: "voices", label: "Voices" };
export function stagesOf(job) {
  // A Film whose score was switched off has no Score stage (worker stagesFor).
  let base = flowOf(job?.engine).stages.filter((s) => job?.score !== false || s.key !== "score");
  if (filmVoicesOf(job?.voices, job?.engine)) {
    const at = base.findIndex((s) => s.key === "sheets") + 1;
    base = [...base.slice(0, at), VOICES_STAGE, ...base.slice(at)];
  }
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
  // Re-drawn when the theme flips: the dots and their ground are read once, at init.
  const theme = useTheme();
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
      const dot = cssColor("--primary", "#e8622c");
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
        backgroundColor: cssColor("--background", "#0b0c0e"),
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
  }, [theme]);
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
// What the video renders at (film-plan.ts FILM_RESOLUTIONS): 480p unless the
// author picks 720p, which both Gen modes take. Only a non-default is sent.
const RESOLUTION_KEY = "director-story:resolution";
function readStoredResolution() {
  try {
    const v = window.localStorage.getItem(RESOLUTION_KEY) || DEFAULT_FILM_RESOLUTION;
    return FILM_RESOLUTIONS.includes(v) ? v : DEFAULT_FILM_RESOLUTION;
  } catch {
    return DEFAULT_FILM_RESOLUTION;
  }
}
function storeResolution(resolution) {
  try { window.localStorage.setItem(RESOLUTION_KEY, resolution); } catch { /* private mode: not remembered */ }
}
// Whether the Film ends with the Score stage (film-plan.ts › The score): on
// unless the author switches it off. Only "off" is sent (`score: false`).
const SCORE_KEY = "director-story:score";
function readStoredScore() {
  try {
    return window.localStorage.getItem(SCORE_KEY) !== "off";
  } catch {
    return DEFAULT_FILM_SCORE;
  }
}
function storeScore(on) {
  try { window.localStorage.setItem(SCORE_KEY, on ? "on" : "off"); } catch { /* private mode: not remembered */ }
}
// The Voices pass a story-engine Film runs (film-plan.ts FILM_VOICES): every
// character auditioned once, on the Film's own video model, Seed Audio or
// ElevenLabs, and bound as a voice reference by every segment after. Sent only
// with a story engine — the Director cannot take a voice reference.
const VOICES_KEY = "director-story:voices";
function readStoredVoices() {
  try {
    const v = window.localStorage.getItem(VOICES_KEY) || DEFAULT_FILM_VOICES;
    return FILM_VOICES.some((x) => x.id === v) ? v : DEFAULT_FILM_VOICES;
  } catch {
    return DEFAULT_FILM_VOICES;
  }
}
function storeVoices(voices) {
  try { window.localStorage.setItem(VOICES_KEY, voices); } catch { /* private mode: not remembered */ }
}

const STYLE_CHOICES = [{ id: "", label: "Auto" }, ...FILM_STYLES.map((s) => ({ id: s.id, label: s.label }))];

function SettingsLabel({ id, children, hint }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
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

function StorySettings({ flow, seconds, onSeconds, resolution, onResolution, score, onScore, voices, onVoices, style, onStyle, writer, onWriter, disabled }) {
  const writers = useWriterChoices();
  // Only a story engine auditions its cast; the Director has no audio input.
  const storyFlow = isStoryEngine(flow.engine);
  const voice = FILM_VOICES.find((x) => x.id === voices) || FILM_VOICES[0];
  // A phone gets the whole screen: the popover grew wider than the viewport and
  // ran off its edge. Desktop keeps the popover beside the button.
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const trigger = (
    <button
      type="button"
      aria-label="Story settings"
      disabled={disabled}
      className="flex min-h-10 min-w-0 max-w-full items-center gap-1.5 px-2 text-left text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)] disabled:opacity-40 data-[state=open]:text-[var(--br-primary)]"
      data-story-settings
    >
      <Settings2 size={16} className="shrink-0" aria-hidden />
      {/* The look rides on the button too: it is remembered per browser, so
          what will be sent must be visible before sending — an unseen
          "Auto" once made a story the author meant as anime live action. */}
      <span className="text-[0.72rem] uppercase tabular-nums" style={{ fontFamily: MONO, letterSpacing: "0.08em" }} data-story-settings-summary>
        {formatLength(seconds)} · {resolution} · {FILM_STYLES.find((st) => st.id === style)?.label || "Auto look"}{score ? "" : " · no score"}{storyFlow ? ` · ${voice.label}` : ""}
      </span>
      <ChevronDown size={12} className="shrink-0" aria-hidden />
    </button>
  );
  const panel = (
    <>
      <SettingsLabel
        id="story-length-label"
        hint={seconds === flow.defaultSeconds ? "default" : `default ${formatLength(flow.defaultSeconds)}`}
      >
        Length
      </SettingsLabel>
      <div role="radiogroup" aria-labelledby="story-length-label" className="flex flex-wrap gap-y-1.5">
        {flow.steps.map((step) => (
          <Choice key={step} on={step === seconds} onClick={() => onSeconds(step)}>
            {formatLength(step)}
          </Choice>
        ))}
      </div>
      <div className="mt-4">
        <SettingsLabel
          id="story-resolution-label"
          hint={resolution === DEFAULT_FILM_RESOLUTION ? "default" : `default ${DEFAULT_FILM_RESOLUTION}`}
        >
          Resolution
        </SettingsLabel>
        <div role="radiogroup" aria-labelledby="story-resolution-label" className="flex flex-wrap gap-y-1.5" data-story-resolution>
          {FILM_RESOLUTIONS.map((r) => (
            <Choice key={r} on={r === resolution} onClick={() => onResolution(r)}>
              {r}
            </Choice>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <SettingsLabel id="story-score-label" hint={score ? "one continuous cue under the finished film" : "no music laid under it"}>
          Score
        </SettingsLabel>
        <div role="radiogroup" aria-labelledby="story-score-label" className="flex flex-wrap gap-y-1.5" data-story-score>
          <Choice on={score} onClick={() => onScore(true)}>On</Choice>
          <Choice on={!score} onClick={() => onScore(false)}>Off</Choice>
        </div>
      </div>
      {storyFlow ? (
        <div className="mt-4">
          <SettingsLabel id="story-voices-label" hint={voice.blurb}>
            Voices
          </SettingsLabel>
          <div role="radiogroup" aria-labelledby="story-voices-label" className="flex flex-wrap gap-y-1.5" data-story-voices>
            {FILM_VOICES.map((x) => (
              <Choice key={x.id} on={x.id === voices} onClick={() => onVoices(x.id)}>
                {x.label}
              </Choice>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-4">
        <SettingsLabel id="story-style-label">Look</SettingsLabel>
        <div role="radiogroup" aria-labelledby="story-style-label" className="flex flex-wrap gap-y-1.5" data-story-style>
          {STYLE_CHOICES.map((c) => (
            <Choice key={c.id || "auto"} on={c.id === style} onClick={() => onStyle(c.id)}>
              {c.label}
            </Choice>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <SettingsLabel id="story-model-label">Writing model</SettingsLabel>
        <div role="radiogroup" aria-labelledby="story-model-label" className="flex flex-wrap gap-y-1.5" data-story-writer>
          {writers.map((w) => (
            <Choice key={w.id} on={w.id === writer} onClick={() => onWriter(w.id)}>
              {w.label}
            </Choice>
          ))}
        </div>
      </div>
    </>
  );
  if (narrow) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent
          className="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto border-0 bg-[var(--br-surface)] p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] text-[var(--br-primary)] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:max-w-none"
          style={{ ...HUD, fontFamily: BODY }}
          data-story-settings-panel
        >
          <DialogTitle style={{ fontFamily: DISPLAY, letterSpacing: DISPLAY_TRACKING }} className="mb-5 pr-8 text-xl font-bold uppercase">
            Story settings
          </DialogTitle>
          <DialogDescription className="sr-only">Length, resolution, score, voices, look and writing model for the next story.</DialogDescription>
          {panel}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-auto w-full bg-[var(--br-tertiary)] px-3 py-3 text-[0.8rem] uppercase text-[var(--br-on-primary)] transition-opacity hover:opacity-90"
            style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
          >
            Done
          </button>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* Portaled out of the page, so it carries the page's tokens itself. */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-auto max-w-[calc(100vw-2rem)] border-[var(--br-secondary)]/40 bg-[var(--br-surface)] p-3 text-[var(--br-primary)]"
        style={{ ...HUD, fontFamily: BODY }}
        data-story-settings-panel
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}

// Below Tailwind's `sm` — a phone, where a popover has no room beside its button.
function useNarrow() {
  const query = "(max-width: 639px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
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
        <DialogTitle style={{ fontFamily: DISPLAY, letterSpacing: DISPLAY_TRACKING }} className="text-2xl font-bold uppercase">
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
            {est.passes} {est.passes === 1 ? "pass" : "passes"} · {est.label} wait
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
  // The button names the room's size only. Its wait time (roomEstimate) is
  // quoted in the popover and the dialog, where "wait" is spelled out — on the
  // input, next to the Film's length, "≈ 4 min" read as the story's runtime.
  const label = depth === "deep" ? `Deep · ${est.passes} ${est.passes === 1 ? "pass" : "passes"}` : "Fast";
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
              <div key={d.id} className="flex items-stretch transition-colors hover:bg-[var(--br-secondary)]/10">
                <button
                  type="button"
                  role="radio"
                  aria-checked={d.id === depth}
                  onClick={() => pick(d.id)}
                  className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
                >
                  <Check size={14} aria-hidden className={cn("mt-0.5 shrink-0", d.id === depth ? "opacity-100" : "opacity-0")} />
                  <span className="flex flex-col">
                    <span className="text-sm">{d.label}</span>
                    <span className="text-xs text-[var(--br-secondary)]">{d.blurb}</span>
                  </span>
                </button>
                {/* The room, browsable from the row itself: the same dialog as
                    "Choose the room" below, with each specialist's detail. The
                    room only runs on Deep, so opening it picks Deep. */}
                {d.id === "deep" ? (
                  <button
                    type="button"
                    aria-label="Browse the writers' room"
                    title="Browse the writers' room"
                    onClick={() => pick("deep")}
                    className="flex shrink-0 items-center px-2 text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)]"
                    data-story-room-browse
                  >
                    <Search size={14} aria-hidden />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {depth === "deep" ? (
            <button
              type="button"
              onClick={() => { setOpen(false); setRoomOpen(true); }}
              className="mt-1 flex w-full items-center gap-2 border-t border-[var(--br-secondary)]/20 px-2 py-2 text-left text-xs text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)]"
            >
              <Users size={14} aria-hidden />
              Choose the room — {est.passes} {est.passes === 1 ? "pass" : "passes"}, {est.label} wait
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

// The premise being typed survives a reload: saved on every keystroke, cleared
// once a story is actually made from it. One key for every mode — switching
// Gen mode is not a reason to lose what was written.
const DRAFT_KEY = "director-story:draft";

function readDraft() {
  try { return window.localStorage.getItem(DRAFT_KEY) || ""; } catch { return ""; }
}

/** Drop the typed premise — for a story started without going through the box. */
export function clearStoryDraft() {
  try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
}

function writeDraft(text) {
  try {
    if (text.trim()) window.localStorage.setItem(DRAFT_KEY, text);
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch { /* private mode: not remembered */ }
}

export function SimpleView({ flow = FLOWS.director, onFlow, onSubmit, submitting, note, running, below = null, after = null, onSignIn }) {
  const [prompt, setPrompt] = useState(readDraft);
  useEffect(() => { writeDraft(prompt); }, [prompt]);
  const [seconds, setSeconds] = useState(() => readStoredLength(flow));
  const [chosen, setChosen] = useState(() => hasStoredLength(flow));
  // Each mode remembers its own length (only Seedance offers 1:00).
  useEffect(() => {
    setSeconds(readStoredLength(flow));
    setChosen(hasStoredLength(flow));
  }, [flow]);
  const [style, setStyle] = useState(readStoredStyle);
  const [resolution, setResolution] = useState(readStoredResolution);
  const chooseResolution = (r) => {
    setResolution(r);
    storeResolution(r);
  };
  const [score, setScore] = useState(readStoredScore);
  const chooseScore = (on) => {
    setScore(on);
    storeScore(on);
  };
  const [voices, setVoices] = useState(readStoredVoices);
  const chooseVoices = (id) => {
    setVoices(id);
    storeVoices(id);
  };
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
      resolution: resolution !== DEFAULT_FILM_RESOLUTION ? resolution : undefined,
      score: score ? undefined : false,
      // The Voices pass, for a story engine only (the Director ignores it).
      voices: isStoryEngine(flow.engine) ? voices : undefined,
      writer: writer !== "default" ? writer : undefined,
      depth: depth === "deep" ? depth : undefined,
      specialists: depth === "deep" ? room : undefined,
    };
    if (await onSubmit(text, opts)) setPrompt("");
  };

  // On a phone the pickers leave the box for a card of their own under it, so
  // the box is the premise and its send button and nothing else.
  const narrow = useNarrow();
  const options = listening ? null : (
    <>
      {onFlow && <GenModePicker flow={flow} onFlow={onFlow} disabled={submitting} />}
      <DepthPicker depth={depth} onDepth={chooseDepth} room={room} onRoom={chooseRoom} disabled={submitting} />
      <StorySettings
        flow={flow} seconds={seconds} onSeconds={chooseSeconds} resolution={resolution} onResolution={chooseResolution}
        score={score} onScore={chooseScore}
        voices={voices} onVoices={chooseVoices}
        style={style} onStyle={chooseStyle}
        writer={writer} onWriter={chooseWriter} disabled={submitting}
      />
    </>
  );

  return (
    <Page className="relative px-4 animate-in fade-in duration-300 sm:px-8">
      <DotsBackground />
      {/* The same strip /login and /director-harness carry, so the three read
          as one site. Above the dots, and it bleeds into the gutters itself. */}
      <div className="relative z-20 mx-auto w-full max-w-7xl">
        <HudHeader onSignIn={onSignIn} />
      </div>
      <div className="relative z-10 flex flex-1 items-center justify-center py-12">
      {/* The column is the width the headline takes in Teko (one line, 22x its
          size, sized with the viewport so it never wraps) and the input fills
          it. Pinned rather than read off the headline, because the light
          theme's wider face sets the same line smaller (DISPLAY_FIT) and the
          box must not shrink with it. */}
      <main
        className="relative z-10 flex max-w-full flex-col items-stretch gap-8 text-center"
        style={{ width: "min(61.6rem, calc(100vw - 2rem))" }}
      >
        <h1
          className="whitespace-nowrap leading-none"
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            letterSpacing: DISPLAY_TRACKING,
            fontSize: `calc(min(2.8rem, calc((100vw - 2rem) / 22)) * ${DISPLAY_FIT})`,
          }}
        >
          TEXT TO LONG FORM VIDEO STORIES IN SECONDS
        </h1>
        <form onSubmit={submit} className="w-full">
          {/* The premise gets the box's full width; the controls sit in a row
              under it (sharing one row squeezed the text into a narrow column). */}
          <div className="flex flex-col gap-2 border border-[var(--br-secondary)]/40 bg-[var(--br-surface)] p-2 text-left focus-within:border-[var(--br-primary)]">
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
              className="min-h-34 w-full resize-none bg-transparent px-3 py-3 text-base leading-relaxed text-[var(--br-primary)] placeholder:text-[var(--br-secondary)] focus:outline-none disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {!narrow && options}
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
          </div>
          {narrow && options ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border border-[var(--br-secondary)]/40 bg-[var(--br-surface)] p-2" data-story-options>
              {options}
            </div>
          ) : null}
          {/* Latest stories sits right under the box (and its options), the
              box's own width — not floated off below the note. */}
          {below}
        </form>
        {/* The slow road, under the box: a named blank project and the
            studio's agent (StudioAgentCard). Its own form, so it sits outside. */}
        {after}
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
      </main>
      </div>
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
      seconds: opts.seconds ?? null, style: opts.style ?? null, writer: opts.writer ?? null, resolution: opts.resolution ?? null,
      score: opts.score ?? null,
      voices: opts.voices ?? null,
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
        resolution: saved.resolution ?? undefined,
        score: saved.score === false ? false : undefined,
        voices: saved.voices ?? undefined,
        depth: saved.depth ?? undefined, specialists: Array.isArray(saved.specialists) ? saved.specialists : undefined,
      },
    };
  } catch {
    return null;
  }
}

// `withPremise` is false when it opens from the header's sign-in icon: nothing
// was typed, so there is nothing to promise to resume.
export function SignInDialog({ flow = FLOWS.director, open, onOpenChange, withPremise = true }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const callbackURL = withPremise ? `/?${RESUME_PARAM}=1` : "/";
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
        <DialogTitle style={{ fontFamily: DISPLAY, letterSpacing: DISPLAY_TRACKING }} className="text-2xl font-bold uppercase">
          {withPremise ? "Sign in to make your story" : "Sign in to StorySeam"}
        </DialogTitle>
        <DialogDescription className="text-[var(--br-secondary)]">
          {withPremise
            ? "Your premise is saved — it starts the moment you are back."
            : "Pick up your stories where you left off, or start a new one."}
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

// ── The other way in: a blank project and the studio's agent ─────────────────
//
// The box above makes a whole Film in one go. This card is the slow road: a
// NEW, empty project (named here — the name is required, the same as the
// studio's own create form) opened at its studio root (`/p/<id>/`), where the
// UI and the agent build it step by step, World to Script and on. Signed out,
// the button opens the sign-in modal instead (`onSignIn`).
export function StudioAgentCard({ signedIn, onSignIn, onCreate }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e?.preventDefault();
    if (!signedIn) { onSignIn?.(); return; }
    const trimmed = name.trim();
    if (!trimmed) { setErr("Name the project first."); return; }
    setBusy(true);
    setErr(null);
    try {
      await onCreate(trimmed);
    } catch (e2) {
      setErr(String(e2?.message || e2));
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className="grid w-full grid-cols-1 items-center gap-4 border border-[var(--br-secondary)]/40 bg-[var(--br-surface)]/50 p-2 text-left backdrop-blur-sm sm:grid-cols-3"
      data-studio-agent
    >
      {/* Two halves: what this road is on the left, the name and the launch
          on the right, 2/3 to 1/3, sat at the bottom right. Stacked on a phone.
          The prompt box's padding: p-2 on the card (so the button sits 8px
          from the border, like the send button), px-3 py-3 on the text. */}
      <div className="flex flex-col gap-1 px-3 py-3 sm:col-span-2">
        <h2 className="text-base font-semibold text-[var(--br-primary)]">Create a story with the studio agent</h2>
        <p className="text-sm text-[var(--br-secondary)]">
          From the World and script to the characters and the final video generation, each step made carefully,
          with time by you with an agent and also with UI options.
        </p>
      </div>
      <div className="flex flex-col gap-1.5 sm:self-end">
        <div className="flex justify-end gap-2">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (err) setErr(null); }}
            placeholder="New project name"
            aria-label="New project name"
            required={signedIn}
            disabled={busy}
            className="h-10 min-w-0 flex-1 border border-[var(--br-secondary)]/40 bg-[var(--br-surface)] px-3 text-sm text-[var(--br-primary)] placeholder:text-[var(--br-secondary)] focus:border-[var(--br-primary)] focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || (signedIn && !name.trim())}
            className="flex h-10 shrink-0 items-center justify-center gap-1.5 bg-[var(--br-tertiary)] px-4 text-sm font-semibold text-[var(--br-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Launch agent
          </button>
        </div>
        {err ? <p className="text-xs text-[var(--br-tertiary)]" role="alert">{err}</p> : null}
      </div>
    </form>
  );
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
        className="mt-2 flex w-full items-center justify-center gap-1.5 border border-[var(--br-secondary)]/40 bg-[var(--br-surface)]/50 px-3 py-[11px] text-sm text-[var(--br-secondary)] backdrop-blur-sm transition-colors hover:border-[var(--br-primary)]/60 hover:text-[var(--br-primary)]"
        aria-haspopup="dialog"
        data-latest-stories
      >
        Latest stories <ChevronDown size={14} aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex max-h-[80dvh] max-w-lg flex-col gap-3 rounded-none border border-[var(--br-secondary)]/40 bg-[var(--br-surface)]/70 p-0 text-[var(--br-primary)] backdrop-blur-md max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:border-0 max-sm:bg-[var(--br-surface)] max-sm:pb-[env(safe-area-inset-bottom)] max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:zoom-in-100"
          style={{ ...HUD, fontFamily: BODY }}
        >
          {/* A phone gets the whole screen: the list is the point of it. */}
          <div className="px-5 pt-5 pr-12 max-sm:pt-[max(1.25rem,env(safe-area-inset-top))]">
            <DialogTitle style={{ fontFamily: DISPLAY, letterSpacing: DISPLAY_TRACKING }} className="text-2xl font-bold uppercase">
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
      // A done step opens its result in a dialog (StepResultDialog).
      ...(s?.status === "done" ? { result: s.result || null } : {}),
    };
  });
  // A stage the worker added later than this list: show it rather than drop it.
  for (const s of job.steps || []) {
    if (!all.some((st) => st.key === s.key)) {
      known.push({ key: s.key, label: s.label, status: s.status, summary: s.summary || null, ...(s.status === "done" ? { result: s.result || null } : {}) });
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
// A finished Film's actions: a compact row in the header, right of the prompt.
const ROW_ACTION = cn(ACTION, "shrink-0");
// The Film's width on the page: a 16:9 box no taller than 70% of the viewport.
// The prompt card above it is capped to the same width so the two line up.
const FILM_W = "max-w-[calc(70dvh*16/9)]";

export function FilmActions({ job, projectId, children = null }) {
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
    <div className="flex flex-wrap items-center justify-end gap-2" data-film-actions>
      <Popover onOpenChange={onOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={ROW_ACTION} style={{ fontFamily: MONO, letterSpacing: "0.08em" }} data-share>
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
        className={ROW_ACTION}
        style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
        data-download
      >
        <Download size={12} aria-hidden /> Download
      </a>
      {children}
    </div>
  );
}

// The Voices step's auditions, under its card: the lines every character
// read, then one player per voice (film-plan.ts › Voices). Audio is addressed
// to the Film's project like the Film itself (filmMediaUrl).
function VoicesCard({ result, projectId }) {
  const voices = (result?.voices || []).filter((v) => v?.url);
  if (!voices.length) return null;
  return (
    <div className="mt-2 space-y-2" data-voices>
      {result.lines ? (
        <p className="text-xs italic text-[var(--br-secondary)]" data-voices-lines>
          “{result.lines}”
        </p>
      ) : null}
      <ul className="space-y-2">
        {voices.map((v) => (
          <li key={v.name} className="flex items-center gap-2" data-voice={v.name}>
            <AudioLines size={14} className="shrink-0 text-[var(--br-secondary)]" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-[var(--br-primary)]/90">{v.name}</span>
              {v.note ? <span className="block truncate text-[0.7rem] text-[var(--br-secondary)]" title={v.note}>{v.note}</span> : null}
            </span>
            <audio controls preload="none" src={filmMediaUrl(v.url, projectId)} className="h-8 w-40 shrink-0" aria-label={`${v.name}'s audition`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// A Film-page dialog: the whole screen on a phone (a card there is a strip of
// text between two bands of page), a centered card from `sm` up.
const PAGE_DIALOG =
  "h-[100dvh] max-h-[100dvh] max-w-full content-start overflow-y-auto rounded-none border-0 bg-[var(--br-surface)] text-[var(--br-primary)] " +
  "sm:h-auto sm:max-h-[85dvh] sm:max-w-xl sm:border sm:border-[var(--br-secondary)]/40 " +
  // The close button, as a square with a visible gray border rather than a
  // faint bare X (dialog.jsx's default, which the rest of the app keeps).
  "[&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-9 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center " +
  "[&>[data-slot=dialog-close]]:top-3 [&>[data-slot=dialog-close]]:right-3 [&>[data-slot=dialog-close]]:border [&>[data-slot=dialog-close]]:border-[var(--br-secondary)]/70 " +
  "[&>[data-slot=dialog-close]]:bg-black/40! [&>[data-slot=dialog-close]]:text-[var(--br-primary)]! [&>[data-slot=dialog-close]]:opacity-100 " +
  "[&>[data-slot=dialog-close]:hover]:border-[var(--br-primary)] [&>[data-slot=dialog-close]_svg]:size-4";

/** A saved draft's screenplay, read on demand (GET /api/script/drafts/:id). */
function Screenplay({ draftId }) {
  const [state, setState] = useState({ loading: true, draft: null, error: null });
  useEffect(() => {
    if (!draftId) return;
    let live = true;
    setState({ loading: true, draft: null, error: null });
    fetch(`/api/script/drafts/${encodeURIComponent(draftId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Couldn't load the script (${res.status}).`);
        return data;
      })
      .then((draft) => { if (live) setState({ loading: false, draft, error: null }); })
      .catch((e) => { if (live) setState({ loading: false, draft: null, error: String(e?.message || e) }); });
    return () => { live = false; };
  }, [draftId]);
  if (!draftId) return null;
  if (state.loading) return <p className="flex items-center gap-2 text-xs text-[var(--br-secondary)]"><Loader2 size={12} className="animate-spin" aria-hidden /> Loading the script…</p>;
  if (state.error) return <p className="text-xs text-[var(--br-tertiary)]">{state.error}</p>;
  const els = state.draft?.elements || [];
  return (
    <div className="space-y-2 border border-[var(--br-secondary)]/25 bg-[var(--br-surface)]/30 px-4 py-4 text-[0.82rem] leading-relaxed" style={{ fontFamily: MONO }} data-screenplay>
      {els.map((el, i) => {
        switch (el.type) {
          case "scene_heading":
            return <p key={i} className={cn("font-bold uppercase text-[var(--br-primary)]", i > 0 && "pt-3")}>{el.text}</p>;
          case "character":
            return <p key={i} className="pt-1 text-center uppercase text-[var(--br-primary)]">{el.text}</p>;
          case "parenthetical":
            return <p key={i} className="-mt-2 text-center text-[var(--br-secondary)]">{el.text}</p>;
          case "dialogue":
            return <p key={i} className="-mt-2 mx-auto max-w-[80%] text-[var(--br-primary)]/90">{el.text}</p>;
          case "transition":
            return <p key={i} className="text-right uppercase text-[var(--br-secondary)]">{el.text}</p>;
          default:
            return <p key={i} className="text-[var(--br-primary)]/80">{el.text}</p>;
        }
      })}
    </div>
  );
}

/** Label: value rows, skipping the empty ones. */
function Fields({ rows }) {
  const shown = rows.filter(([, v]) => typeof v === "string" && v.trim());
  if (!shown.length) return null;
  return (
    <dl className="space-y-1.5">
      {shown.map(([k, v]) => (
        <div key={k} className="text-sm leading-snug">
          <dt className="inline text-[var(--br-secondary)]">{k}: </dt>
          <dd className="inline text-[var(--br-primary)]/90">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One character, place or prop: its sheet (when linked), name, and every field it has. */
function EntryCard({ image, name, sub, rows, projectId }) {
  const src = image ? filmMediaUrl(image, projectId) : null;
  return (
    <li className="flex gap-3 border border-[var(--br-secondary)]/25 bg-[var(--br-surface)]/20 p-3">
      {src ? (
        <a href={src} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={src} alt={name} loading="lazy" className="size-16 border border-[var(--br-secondary)]/30 object-cover" />
        </a>
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-base text-[var(--br-primary)]">
          {name}
          {sub ? <span className="text-xs text-[var(--br-secondary)]"> · {sub}</span> : null}
        </p>
        <Fields rows={rows} />
      </div>
    </li>
  );
}

/**
 * The Idea + World step: the Film's WHOLE World (GET /api/world — the Film
 * page is scoped to the Film's project), every character with all of its
 * fields, the places and props in full, and the story's map. While it loads,
 * or if it can't, the step's own summary stands in.
 */
function WorldDetails({ result, projectId }) {
  const [world, setWorld] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    fetch("/api/world")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Couldn't load the World (${res.status}).`);
        return data;
      })
      .then((w) => { if (live) setWorld(w); })
      .catch((e) => { if (live) setError(String(e?.message || e)); });
    return () => { live = false; };
  }, []);
  const w = world || {};
  const characters = w.charactersLibrary || w.characters || result.characters || [];
  const places = w.locations || result.places || [];
  const props = w.props || result.props || [];
  const map = w.map || {};
  const depth = w.depth || {};
  return (
    <div className="space-y-5" data-world-details>
      {!world && !error ? (
        <p className="flex items-center gap-2 text-xs text-[var(--br-secondary)]"><Loader2 size={12} className="animate-spin" aria-hidden /> Loading the World…</p>
      ) : null}
      {error ? <p className="text-xs text-[var(--br-tertiary)]">{error}</p> : null}
      <div className="space-y-2">
        {(w.title || result.title) ? <p className="text-base text-[var(--br-primary)]">{w.title || result.title}</p> : null}
        {(w.logline || result.logline) ? <p className="text-sm italic text-[var(--br-secondary)]">{w.logline || result.logline}</p> : null}
        {result.idea ? <Fields rows={[["Idea", result.idea]]} /> : null}
      </div>
      <Fields rows={[["World", map.world], ["Protagonist", map.protagonist], ["Antagonist", map.antagonist], ["Stakes", map.stakes], ["Theme", map.theme]]} />
      <Fields rows={[["Premise", depth.premise], ["Want vs need", depth.wantVsNeed], ["Conflict", depth.conflict], ["Obstacles", depth.obstacles], ["Structure", depth.structure]]} />
      {characters.length ? (
        <div>
          <PreviewLabel>Characters</PreviewLabel>
          <ul className="space-y-2">
            {characters.map((c, i) => (
              <EntryCard
                key={c.id || `${c.name}-${i}`}
                image={c.sheetImage || c.miniatureImage}
                name={c.name}
                sub={c.archetype}
                projectId={projectId}
                rows={[["Role", c.role], ["Wants", c.want], ["Needs", c.need], ["Traits", c.traits], ["Arc", c.arc], ["Voice", c.voice], ["Looks", c.appearance]]}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {places.length ? (
        <div>
          <PreviewLabel>Places</PreviewLabel>
          <ul className="space-y-2">
            {places.map((l, i) => (
              <EntryCard key={l.id || `${l.name}-${i}`} image={l.sheetImage} name={l.name} projectId={projectId} rows={[["", l.description]].map(([, v]) => ["About", v])} />
            ))}
          </ul>
        </div>
      ) : null}
      {props.length ? (
        <div>
          <PreviewLabel>Props</PreviewLabel>
          <ul className="space-y-2">
            {props.map((x, i) => (
              <EntryCard key={x.id || `${x.name}-${i}`} image={x.sheetImage} name={x.name} sub={x.owner ? `${x.owner}'s` : null} projectId={projectId} rows={[["About", x.description]]} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── What each step came back with ───────────────────────────────────────────
//
// A done step is a button: tapping it opens its result in a dialog over the
// page — the cast and places the World wrote, the script's beats, the room's
// notes, the sheets as thumbnails, the voices to play, the shot list's
// segments, the frames and clips. Only what the step's `result` already
// carries is shown; nothing is fetched. A step with nothing to show keeps its
// summary line as its whole preview.

const PreviewLabel = ({ children }) => (
  <p className="mb-1.5 text-[0.68rem] uppercase text-[var(--br-secondary)]" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
    {children}
  </p>
);

function Thumbs({ items, projectId }) {
  const shown = items.filter((x) => x?.imageUrl);
  const [at, setAt] = useState(null);
  if (!shown.length) return null;
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-thumbs>
        {shown.map((x, i) => (
          <li key={`${x.name}-${i}`} className="min-w-0">
            <button type="button" onClick={() => setAt(i)} className="block w-full" aria-label={`Open ${x.caption || x.name || "image"}`}>
              <img src={filmMediaUrl(x.imageUrl, projectId)} alt={x.name || ""} loading="lazy" className="aspect-square w-full border border-[var(--br-secondary)]/30 bg-black/40 object-cover transition-opacity hover:opacity-80" />
            </button>
            <span className="mt-1 block truncate text-[0.7rem] text-[var(--br-secondary)]">{x.caption || x.name}</span>
          </li>
        ))}
      </ul>
      <Lightbox items={shown} at={at} onAt={setAt} projectId={projectId} />
    </>
  );
}

/**
 * One image at a time, over the dialog that opened it: swipe on a phone, the
 * chevrons or the arrow keys on a desktop. `at` null is closed.
 */
function Lightbox({ items, at, onAt, projectId }) {
  const open = at != null && !!items[at];
  const n = items.length;
  const go = (d) => onAt((i) => (i == null ? i : (i + d + n) % n));
  const touch = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = open ? items[at] : null;
  const arrow = "absolute top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center border border-[var(--br-secondary)]/70 bg-black/60 text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)] sm:flex";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onAt(null); }}>
      <DialogContent
        className={cn(PAGE_DIALOG, "flex flex-col gap-3 bg-black sm:max-w-4xl")}
        style={{ ...HUD, fontFamily: BODY }}
        data-lightbox
        onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const x0 = touch.current;
          touch.current = null;
          const x1 = e.changedTouches[0]?.clientX;
          if (x0 == null || x1 == null || Math.abs(x1 - x0) < 40) return;
          go(x1 < x0 ? 1 : -1);
        }}
      >
        <DialogTitle className="pr-12 text-sm font-normal text-[var(--br-primary)]">
          {item?.caption || item?.name || "Image"}
          <span className="ml-2 text-xs text-[var(--br-secondary)]" style={{ fontFamily: MONO }}>{open ? `${at + 1} / ${n}` : ""}</span>
        </DialogTitle>
        <DialogDescription className="sr-only">Swipe, or use the arrow keys, to move between images.</DialogDescription>
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {n > 1 ? (
            <button type="button" onClick={() => go(-1)} className={cn(arrow, "left-2")} aria-label="Previous image">
              <ChevronLeft size={18} aria-hidden />
            </button>
          ) : null}
          {item ? (
            <img
              key={item.imageUrl}
              src={filmMediaUrl(item.imageUrl, projectId)}
              alt={item.name || ""}
              className="max-h-[80dvh] max-w-full select-none object-contain"
              draggable={false}
            />
          ) : null}
          {n > 1 ? (
            <button type="button" onClick={() => go(1)} className={cn(arrow, "right-2")} aria-label="Next image">
              <ChevronRight size={18} aria-hidden />
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NameList({ items, clamp = false }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((x, i) => (
        <li key={`${x.name}-${i}`} className={cn("text-sm leading-snug", clamp && "line-clamp-3")}>
          <span className="text-[var(--br-primary)]">{x.name}</span>
          {x.detail ? <span className="text-[var(--br-secondary)]"> — {x.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

const sheetCaption = (x) => String(x.subject || x.name || "").replace(/\s+—\s+.*$/, "");

function StepResultBody({ step, projectId }) {
  const r = step.result || {};
  const media = (u) => filmMediaUrl(u, projectId);
  switch (step.key) {
    case "look": {
      const style = FILM_STYLES.find((x) => x.id === r.style);
      return <p className="text-sm">{style?.label || r.style || "—"}{r.by ? <span className="text-[var(--br-secondary)]"> · {r.by}</span> : null}</p>;
    }
    case "world":
      return <WorldDetails result={r} projectId={projectId} />;
    case "script":
      return (
        <div className="space-y-4">
          {r.title ? <p className="text-base text-[var(--br-primary)]">{r.title}</p> : null}
          {r.logline ? <p className="text-sm italic text-[var(--br-secondary)]">{r.logline}</p> : null}
          <p className="text-xs text-[var(--br-secondary)]" style={{ fontFamily: MONO }}>
            {[r.arc, r.scenes != null && `${r.scenes} scenes`, r.words != null && `${r.words} words`, r.dialogueWords != null && `${r.dialogueWords} of dialogue`].filter(Boolean).join(" · ")}
          </p>
          {r.draftId ? (<div><PreviewLabel>The script · {r.draftName || "draft"}</PreviewLabel><Screenplay draftId={r.draftId} /></div>) : null}
          {r.beats?.length ? (<div><PreviewLabel>Beats</PreviewLabel><NameList items={r.beats.map((b) => ({ name: b.name, detail: b.what }))} /></div>) : null}
          {r.outline?.length ? (
            <div>
              <PreviewLabel>The outline</PreviewLabel>
              <NameList items={r.outline.map((s) => ({ name: `${s.scene}. ${s.place || "—"}`, detail: [s.opens && s.closes && `${s.opens} → ${s.closes}`, s.turn].filter(Boolean).join(" — ") }))} />
            </div>
          ) : null}
          {(r.revisions || []).map((rv) => (
            <div key={rv.pass}>
              <PreviewLabel>{rv.pass === "revise-2" ? "Second revision" : "Revision"}{rv.draftName ? ` · ${rv.draftName}` : ""}</PreviewLabel>
              {rv.review?.length ? (
                <ul className="list-disc space-y-1 pl-4 text-xs text-[var(--br-secondary)]">{rv.review.map((x, i) => <li key={i}>{x.where ? `${x.where} — ` : ""}{x.issue}</li>)}</ul>
              ) : null}
              {rv.changes?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--br-primary)]/85">{rv.changes.map((x, i) => <li key={i}>{x}</li>)}</ul>
              ) : null}
            </div>
          ))}
          {r.issues?.length ? (
            <div><PreviewLabel>Still measured</PreviewLabel><ul className="list-disc space-y-1 pl-4 text-xs text-[var(--br-secondary)]">{r.issues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          ) : null}
        </div>
      );
    case "room": {
      const rounds = Array.isArray(r.rounds) && r.rounds.length ? r.rounds : null;
      const specialists = r.specialists || [];
      const byId = new Map(specialists.map((x) => [x.id, x]));
      const reader = (x) => (
        <li key={x.id} className="text-sm leading-snug">
          <span className="text-[var(--br-primary)]">{x.chip || x.label}</span>
          {x.findings != null ? <span className="text-[var(--br-secondary)]"> · {x.findings} notes</span> : null}
          {x.summary ? <span className="block text-xs text-[var(--br-secondary)]">{x.summary}</span> : null}
        </li>
      );
      const changes = (list) => list?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--br-primary)]/85">{list.map((c, i) => <li key={i}>{c}</li>)}</ul>
      ) : null;
      const finalDraft = r.rewrite?.draftId ? (
        <div><PreviewLabel>The script after the room · {r.rewrite.draftName}</PreviewLabel><Screenplay draftId={r.rewrite.draftId} /></div>
      ) : null;
      return rounds ? (
        <div className="space-y-5">
          {finalDraft}
          {rounds.map((rd) => (
            <div key={rd.round}>
              <PreviewLabel>Round {rd.round} · {rd.stage}</PreviewLabel>
              <ul className="space-y-2">{rd.specialists.map((id) => byId.get(id)).filter(Boolean).map(reader)}</ul>
              {rd.rewrite ? (<div className="mt-2"><p className="text-xs text-[var(--br-secondary)]">Rewritten as “{rd.rewrite.draftName}”</p>{changes(rd.rewrite.changes)}</div>) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-2">{specialists.map(reader)}</ul>
          {r.rewrite ? (<div><PreviewLabel>Rewrite · {r.rewrite.draftName}</PreviewLabel>{changes(r.rewrite.changes)}</div>) : null}
          {finalDraft}
        </div>
      );
    }
    case "sheets": {
      const items = (r.refs || r.sheets || []).map((x) => ({ ...x, caption: sheetCaption(x) }));
      const style = r.style?.imageUrl ? [{ name: r.style.name || "House style", imageUrl: r.style.imageUrl }] : [];
      const group = (kind) => items.filter((x) => x.kind === kind);
      const other = items.filter((x) => !["character", "location", "prop"].includes(x.kind));
      return (
        <div className="space-y-4">
          {group("character").length ? (<div><PreviewLabel>Characters</PreviewLabel><Thumbs items={group("character")} projectId={projectId} /></div>) : null}
          {group("location").length ? (<div><PreviewLabel>Places</PreviewLabel><Thumbs items={group("location")} projectId={projectId} /></div>) : null}
          {group("prop").length ? (<div><PreviewLabel>Props</PreviewLabel><Thumbs items={group("prop")} projectId={projectId} /></div>) : null}
          {[...style, ...other].length ? (<div><PreviewLabel>Style</PreviewLabel><Thumbs items={[...style, ...other]} projectId={projectId} /></div>) : null}
        </div>
      );
    }
    case "voices":
      return <VoicesCard result={r} projectId={projectId} />;
    case "shotlist":
    case "prompts":
      if (Array.isArray(r.segments) && r.segments.length) {
        return (
          <ol className="space-y-3">
            {r.segments.map((g) => (
              <li key={g.index} className="text-sm leading-snug">
                <span className="text-[var(--br-primary)]">{g.index + 1}. {g.title}</span>
                <span className="text-xs text-[var(--br-secondary)]" style={{ fontFamily: MONO }}> · {g.dur}s</span>
                {g.location ? <span className="block text-xs text-[var(--br-secondary)]">{g.location}{g.characters?.length ? ` · ${g.characters.join(", ")}` : ""}</span> : null}
                {g.goal ? <span className="block text-xs text-[var(--br-primary)]/80">{g.goal}</span> : null}
                {g.imageRefs?.length ? <span className="block text-xs text-[var(--br-secondary)]">{g.imageRefs.map((x) => x.name).join(" · ")}</span> : null}
              </li>
            ))}
          </ol>
        );
      }
      return (
        <div className="space-y-3">
          <p className="text-sm">{[r.count != null && `${r.count} shots`, r.seconds && formatLength(r.seconds)].filter(Boolean).join(" · ") || "—"}</p>
          {r.music?.length ? (<div><PreviewLabel>Music cues</PreviewLabel><NameList items={r.music.map((m) => ({ name: m.cue || m.name || "cue", detail: m.note }))} /></div>) : null}
        </div>
      );
    case "cuesheet":
    {
      const count = (v) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : null);
      const pins = count(r.pins), reels = count(r.reels);
      return <p className="text-sm">{[r.beats != null && `${r.beats} beats`, pins != null && `${pins} pins`, reels != null && `${reels} reel${reels === 1 ? "" : "s"}`, r.length].filter(Boolean).join(" · ") || "—"}</p>;
    }
    case "stills":
      return <Thumbs items={(r.frames || []).map((f) => ({ name: `${f.offset}s`, imageUrl: f.imageUrl, caption: `${f.offset}s${f.kind === "opening" ? " · first frame" : ""}` }))} projectId={projectId} />;
    case "run":
      if (Array.isArray(r.segments)) {
        return (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {r.segments.filter((g) => g.url).map((g) => (
              <li key={g.index} className="min-w-0">
                <video controls preload="metadata" playsInline src={media(g.url)} className="aspect-video w-full bg-black" />
                <span className="mt-1 block truncate text-[0.7rem] text-[var(--br-secondary)]">{g.index + 1}. {g.title}</span>
              </li>
            ))}
          </ul>
        );
      }
      return null;
    case "stitch":
    case "score":
    case "sitting": {
      const url = r.url || r.scored?.url || r.film?.url || r.unscored?.url;
      return url ? <video controls preload="metadata" playsInline src={media(url)} className="aspect-video w-full bg-black" /> : null;
    }
    default:
      return null;
  }
}

/** A step row's text: a button when there is a result to open, plain otherwise. */
function StepBody({ step, onOpen, children }) {
  if (!onOpen) return <span className="min-w-0 flex-1">{children}</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Show what ${step.label} came back with`}
      className="-mx-2 -my-1 min-w-0 flex-1 rounded-none px-2 py-1 text-left transition-colors hover:bg-[var(--br-primary)]/5 focus-visible:bg-[var(--br-primary)]/5 focus-visible:outline-none"
      data-step-open={step.key}
    >
      {children}
    </button>
  );
}

function StepResultDialog({ step, projectId, onClose }) {
  return (
    <Dialog open={!!step} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className={PAGE_DIALOG}
        style={{ ...HUD, fontFamily: BODY }}
        data-step-result={step?.key}
      >
        <DialogTitle style={{ fontFamily: DISPLAY, letterSpacing: DISPLAY_TRACKING }} className="text-xl font-bold uppercase">
          {step?.label}
        </DialogTitle>
        <DialogDescription className="text-xs text-[var(--br-secondary)]">{step?.summary}</DialogDescription>
        {step ? <StepResultBody step={step} projectId={projectId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// What a finished Film was made WITH — the settings its job carries, read
// back as the input names them (Gen mode, Writer, Fast · Deep, the gear's
// length / resolution / look / voices / score), plus what it came to.
const dollars = (n) => (typeof n === "number" && Number.isFinite(n) ? `$${n.toFixed(2)}` : null);
const specialistName = (id) => {
  const label = SPECIALISTS.find((s) => s.id === id)?.label || id;
  const bare = String(label).replace(/^the /i, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
};
function tookFor(job) {
  const ms = Date.parse(job.updatedAt) - Date.parse(job.createdAt);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.round(ms / 60000);
  return min < 60 ? `${Math.max(1, min)} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function FilmDetails({ job }) {
  const writers = useWriterChoices();
  const story = isStoryEngine(job.engine);
  const flow = FLOWS[job.engine] || FLOWS.director;
  const seconds = job.film?.seconds || job.seconds || null;
  const lookId = job.steps?.find((s) => s.key === "look")?.result?.style || job.style;
  const look = FILM_STYLES.find((s) => s.id === lookId);
  const writer = writers.find((w) => w.id === (job.writer || "default"));
  const deep = job.depth === "deep";
  const room = deep ? (job.specialists?.length ? job.specialists : DEFAULT_DEEP_SPECIALISTS) : [];
  const voices = story ? FILM_VOICES.find((v) => v.id === filmVoicesOf(job.voices, job.engine)) : null;
  const segments = story ? job.steps?.find((s) => s.key === "shotlist")?.result?.durations : null;
  const rows = [
    ["Model", flow.label],
    ["Length", seconds ? formatLength(Math.round(seconds)) : null],
    ["Resolution", job.resolution || DEFAULT_FILM_RESOLUTION],
    ["Segments", segments?.length ? `${segments.length} × ${[...new Set(segments)].map((d) => `${d}s`).join(" / ")}` : null],
    ["Look", look?.label || null],
    ["Writer", writer?.label || null],
    ["Story", deep ? `Deep · ${room.length} ${room.length === 1 ? "pass" : "passes"}` : "Fast"],
    ["Voices", story ? voices?.label || "None" : null],
    ["Score", job.score === false ? "Off" : "On"],
    ["Cost", dollars(job.spent)],
    ["Made in", tookFor(job)],
  ].filter(([, v]) => v);

  return (
    <section
      className={cn("w-full border border-[var(--br-secondary)]/30 bg-[var(--br-surface)] px-4 py-3", FILM_W)}
      aria-label="How this story was made"
      data-film-details
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-6">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0" data-detail={k.toLowerCase().replace(/\s+/g, "-")}>
            <dt className="text-[0.65rem] uppercase text-[var(--br-secondary)]" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
              {k}
            </dt>
            <dd className="truncate text-sm text-[var(--br-primary)]" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
      {deep && room.length ? (
        <p className="mt-2 border-t border-[var(--br-secondary)]/20 pt-2 text-xs text-[var(--br-secondary)]" data-detail="room">
          Writers' room: {room.map(specialistName).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

export function StoryView({ job, projectId = null, onRetry, retrying = false, retryError = null }) {
  const steps = stepsOf(job);
  const done = job.status === "done" && job.film?.url;
  const stopped = job.status === "stopped";
  // The step that stopped it — what "Retry from …" names.
  const failedLabel = stopped
    ? job.stopped?.label || job.steps?.find((s) => s.status === "failed")?.label || null
    : null;
  const waiting = job.status === "awaiting-confirm";
  const queued = job.status === "queued";
  // On a phone the prompt is two lines; tapping it opens the whole of it.
  const [promptOpen, setPromptOpen] = useState(false);
  // The done step whose result is open in its dialog.
  const [openStep, setOpenStep] = useState(null);
  // The chosen length; an older Film without one shows what its cue sheet planned.
  const length =
    job.seconds ||
    job.steps?.find((s) => s.key === "cuesheet" || (s.key === "shotlist" && isStoryEngine(job.engine)))?.result?.seconds ||
    null;
  // Ended without a Film worth showing: one line says why.
  const ended =
    job.status === "declined"
      ? "This story was declined before anything was made."
      : job.status === "refused"
        ? `This story couldn't start${job.error ? `: ${job.error}` : "."}`
        : null;

  return (
    // A finished Film's page scrolls as ONE page (video, details, actions, steps);
    // a running one keeps its own height and scrolls the step list inside it.
    <Page className={cn("animate-in fade-in zoom-in-[0.98] duration-500", done ? "min-h-dvh" : "h-dvh min-h-0 overflow-hidden")}>
      <div className={cn("flex flex-col", done ? "min-h-dvh" : "h-dvh")} data-story-view data-status={job.status}>
        {/* The header strip: the wordmark on the left, "New story" on the
            right, nothing else — both go home, where stories are made. */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--br-secondary)]/25 px-4 py-3 sm:px-8">
          <Link
            to="/"
            className="text-[1.35rem] leading-none"
            style={{ fontFamily: DISPLAY, fontWeight: 600, letterSpacing: DISPLAY_TRACKING }}
            data-wordmark
          >
            STORYSEAM
          </Link>
          <Link
            to="/"
            className={ROW_ACTION}
            style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
            data-new
          >
            <Plus size={12} aria-hidden /> New story
          </Link>
        </div>

        {/* The prompt on its own row, in a card the video's width. From `sm`
            up it is in full, wrapping, never truncated. On a phone a long
            premise would push the steps off the screen, so it is two lines
            with an ellipsis, and a tap opens the whole of it in a dialog.
            The length sits in its corner. */}
        <div className="flex shrink-0 justify-center px-4 pt-3 sm:px-8">
          <div className={cn("flex w-full items-start gap-3 border border-[var(--br-secondary)]/40 bg-[var(--br-surface)] px-4 py-3", FILM_W)}>
            <button
              type="button"
              onClick={() => setPromptOpen(true)}
              aria-label="Show the whole prompt"
              className="min-w-0 flex-1 text-left sm:hidden"
              data-prompt-compact
            >
              <span className="line-clamp-2 break-words text-sm leading-relaxed text-[var(--br-secondary)]">{job.prompt}</span>
            </button>
            <p className="hidden min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--br-secondary)] sm:block" data-prompt>
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
          </div>
        </div>
        <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
          <DialogContent
            className={PAGE_DIALOG}
            style={{ ...HUD, fontFamily: BODY }}
            data-prompt-dialog
          >
            <DialogTitle style={{ fontFamily: MONO, letterSpacing: "0.08em" }} className="text-xs font-normal uppercase text-[var(--br-secondary)]">
              The prompt{length ? ` · ${formatLength(length)}` : ""}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--br-primary)]">
              {job.prompt}
            </DialogDescription>
          </DialogContent>
        </Dialog>

        {done ? (
          <div className="flex flex-1 flex-col animate-in fade-in duration-700">
            {/* The Film in its own 16:9 box, centered — never the screen's full
                width; capped so the details below start above the fold. */}
            <div className="flex shrink-0 flex-col items-center gap-3 px-4 py-3 sm:px-8">
              {/* The Film's actions on their own row right above the picture,
                  flush with its right edge. */}
              <div className={cn("flex w-full flex-wrap items-center justify-between gap-2", FILM_W)}>
                {/* The way INTO the studio, on the left: the Film's own project,
                    at its ROOT url (/p/<id>/) — the studio's own landing, not a
                    tab picked for the author — with the layers the pipeline made
                    (world, script, shot list, the stills or the segments, the
                    score) each on its own tab, the agent beside them, and the
                    Film on the Editor's timeline. Share and Download on the right. */}
                {projectId || job.projectId ? (
                  <Link
                    to={studioPath(projectId || job.projectId, "")}
                    className={ROW_ACTION}
                    style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
                    data-continue
                  >
                    <SlidersHorizontal size={12} aria-hidden /> Continue working on the video
                  </Link>
                ) : <span aria-hidden />}
                <FilmActions job={job} projectId={projectId} />
              </div>
              {/* The video at its OWN ratio (a 480p film is not exactly 16:9),
                  capped to the same height and width as the cards around it —
                  no fixed box, so no letterbox bars inside the player. */}
              <video
                src={filmMediaUrl(job.film.url, projectId || job.projectId)}
                controls
                playsInline
                preload="metadata"
                className={cn("block h-auto max-h-[70dvh] w-auto max-w-full", FILM_W)}
                data-film
              />
            </div>
            <div className="flex flex-1 flex-col items-center gap-3 px-4 py-3 sm:px-8">
              <FilmDetails job={job} />
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
                    <StepBody
                      step={s}
                      onOpen={s.status === "done" && s.result ? () => setOpenStep(s) : null}
                    >
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
                    </StepBody>
                    {s.status === "done" && s.result ? (
                      <button
                        type="button"
                        onClick={() => setOpenStep(s)}
                        aria-label={`See what ${s.label} came back with`}
                        className="mt-0.5 flex size-7 shrink-0 items-center justify-center border border-[var(--br-secondary)]/40 text-[var(--br-secondary)] transition-colors hover:border-[var(--br-primary)]/60 hover:text-[var(--br-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--br-primary)]/60"
                        data-step-details={s.key}
                      >
                        <Search size={13} aria-hidden />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
              <StepResultDialog step={openStep} projectId={projectId || job.projectId} onClose={() => setOpenStep(null)} />
              {stopped && (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--br-tertiary)]" data-stopped>
                    {retryError || "This story couldn't be finished. It doesn't count against your allowance."}
                  </p>
                  {onRetry && failedLabel ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      disabled={retrying}
                      className={ROW_ACTION}
                      style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
                      data-retry
                    >
                      <RotateCw size={12} className={cn(retrying && "animate-spin")} aria-hidden /> Retry from {failedLabel}
                    </button>
                  ) : null}
                </div>
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
