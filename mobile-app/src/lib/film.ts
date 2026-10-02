import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiJson, apiUrl, postJson, putJson } from './api';
import { SPECIALIST_BY_ID } from './specialists';
import { HIDE_EXTRA_MODELS } from './model-flags';

// The Create tab's model: a prompt in, a Film back — the mobile port of the web
// root (`src/components/DirectorStory.jsx` + `src/routes/director-story*.jsx`).
// The lists mirror `src/lib/film-plan.ts` (the worker validates the same ids, so
// a stale copy is a 400, not a silent drift). Everything here talks to
// `/api/auto/*` on the shared Worker: a Film runs on StorySeam's own account,
// so no render key is involved.

// ── Options ───────────────────────────────────────────────────────────────

const FILM_STEPS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
const STORY_FLOW_STEPS = FILM_STEPS;
const FILM_DEFAULT_SECONDS = 120;

export type Stage = { key: string; label: string };

const DIRECTOR_STAGES: Stage[] = [
  { key: 'look', label: 'Look' },
  { key: 'world', label: 'Idea + World' },
  { key: 'script', label: 'Script' },
  { key: 'sheets', label: 'Reference sheets' },
  { key: 'shotlist', label: 'Shot list' },
  { key: 'cuesheet', label: 'Cue sheet' },
  { key: 'run', label: 'Shot sheet run' },
  { key: 'stills', label: 'Stills' },
  { key: 'sitting', label: 'Sitting' },
  { key: 'score', label: 'Score' },
];
const STORY_STAGES: Stage[] = [
  { key: 'look', label: 'Look' },
  { key: 'world', label: 'Idea + World' },
  { key: 'script', label: 'Script' },
  { key: 'sheets', label: 'Character & location sheets' },
  { key: 'shotlist', label: 'Shot list' },
  { key: 'prompts', label: 'Segment prompts' },
  { key: 'run', label: 'Video run' },
  { key: 'stitch', label: 'Final cut' },
  { key: 'score', label: 'Score' },
];

export type FlowId = 'h3' | 'director' | 'seedance';
export type Flow = {
  id: FlowId;
  engine: 'h3' | 'seedance' | null;
  label: string;
  blurb: string;
  steps: number[];
  defaultSeconds: number;
  stages: Stage[];
};

export const FLOWS: Record<FlowId, Flow> = {
  h3: {
    id: 'h3',
    engine: 'h3',
    label: 'MiniMax H3',
    blurb: '15s takes, each continuing the last, at 480P. H3 writes the dialogue and effects, then scored.',
    steps: STORY_FLOW_STEPS,
    defaultSeconds: FILM_DEFAULT_SECONDS,
    stages: STORY_STAGES,
  },
  director: {
    id: 'director',
    engine: null,
    label: 'fal H3 Director',
    blurb: 'A drawn frame every ~4s, played live as one sitting, then scored.',
    steps: FILM_STEPS,
    defaultSeconds: FILM_DEFAULT_SECONDS,
    stages: DIRECTOR_STAGES,
  },
  seedance: {
    id: 'seedance',
    engine: 'seedance',
    label: 'Seedance 2.5',
    blurb: 'Takes of up to 30s, each extending the last, at 480p. Seedance writes the dialogue and effects, then scored.',
    steps: STORY_FLOW_STEPS,
    defaultSeconds: FILM_DEFAULT_SECONDS,
    stages: STORY_STAGES,
  },
};
export const GEN_MODES: Flow[] = [FLOWS.h3, FLOWS.director, FLOWS.seedance];
export const flowOf = (engine?: string | null): Flow =>
  engine === 'h3' ? FLOWS.h3 : engine === 'seedance' ? FLOWS.seedance : FLOWS.director;
const isStoryEngine = (engine?: string | null) => engine === 'h3' || engine === 'seedance';

export const FILM_STYLES = [
  { id: '', label: 'Auto' },
  { id: 'anime-80s', label: '80s anime' },
  { id: 'pixar', label: '3D Pixar' },
  { id: 'live-action', label: 'Live action' },
  { id: '2d-folklore', label: '2D folklore' },
] as const;

export const FILM_WRITERS = [
  { id: 'glm', label: 'GLM-5.3', blurb: 'on Cloudflare — the strongest open writer' },
  { id: 'kimi', label: 'Kimi K2.6', blurb: 'on Cloudflare — a bigger model, a little slower' },
  { id: 'qwen', label: 'Qwen 3.8', blurb: 'on Cloudflare — quick and cheap' },
  { id: 'claude', label: 'Claude Fable 5.1', blurb: 'slower, stronger writing' },
] as const;

// What the Create tab's Writer chip offers: only GLM-5.3 while lib/model-flags.ts
// HIDE_EXTRA_MODELS is on (FILM_WRITERS stays whole to label older Films).
export const OFFERED_FILM_WRITERS = HIDE_EXTRA_MODELS
  ? FILM_WRITERS.filter((w) => w.id === 'glm')
  : FILM_WRITERS;

export const FILM_DEPTHS = [
  { id: 'fast', label: 'Fast', blurb: 'A fast screen writing pass' },
  { id: 'deep', label: 'Deep', blurb: "A deep pass: a writers' room of specialists" },
] as const;

