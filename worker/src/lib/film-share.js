// Share links for a finished Film — watch (and download) it with no account.
//
// Same credential as the script/world share link (lib/share-token.js): the
// token is `<base64url(projectId)>.<128-bit random hex>`, so a viewer with no
// session and no project header can be resolved to the Film's project, and the
// random half is checked against what the project stored. Every Film has a
// project of its own, so the store is one doc per project:
//
//   film-share = { films: { [filmId]: { token, createdAt, steps? } } }
//
// `steps` (off by default) makes the link also show HOW the Film was made: the
// pipeline's steps and what each came back with, media and screenplay included
// (routes/share.js serves those through the token only while it is on).
//
// Revoking deletes the entry, and every copy of the link dies with a 404 that
// looks exactly like a token that never existed.
import { readDoc, updateDoc } from "./docs.js";
import { directorFileOf } from "./film-score.js";
import { filmJobsFor } from "./films.js";
import { makeShareToken, shareTokenProject, shareTokensMatch } from "./share-token.js";

export const FILM_SHARE_DOC = "film-share";
const empty = () => ({ films: {} });

/** The Film's live share link → { token, steps } (token null when not shared). */
export async function filmShareToken(env, pid, filmId) {
  const doc = await readDoc(env, pid, FILM_SHARE_DOC, empty());
  const entry = doc.films?.[filmId];
  return { token: entry?.token || null, steps: !!entry?.steps };
}

/**
 * Mint the Film's share token — or return the one it already has. `steps`
 * (a boolean) switches "include step details" on the link; undefined leaves it.
 * → { token, steps }
 */
export async function shareFilm(env, pid, filmId, { steps } = {}) {
  let out = null;
  await updateDoc(env, pid, FILM_SHARE_DOC, empty(), (doc) => {
    doc.films = doc.films || {};
    const have = doc.films[filmId];
    if (have?.token) {
      out = { token: have.token, steps: !!have.steps };
      if (typeof steps !== "boolean" || steps === !!have.steps) return { abort: true };
      have.steps = steps;
      out.steps = steps;
      return {};
    }
    const token = makeShareToken(pid);
    doc.films[filmId] = { token, createdAt: new Date().toISOString(), steps: steps === true };
    out = { token, steps: steps === true };
    return {};
  });
  return out;
}

/** Revoke the Film's share link. → true when there was one. */
export async function unshareFilm(env, pid, filmId) {
  let had = false;
  await updateDoc(env, pid, FILM_SHARE_DOC, empty(), (doc) => {
    had = !!doc.films?.[filmId];
    if (!had) return { abort: true };
    delete doc.films[filmId];
    return {};
  });
  return had;
}

/**
 * A presented token → the shared Film, or null (malformed, revoked, never
 * issued, or the Film has no finished video — all indistinguishable).
 * → { pid, filmId, job, film, file, steps }
 */
export async function resolveFilmShare(env, token) {
  const pid = shareTokenProject(token);
  if (!pid) return null;
  const doc = await readDoc(env, pid, FILM_SHARE_DOC, empty());
  let filmId = null;
  let steps = false;
  for (const [id, entry] of Object.entries(doc.films || {})) {
    if (await shareTokensMatch(entry?.token, token)) {
      filmId = id;
      steps = !!entry.steps;
    }
  }
  if (!filmId) return null;
  const job = await filmJobsFor(env, pid).film(filmId).catch(() => null);
  const film = job?.status === "done" ? job.film : null;
  const file = film ? film.file || directorFileOf(film.url) : "";
  if (!file) return null;
  return { pid, filmId, job, film, file, steps };
}

/** A download name: the Film's title, made filename-safe. */
export function filmDownloadName(film) {
  const base = String(film?.title || "story").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 80);
  return `${base || "story"}.mp4`;
}
