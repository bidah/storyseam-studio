// Share links for a finished Film — watch (and download) it with no account.
//
// Same credential as the script/world share link (lib/share-token.js): the
// token is `<base64url(projectId)>.<128-bit random hex>`, so a viewer with no
// session and no project header can be resolved to the Film's project, and the
// random half is checked against what the project stored. Every Film has a
// project of its own, so the store is one doc per project:
//
//   film-share = { films: { [filmId]: { token, createdAt } } }
//
// Revoking deletes the entry, and every copy of the link dies with a 404 that
// looks exactly like a token that never existed.
import { readDoc, updateDoc } from "./docs.js";
import { directorFileOf } from "./film-score.js";
import { filmJobsFor } from "./films.js";
import { makeShareToken, shareTokenProject, shareTokensMatch } from "./share-token.js";

export const FILM_SHARE_DOC = "film-share";
const empty = () => ({ films: {} });

/** The Film's live share token, or null. */
export async function filmShareToken(env, pid, filmId) {
  const doc = await readDoc(env, pid, FILM_SHARE_DOC, empty());
  return doc.films?.[filmId]?.token || null;
}

/** Mint the Film's share token — or return the one it already has. */
export async function shareFilm(env, pid, filmId) {
  let token = null;
  await updateDoc(env, pid, FILM_SHARE_DOC, empty(), (doc) => {
    doc.films = doc.films || {};
    const have = doc.films[filmId]?.token;
    if (have) {
      token = have;
      return { abort: true };
    }
    token = makeShareToken(pid);
    doc.films[filmId] = { token, createdAt: new Date().toISOString() };
    return {};
  });
  return token;
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
 * → { pid, filmId, job, film, file }
 */
export async function resolveFilmShare(env, token) {
  const pid = shareTokenProject(token);
  if (!pid) return null;
  const doc = await readDoc(env, pid, FILM_SHARE_DOC, empty());
  let filmId = null;
  for (const [id, entry] of Object.entries(doc.films || {})) {
    if (await shareTokensMatch(entry?.token, token)) filmId = id;
  }
  if (!filmId) return null;
  const job = await filmJobsFor(env, pid).film(filmId).catch(() => null);
  const film = job?.status === "done" ? job.film : null;
  const file = film ? film.file || directorFileOf(film.url) : "";
  if (!file) return null;
  return { pid, filmId, job, film, file };
}

/** A download name: the Film's title, made filename-safe. */
export function filmDownloadName(film) {
  const base = String(film?.title || "story").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 80);
  return `${base || "story"}.mp4`;
}
