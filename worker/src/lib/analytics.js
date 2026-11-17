// PostHog server-side events: what happens where no browser is watching — a
// Film's pipeline running stage by stage in its Durable Object, and PayPal's
// webhooks. Sent under the Better Auth user id, the same distinct id the
// browser identifies with (src/lib/analytics.js), so a person's funnel joins
// the click on "make the story" to the stages that ran and the Film that came
// back.
//
// Best-effort by design: a failed capture is logged and dropped, never thrown
// into the pipeline. Without POSTHOG_PROJECT_TOKEN nothing is sent.

const HOST = "https://us.i.posthog.com";

export async function capture(env, distinctId, event, properties = {}) {
  const token = env?.POSTHOG_PROJECT_TOKEN;
  if (!token || !distinctId) return;
  try {
    const res = await fetch(`${HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        event,
        distinct_id: distinctId,
        properties: { ...properties, $lib: "storyseam-worker" },
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) console.warn(`[analytics] ${event} → ${res.status}`);
  } catch (err) {
    console.warn(`[analytics] ${event} failed`, err?.message || err);
  }
}

const seconds = (from, to) => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 1000) : null;
};

/**
 * The Film job event (lib/film-job.js `event`) as a PostHog event, or null for
 * the kinds that aren't worth one (step.started, step.progress — the browser
 * reports what the visitor saw as `film_step_shown`).
 */
export function filmAnalyticsEvent(job, ev) {
  const base = { film_id: job.id, engine: job.engine || "director", depth: job.depth || "fast", writer: job.writer || null, seconds: job.seconds ?? null };
  const step = ev.step ? job.steps?.find((s) => s.key === ev.step) : null;
  switch (ev.kind) {
    case "film.started":
      return ["film_job_started", base];
    case "step.done":
      return ["film_stage_completed", { ...base, stage: ev.step, label: step?.label || null, duration_s: seconds(step?.startedAt, step?.endedAt), spend_usd: job.spend?.[ev.step] ?? 0 }];
    case "step.retrying":
      return ["film_stage_retrying", { ...base, stage: ev.step, error: step?.error || null }];
    case "step.failed":
      return ["film_stage_failed", { ...base, stage: ev.step, error: step?.error || null }];
    case "film.done":
      return ["film_completed", { ...base, spent_usd: job.spent ?? null, duration_s: seconds(job.createdAt, job.updatedAt), has_film: Boolean(job.film?.url) }];
    case "film.stopped":
      return ["film_stopped", { ...base, stage: job.stopped?.stage || null, spent_usd: job.stopped?.spent ?? null }];
    case "film.refused":
      return ["film_refused", { ...base, error: job.error || null }];
    case "film.awaiting-confirm":
      return ["film_awaiting_confirm", base];
    default:
      return null;
  }
}
