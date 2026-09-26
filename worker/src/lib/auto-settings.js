// The Auto toggle — per user, ON by default (CONTEXT.md › Auto).
//
// On, the Film job never asks anything. Off, it pauses ONCE, after the World
// and before anything is paid for, on a confirm card (lib/film-job.js
// `confirmPlan` / `confirmFilm` / `declineFilm`).
//
// Per-USER platform data (it follows the author across projects and devices),
// so it lives in its own D1 table (`auto_settings`, worker/schema.sql +
// migrations/004-auto-settings.sql) the way the Film allowance does, not in
// the per-project `docs` store. No row means the default: Auto on.

export const DEFAULT_AUTO = true;

/** → `{ auto: boolean }`. Never throws: a missing table or row is the default. */
export async function readAutoSettings(env, userId) {
  if (!userId || !env?.DB) return { auto: DEFAULT_AUTO };
  try {
    const row = await env.DB.prepare("SELECT auto FROM auto_settings WHERE user_id = ?").bind(userId).first();
    if (!row || row.auto == null) return { auto: DEFAULT_AUTO };
    return { auto: Number(row.auto) !== 0 };
  } catch {
    return { auto: DEFAULT_AUTO };
  }
}

/** Upsert the user's toggle. → `{ auto }` as stored. */
export async function writeAutoSettings(env, userId, { auto }) {
  if (!userId) throw new Error("writeAutoSettings: userId is required");
  const on = auto !== false;
  await env.DB.prepare(
    "INSERT INTO auto_settings (user_id, auto, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET auto = excluded.auto, updated_at = excluded.updated_at",
  )
    .bind(userId, on ? 1 : 0, new Date().toISOString())
    .run();
  return { auto: on };
}
