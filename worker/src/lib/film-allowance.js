// The Film allowance — how many Films a user may make on StorySeam's own keys.
//
// CONTEXT.md: "A number stored per user in the database, set by the creators
// (not the author); default 10 per calendar month, resetting on the 1st. A new
// Film counts, and so does a version that re-shoots the sitting; a music-only
// rescore does not, and neither does a Film that fails and stops."
//
// Two calls, used by the Film job:
//
//   checkAllowance  BEFORE a Film starts. Refuses once the month's count has
//                   reached the limit, with a message naming the number and the
//                   reset date — the author must be told why a prompt did not
//                   start.
//   countFilm       once a Film (or a re-shoot) is FINISHED. A Film that fails
//                   is reported as `failed` and is not counted, so our errors
//                   are never the author's cost. Idempotent per filmId: a job
//                   that retries its last step and reports twice counts once.
//
// Per-USER platform data, so it lives in its own D1 tables (film_allowances,
// film_counts — worker/schema.sql), not in the per-project `docs` store.
//
// The window is the UTC calendar month. A Film counts against the month it was
// COUNTED in (`period` is stamped at write time), so one made at 23:59 on the
// 31st and one at 00:01 on the 1st land in different months.

export const DEFAULT_MONTHLY_LIMIT = 10;

// The kinds a Film outcome can be reported as, and which of them cost a Film.
export const FILM_KINDS = Object.freeze(["new", "reshoot", "rescore", "failed"]);
const COUNTED_KINDS = new Set(["new", "reshoot"]);

const toDate = (now) => (now instanceof Date ? now : new Date(now ?? Date.now()));

/** 'YYYY-MM' of the UTC calendar month `now` falls in. */
export function periodOf(now) {
  const d = toDate(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The instant the allowance resets: 00:00 UTC on the 1st of the next month. */
export function resetsAtOf(now) {
  const d = toDate(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

// "1 October 2026" — for the refusal message.
const humanDate = (d) =>
  d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

async function readLimit(env, userId) {
  const row = await env.DB.prepare("SELECT monthly_limit FROM film_allowances WHERE user_id = ?")
    .bind(userId)
    .first();
  const n = Number(row?.monthly_limit);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MONTHLY_LIMIT;
}

async function readUsed(env, userId, period) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM film_counts WHERE user_id = ? AND period = ?",
  )
    .bind(userId, period)
    .first();
  return Number(row?.n) || 0;
}

/**
 * May `userId` start another Film this month?
 * @returns {Promise<{ ok: boolean, limit: number, used: number, remaining: number,
 *   resetsAt: string, period: string, message?: string }>}
 */
export async function checkAllowance(env, userId, now) {
  if (!userId) throw new Error("checkAllowance: userId is required");
  const period = periodOf(now);
  const resets = resetsAtOf(now);
  const [limit, used] = await Promise.all([readLimit(env, userId), readUsed(env, userId, period)]);
  const remaining = Math.max(0, limit - used);
  const out = { ok: remaining > 0, limit, used, remaining, resetsAt: resets.toISOString(), period };
  if (!out.ok) {
    out.message =
      `You've made ${used} of your ${limit} Films this month. ` +
      `Your allowance resets on ${humanDate(resets)}.`;
  }
  return out;
}

/**
 * Record a Film's outcome against the allowance. Only `new` and `reshoot`
 * count; `rescore` and `failed` are accepted and ignored. Counting the same
 * filmId twice is a no-op.
 * @returns {Promise<{ counted: boolean, duplicate?: boolean, kind: string, period?: string }>}
 */
export async function countFilm(env, userId, { filmId, kind } = {}, now) {
  if (!userId) throw new Error("countFilm: userId is required");
  if (!filmId) throw new Error("countFilm: filmId is required");
  if (!FILM_KINDS.includes(kind)) {
    throw new Error(`countFilm: unknown kind "${kind}" (expected ${FILM_KINDS.join(" | ")})`);
  }
  if (!COUNTED_KINDS.has(kind)) return { counted: false, kind };

  const d = toDate(now);
  const period = periodOf(d);
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO film_counts (user_id, film_id, kind, period, counted_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(userId, String(filmId), kind, period, d.toISOString())
    .run();
  const inserted = Number(res?.meta?.changes) > 0;
  return inserted ? { counted: true, kind, period } : { counted: false, duplicate: true, kind, period };
}