export const FILM_VOICES = [
  { id: 'video', label: 'Audition', blurb: "a 5s audition on the Film's own video model" },
  { id: 'seedaudio', label: 'Seed Audio', blurb: 'read by ByteDance Seed Audio from the voice note' },
  { id: 'elevenlabs', label: 'ElevenLabs', blurb: 'a voice designed on ElevenLabs from the voice note' },
] as const;

export const DEFAULT_DEEP_SPECIALISTS = ['story_architect', 'scene_doctor', 'motivation_doctor', 'dialogue_doctor'];
export const MAX_PROMPT_CHARS = 4000;

/** A room's wall-clock: one round per roster stage, each a pass + a rewrite. */
export function roomEstimate(ids: string[]): { passes: number; label: string } {
  const uniq = [...new Set(ids)];
  const rounds = new Set(uniq.map((id) => SPECIALIST_BY_ID.get(id)?.stage ?? id)).size;
  const minutes = Math.max(1, Math.round((rounds * (150 + 120)) / 60));
  return { passes: uniq.length, label: uniq.length ? `≈ ${minutes} min` : '—' };
}

// Whole seconds: a finished Film's measured length is fractional (153.5).
export const formatLength = (seconds: number) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// The prompt box's settings, remembered per device (the web keeps them in
// localStorage per browser). Defaults match the web input: H3, Deep with the
// core four, GLM-5.3, auditioned voices, scored, 480p.
export type FilmOptions = {
  flow: FlowId;
  seconds: Partial<Record<FlowId, number>>; // only once picked — unset sends nothing
  style: string;
  writer: string;
  depth: 'fast' | 'deep';
  specialists: string[];
  voices: string;
  score: boolean;
  resolution: '480p' | '720p';
};

const OPTIONS_KEY = 'shot-studio.film-options';
const DEFAULT_OPTIONS: FilmOptions = {
  flow: 'h3',
  seconds: {},
  style: '',
  writer: 'glm',
  depth: 'deep',
  specialists: DEFAULT_DEEP_SPECIALISTS,
  voices: 'video',
  score: true,
  resolution: '480p',
};

type OptionsState = FilmOptions & {
  draft: string;
  hydrated: boolean;
  set: (patch: Partial<FilmOptions>) => void;
  setDraft: (d: string) => void;
};

export const useFilmOptions = create<OptionsState>((set, get) => ({
  ...DEFAULT_OPTIONS,
  draft: '',
  hydrated: false,
  set: (patch) => {
    set(patch);
    const { draft: _d, hydrated: _h, set: _s, setDraft: _sd, ...opts } = { ...get() };
    AsyncStorage.setItem(OPTIONS_KEY, JSON.stringify(opts)).catch(() => {});
  },
  setDraft: (draft) => set({ draft }),
}));

export function hydrateFilmOptions() {
  if (useFilmOptions.getState().hydrated) return;
  AsyncStorage.getItem(OPTIONS_KEY)
    .then((raw) => {
      const o = raw ? JSON.parse(raw) : {};
      const flow = (['h3', 'director', 'seedance'] as const).includes(o.flow) ? o.flow : DEFAULT_OPTIONS.flow;
      useFilmOptions.setState({ ...DEFAULT_OPTIONS, ...o, flow, hydrated: true });
    })
    .catch(() => useFilmOptions.setState({ hydrated: true }));
}

/** The POST /api/auto/films body for a prompt under these options — the web's exact rules. */
export function filmBody(prompt: string, o: FilmOptions): Record<string, unknown> {
  const flow = FLOWS[o.flow];
  const body: Record<string, unknown> = { prompt: prompt.trim(), writer: HIDE_EXTRA_MODELS ? 'glm' : o.writer };
  const seconds = o.seconds[o.flow];
  if (seconds && flow.steps.includes(seconds)) body.seconds = seconds;
  if (o.style) body.style = o.style;
  if (flow.engine) body.engine = flow.engine;
  if (o.resolution === '720p') body.resolution = '720p';
  if (!o.score) body.score = false;
  if (isStoryEngine(flow.engine)) body.voices = o.voices;
  if (o.depth === 'deep') {
    body.depth = 'deep';
    body.specialists = o.specialists.length ? o.specialists : DEFAULT_DEEP_SPECIALISTS;
  }
  return body;
}

// ── The Film ──────────────────────────────────────────────────────────────

export type FilmStep = {
  key: string;
  label: string;
  status: 'running' | 'retrying' | 'done' | 'failed';
  summary?: string | null;
  error?: string | null;
  startedAt?: number;
  endedAt?: number;
};

export type FilmJob = {
  id: string;
  prompt: string;
  seconds?: number;
  style?: string;
  engine?: 'seedance' | 'h3';
  writer?: string;
  resolution?: string;
  score?: boolean;
  depth?: string;
  voices?: string;
  status: 'running' | 'queued' | 'awaiting-confirm' | 'done' | 'stopped' | 'declined' | 'refused';
  position?: number;
  error?: string | null;
  projectId?: string;
  createdAt?: number;
  updatedAt?: number;
  steps?: FilmStep[];
  spent?: number;
  stopped?: { stage: string; label: string; reason: string; spent?: number };
  confirm?: { status: 'awaiting' | 'confirmed' | 'declined'; summary?: string };
  film?: { url: string; seconds?: number; title?: string; idea?: string };
};

