// A project per Film — and the lookup from a Film to its project.
//
// An Auto Film used to run inside the author's CURRENT project, and its World
// stage MERGES into that project's single World doc (routes/world.js saveWorld).
// A story about two friends in the woods came back with reference sheets for the
// mecha pilot of the author's existing project: the old characters were still in
// the World the sheets stage drew. The shot list and every other project-level
// singleton doc had the same problem.
//
// So every Film now starts in a NEW project of its own (routes/auto.js creates
// it through routes/projects.js#createProject), and the `films` table remembers
// which project that was:
//
//   films = { film_id PRIMARY KEY, project_id, user_id, created_at }
//
// It answers the three questions a Film id alone must answer, without a
// "current project": which project is this Film in (the /director-story page by
// URL, get_film / retry_film), is this user already making one (one Film at a
// time per USER — the per-project queue can't serialise Films that each have a
// project of their own), and which is their latest (the "a story is being made"
// link). Every query is scoped to the user: a Film id is never resolved for
// someone who didn't start it.
//
// The FilmJobs DO (film-job-do.js) is still one per project; this table is what
// finds the right one.
import { normalizeProjectId } from "./docs.js";

/** The FilmJobs Durable Object that holds a project's Film job. */
export const filmJobsFor = (env, projectId) =>
  env.FILM_JOBS.get(env.FILM_JOBS.idFromName(normalizeProjectId(projectId)));

const PROJECT_WORDS = 6;
const PROJECT_CHARS = 60;

/**
 * The name a Film's project starts with: "Story — <first words of the prompt>".
 * Renamed to the World's title once the World stage has one (nameFilmProject).
 */
export function storyProjectName(prompt) {
  const words = String(prompt || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let head = words.slice(0, PROJECT_WORDS).join(" ");
  if (head.length > PROJECT_CHARS) head = head.slice(0, PROJECT_CHARS).trimEnd();
  const cut = head.length < words.join(" ").length;
  return head ? `Story — ${head}${cut ? "…" : ""}` : "Story";
}

// A read that answers "nothing" rather than throwing while the table doesn't
// exist yet (the Worker deployed before migrations/005-films.sql was applied):
// every caller then falls back to the pre-lookup behaviour.
async function read(env, sql, ...binds) {
  try {
    return (await env.DB.prepare(sql).bind(...binds).first()) ?? null;
  } catch (err) {
    console.warn("films lookup unavailable:", err?.message || err);
    return null;
  }
}

/** Remember which project a Film runs in. Idempotent on the Film id. */
export async function recordFilm(env, { filmId, projectId, userId, now }) {
  const at = new Date(now ?? Date.now()).toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO films (film_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?)",
  ).bind(filmId, projectId, userId, at).run();
}

/** The project a Film of THIS user's runs in → project id | null. */
export async function filmProject(env, filmId, userId) {
  if (!filmId || !userId) return null;
  const row = await read(env, "SELECT project_id FROM films WHERE film_id = ? AND user_id = ?", filmId, userId);
  return row?.project_id ?? null;
}

/** The user's most recently started Film → { filmId, projectId, createdAt } | null. */
export async function latestFilm(env, userId) {
  if (!userId) return null;
  const row = await read(
    env,
    "SELECT film_id, project_id, created_at FROM films WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    userId,
  );
  return row ? { filmId: row.film_id, projectId: row.project_id, createdAt: row.created_at } : null;
}

/** A job that still holds its maker: running, waiting on its confirm card, or queued. */
const holds = (job) => ["running", "awaiting-confirm", "queued"].includes(job?.status);

/**
 * The user's Film that is still being made → { filmId, projectId, job } | null.
 * One Film at a time per user means only the LATEST can be — so this reads one
 * row and one Durable Object, not the user's whole history.
 */
export async function activeFilm(env, userId) {
  const latest = await latestFilm(env, userId);
  if (!latest) return null;
  const job = await filmJobsFor(env, latest.projectId).film(latest.filmId);
  return holds(job) ? { ...latest, job } : null;
}

/** Rename a Film's own project (and only one made for a Film) once its World has a title. */
export async function nameFilmProject(env, filmId, title) {
  const clean = String(title || "").trim();
  if (!filmId || !clean) return;
  await env.DB.prepare(
    "UPDATE projects SET name = ?, updated_at = ? WHERE id = (SELECT project_id FROM films WHERE film_id = ?)",
  ).bind(`Story — ${clean}`.slice(0, 120), new Date().toISOString(), filmId).run();
}
