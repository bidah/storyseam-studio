// The composition plan: one continuous cue, as long as the film, in chunks.
//
// This is fal's `MusicV2CompositionPlan` for `elevenlabs/music/v2.5`, and the
// rules here are the schema's rules plus the one the film adds: the chunks have
// to add up to the film's MEASURED length, because the audio is never stretched
// or trimmed to fit afterwards — a plan that is short is fixed in the plan.
//
// Pure, and vendored by `npm run series:sync` into the Worker and the agent.
// All three validate a plan with the same function, so a plan the page would
// refuse is refused before a request is spent, and a plan the Worker would
// refuse is shown as refused in the page first.

export const CHUNK_MIN_MS = 3_000;
export const CHUNK_MAX_MS = 120_000;
export const PLAN_MIN_MS = 3_000;
export const PLAN_MAX_MS = 600_000;
export const MAX_CHUNKS = 30;
/** The film and the plan may disagree by this much and still be one length. */
export const LENGTH_TOLERANCE_MS = 50;
/** fal's price for this model: per output minute, rounded UP. */
export const USD_PER_MINUTE = 0.6;

export const ADHERENCE = ['low', 'medium', 'high'] as const;
export type Adherence = (typeof ADHERENCE)[number];

export type Chunk = {
  /** `[Section name]`, and nothing else — this is an underscore, not a song. */
  text: string;
  duration_ms: number;
  positive_styles: string[];
  negative_styles?: string[];
  context_adherence?: Adherence;
};

export type Plan = {
  chunks: Chunk[];
  /** Set once a take is good enough to iterate on. */
  seed?: number;
};

export type PlanError = { chunk?: number; message: string };

/** Every reason this plan cannot be rendered, or none. */
export function validatePlan(plan: unknown, filmMs?: number): PlanError[] {
  const errors: PlanError[] = [];
  const chunks = (plan as { chunks?: unknown } | null)?.chunks;
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > MAX_CHUNKS) {
    return [{ message: `a plan holds 1–${MAX_CHUNKS} chunks` }];
  }
  let total = 0;
  chunks.forEach((raw, index) => {
    const chunk = raw as Partial<Chunk> | null;
    const duration = chunk?.duration_ms;
    if (!Number.isInteger(duration) || (duration as number) < CHUNK_MIN_MS || (duration as number) > CHUNK_MAX_MS) {
      errors.push({ chunk: index, message: `a chunk is ${CHUNK_MIN_MS / 1000}–${CHUNK_MAX_MS / 1000} s` });
    } else {
      total += duration as number;
    }
    if (!chunk?.text?.trim()) errors.push({ chunk: index, message: 'a chunk needs a [Section name]' });
    if (!Array.isArray(chunk?.positive_styles) || chunk.positive_styles.filter((s) => s?.trim()).length === 0) {
      errors.push({ chunk: index, message: 'a chunk needs at least one positive style' });
    }
    if (chunk?.context_adherence !== undefined && !ADHERENCE.includes(chunk.context_adherence)) {
      errors.push({ chunk: index, message: 'context adherence is low, medium or high' });
    }
  });
  if (errors.length === 0) {
    if (total < PLAN_MIN_MS || total > PLAN_MAX_MS) {
      errors.push({ message: `the chunks total ${(total / 1000).toFixed(1)} s; the model takes ${PLAN_MIN_MS / 1000}–${PLAN_MAX_MS / 1000} s` });
    }
    if (filmMs !== undefined && Math.abs(total - filmMs) > LENGTH_TOLERANCE_MS) {
      errors.push({
        message: `the chunks total ${(total / 1000).toFixed(1)} s but the film is ${(filmMs / 1000).toFixed(1)} s — fix the plan, do not stretch the audio`,
      });
    }
  }
  const seed = (plan as { seed?: unknown }).seed;
  if (seed !== undefined && seed !== null && !Number.isInteger(seed)) {
    errors.push({ message: 'a seed is a whole number' });
  }
  return errors;
}

export function planTotalMs(plan: Plan): number {
  return plan.chunks.reduce((sum, chunk) => sum + (Number.isFinite(chunk.duration_ms) ? chunk.duration_ms : 0), 0);
}

/** What one render costs, in USD: per minute, rounded up, as fal bills it. */
export function renderCostUsd(totalMs: number): number {
  return Math.ceil(totalMs / 60_000) * USD_PER_MINUTE;
}

/** The second each chunk starts at, on the film's clock. */
export function chunkStarts(plan: Plan): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const chunk of plan.chunks) {
    starts.push(at / 1000);
    at += chunk.duration_ms;
  }
  return starts;
}

/**
 * Split a chunk at a second on the film's clock, so a turn found in the
 * picture becomes a boundary in the music. The new chunk inherits the styles;
 * the section name is the caller's to change.
 */
export function splitAt(plan: Plan, atSeconds: number): Plan {
  const atMs = Math.round(atSeconds * 1000);
  let start = 0;
  const chunks: Chunk[] = [];
  for (const chunk of plan.chunks) {
    const end = start + chunk.duration_ms;
    const inside = atMs - start;
    if (inside >= CHUNK_MIN_MS && end - atMs >= CHUNK_MIN_MS) {
      chunks.push({ ...chunk, duration_ms: inside });
      chunks.push({ ...chunk, text: `${chunk.text.replace(/\]\s*$/, '')} (from ${atSeconds}s)]`, duration_ms: end - atMs });
    } else {
      chunks.push(chunk);
    }
    start = end;
  }
  return { ...plan, chunks };
}