export const LIVE_STATUSES = new Set(['running', 'queued', 'awaiting-confirm']);

/** The stages this Film runs, in order — the web's `stagesOf`. */
export function stagesOf(job: Partial<FilmJob> | null | undefined): Stage[] {
  let base = flowOf(job?.engine).stages.filter((s) => job?.score !== false || s.key !== 'score');
  if (isStoryEngine(job?.engine) && job?.voices) {
    const at = base.findIndex((s) => s.key === 'sheets') + 1;
    base = [...base.slice(0, at), { key: 'voices', label: 'Voices' }, ...base.slice(at)];
  }
  if (job?.depth === 'deep') {
    const at = base.findIndex((s) => s.key === 'script') + 1;
    base = [...base.slice(0, at), { key: 'room', label: "Writers' room" }, ...base.slice(at)];
  }
  return base;
}

export type StepRow = Stage & { status: FilmStep['status'] | 'pending'; line?: string | null };

/** Started steps merged over the full stage list, so what's ahead shows as waiting. */
export function stepsOf(job: FilmJob): StepRow[] {
  const started = new Map((job.steps || []).map((s) => [s.key, s]));
  const stages = job.status === 'done' ? (job.steps || []).map((s) => ({ key: s.key, label: s.label })) : stagesOf(job);
  return stages.map((st) => {
    const s = started.get(st.key);
    if (!s) return { ...st, status: 'pending' as const };
    return { key: st.key, label: s.label || st.label, status: s.status, line: s.status === 'failed' ? s.error : s.summary };
  });
}

export const STATUS_LABEL: Record<string, string> = {
  done: 'Done',
  running: 'Being made',
  'awaiting-confirm': 'Waiting on you',
  queued: 'Queued',
  stopped: 'Stopped',
  declined: 'Declined',
  refused: 'Refused',
  unknown: 'Unknown',
};

/** A Film's video, addressed to its own project (media can't carry the header). */
export function filmVideoUrl(job: FilmJob, projectId?: string | null): string | undefined {
  const url = job.film?.url;
  if (!url) return undefined;
  const pid = projectId || job.projectId;
  const abs = apiUrl(url);
  return pid ? `${abs}${abs.includes('?') ? '&' : '?'}projectId=${encodeURIComponent(pid)}` : abs;
}

// ── API ───────────────────────────────────────────────────────────────────

export type StartResult =
  | { ok: true; filmId: string; projectId: string }
  | { ok: false; message: string; filmId?: string; projectId?: string };

export async function startFilm(prompt: string, o: FilmOptions): Promise<StartResult> {
  // A Film started from here runs on its own — the web's home switches the
  // account's Auto setting on before posting, so none stops for a confirm.
  try {
    const s = await apiJson<{ auto?: boolean }>('/api/auto/settings');
    if (s && s.auto === false) await putJson('/api/auto/settings', { auto: true });
  } catch {
    /* no project yet / older worker: the Film still starts */
  }
  const res = await fetch(apiUrl('/api/auto/films'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(filmBody(prompt, o)),
  });
  const data: any = await res.json().catch(() => ({}));
  if (res.ok && data?.job?.id) return { ok: true, filmId: data.job.id, projectId: data.projectId };
  return {
    ok: false,
    message: data?.refusal?.message || data?.error || `Couldn't start the story (${res.status})`,
    filmId: data?.refusal?.filmId,
    projectId: data?.refusal?.projectId,
  };
}

export const filmProject = (id: string) =>
  apiJson<{ projectId: string }>(`/api/auto/films/${encodeURIComponent(id)}/project`);
export const getFilm = (id: string) =>
  apiJson<{ job: FilmJob; projectId: string }>(`/api/auto/films/${encodeURIComponent(id)}`);
export const retryFilm = (id: string) =>
  postJson<{ ok: boolean; job?: FilmJob; message?: string }>(`/api/auto/films/${encodeURIComponent(id)}/retry`);
export const confirmFilm = (id: string, yes: boolean) =>
  postJson<{ ok: boolean; job?: FilmJob }>(`/api/auto/films/${encodeURIComponent(id)}/${yes ? 'confirm' : 'decline'}`);
export const shareFilm = (id: string) =>
  postJson<{ ok: boolean; shared: boolean; path: string | null }>(`/api/auto/films/${encodeURIComponent(id)}/share`);

export type MyFilm = {
  filmId: string;
  projectId: string;
  createdAt?: number;
  title?: string;
  prompt?: string;
  status: string;
  engine?: string;
  seconds?: number;
  url?: string;
};
export const myFilms = () => apiJson<{ films: MyFilm[] }>('/api/auto/films/mine?limit=30');
export const latestFilm = () =>
  apiJson<{ filmId?: string; projectId?: string; job: FilmJob | null }>('/api/auto/films/latest');