/** Join a chunk to the one before it; the earlier chunk's styles win. */
export function mergeIntoPrevious(plan: Plan, index: number): Plan {
  if (index <= 0 || index >= plan.chunks.length) return plan;
  const chunks = [...plan.chunks];
  const previous = chunks[index - 1];
  chunks.splice(index - 1, 2, { ...previous, duration_ms: previous.duration_ms + chunks[index].duration_ms });
  return { ...plan, chunks };
}

/**
 * Give the last chunk whatever is missing (or take back whatever is over), so
 * a plan edited chunk by chunk can be made to add up to the film in one move.
 */
export function fitToFilm(plan: Plan, filmMs: number): Plan {
  if (plan.chunks.length === 0) return plan;
  const total = planTotalMs(plan);
  const last = plan.chunks[plan.chunks.length - 1];
  const wanted = last.duration_ms + (filmMs - total);
  if (wanted < CHUNK_MIN_MS || wanted > CHUNK_MAX_MS) return plan;
  return { ...plan, chunks: [...plan.chunks.slice(0, -1), { ...last, duration_ms: wanted }] };
}

/** A brief as a person writes it, as the tags the first chunk carries. */
export function styleTags(brief: string): string[] {
  return brief
    .split(/[,\n;]+/)
    .map((tag) => tag.trim().replace(/\.$/, ''))
    .filter((tag) => tag.length > 0 && tag.length <= 80);
}

/**
 * A plan to start from when the Series has none: the whole film as one calm
 * chunk in the Series' own style, and the last six seconds as an ending.
 *
 * Deliberately not a guess at the arc. The arc comes from the picture — the
 * loudness row and the frames — and is put in by splitting this at the seconds
 * where the film turns. A starter that invented "alarm at 40 s" would be a plan
 * written from a cue sheet, which is exactly what the film clock disagrees with.
 */
export function starterPlan(brief: string, filmMs: number): Plan {
  const tags = styleTags(brief);
  const genre = tags.length ? tags : ['instrumental score'];
  const endMs = 6_000;
  const body = Math.max(CHUNK_MIN_MS, filmMs - endMs);
  const chunks: Chunk[] = [
    {
      text: '[Opening]',
      duration_ms: body,
      positive_styles: [...genre, 'quiet ambient intro', 'pads only', 'pianissimo', 'no drums, no percussion'],
      negative_styles: ['vocals', 'lyrics', 'drums', 'percussion', 'drum kit', 'brass stabs', 'guitar'],
      context_adherence: 'high',
    },
  ];
  if (filmMs - body >= CHUNK_MIN_MS) {
    chunks.push({
      text: '[End]',
      duration_ms: filmMs - body,
      positive_styles: ['final sustained chord', 'hard stop ending', 'abrupt clean ending'],
      negative_styles: ['vocals', 'lyrics', 'fade out'],
      context_adherence: 'high',
    });
  }
  // A body longer than a chunk may be is cut into equal chunks of the same
  // mood; the model's ceiling is per chunk, not per plan.
  const first = chunks[0];
  if (first.duration_ms > CHUNK_MAX_MS) {
    const parts = Math.ceil(first.duration_ms / CHUNK_MAX_MS);
    const each = Math.floor(first.duration_ms / parts);
    const split: Chunk[] = [];
    let left = first.duration_ms;
    for (let i = 0; i < parts; i++) {
      const duration = i === parts - 1 ? left : each;
      split.push({ ...first, text: i === 0 ? first.text : `[Opening ${i + 1}]`, duration_ms: duration });
      left -= duration;
    }
    chunks.splice(0, 1, ...split);
  }
  return { chunks };
}

/** The plan a stored music piece was made from, if its prompt is one. */
export function planFromPrompt(prompt: string | null | undefined): Plan | null {
  if (!prompt) return null;
  try {
    const parsed = JSON.parse(prompt) as { chunks?: unknown; composition_plan?: { chunks?: unknown }; seed?: unknown };
    const chunks = parsed.chunks ?? parsed.composition_plan?.chunks;
    if (!Array.isArray(chunks)) return null;
    const plan: Plan = { chunks: chunks as Chunk[] };
    if (Number.isInteger(parsed.seed)) plan.seed = parsed.seed as number;
    return validatePlan(plan).length === 0 ? plan : null;
  } catch {
    return null;
  }
}

/** The body fal is sent. What the Series keeps as the piece's prompt, verbatim. */
export function renderBody(plan: Plan, outputFormat = 'mp3_48000_192'): Record<string, unknown> {
  const body: Record<string, unknown> = {
    composition_plan: { chunks: plan.chunks.map(cleanChunk) },
    output_format: outputFormat,
  };
  if (Number.isInteger(plan.seed)) body.seed = plan.seed;
  return body;
}

function cleanChunk(chunk: Chunk): Chunk {
  const out: Chunk = {
    text: chunk.text.trim(),
    duration_ms: chunk.duration_ms,
    positive_styles: chunk.positive_styles.map((s) => s.trim()).filter(Boolean),
  };
  const negatives = (chunk.negative_styles ?? []).map((s) => s.trim()).filter(Boolean);
  if (negatives.length) out.negative_styles = negatives;
  if (chunk.context_adherence) out.context_adherence = chunk.context_adherence;
  return out;
}
