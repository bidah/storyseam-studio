// /director-story — the SIMPLE view: the hero and one input. Nothing else.
//
// Submitting starts a Film (POST /api/auto/films { prompt, seconds } — the
// length from the input's settings gear) IN A NEW PROJECT OF ITS OWN, made by
// the Worker, and moves the URL to that Film's own page,
// /director-story/create/:filmId (routes/director-story-film.jsx) — the URL is
// the state, so a reload never loses the run.
//
// Signed OUT, the page still opens (it is the pitch). Submitting then saves the
// premise and opens the Google sign-in modal; Google returns here with
// `?resume=1`, and the saved premise starts on its own — straight on to its
// Film's page.
//
// Signed in, "Latest stories" under the box lists the user's Films (user-
// scoped, whichever project each is in); picking one opens its page.
//
// Visiting here while a Film is being made does NOT hijack the page: it stays
// the simple view, with one small link to it. The shared pieces live in
// components/DirectorStory.jsx.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ACTIVE,
  LatestStories,
  RESUME_PARAM,
  SignInDialog,
  SimpleView,
  fetchLatest,
  filmPath,
  getJSON,
  savePendingStory,
  takePendingStory,
  useDirectorProject,
} from "@/components/DirectorStory";
import { useSession } from "@/lib/auth-client";
import { setProjectId } from "@/lib/projectFetch";

export function Component() {
  const { data: session, isPending } = useSession();
  return <SimpleStory signedIn={!!session} sessionKnown={!isPending} />;
}

function SimpleStory({ signedIn, sessionKnown }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [signInOpen, setSignInOpen] = useState(false);
  const resumed = useRef(false);
  // Only the settings write below needs a project in scope; the Film makes its own.
  const { error, ready } = useDirectorProject(signedIn);
  const [note, setNote] = useState(null); // the one line under the input
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(null);

  useEffect(() => { if (error) setNote(error); }, [error]);

  // A Film of this user's still being made → offer the link to it.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchLatest()
      .then((latest) => { if (live && latest && ACTIVE.has(latest.status)) setRunning(latest); })
      .catch(() => {});
    return () => { live = false; };
  }, [signedIn]);

  const start = async (prompt, seconds, style) => {
    if (submitting) return false;
    if (!signedIn) {
      // Keep the premise across the Google round trip; it starts on return.
      savePendingStory(prompt, seconds, style);
      setSignInOpen(true);
      return false;
    }
    setSubmitting(true);
    setNote(null);
    try {
      if (!ready.current) throw new Error("Still signing you in — try again in a moment.");
      await ready.current;
      // Auto is always on here. The setting is per user; flip it on if off.
      const { data: settings } = await getJSON("/api/auto/settings");
      if (settings?.auto === false) {
        await fetch("/api/auto/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auto: true }),
        });
      }
      const { res, data } = await getJSON("/api/auto/films", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The gear's length: it wins over any length the prompt states.
        // The look, when one was picked; otherwise the Worker reads it off the prompt.
        body: JSON.stringify({ prompt, ...(seconds ? { seconds } : {}), ...(style ? { style } : {}) }),
      });
      if (!res.ok || !data.ok) {
        setNote(data.refusal?.message || data.error || `Couldn't start (${res.status}).`);
        // Refused because another of theirs is being made: offer the way there.
        if (data.refusal?.code === "busy" && data.filmId) setRunning({ ...(data.job || {}), id: data.filmId });
        return false;
      }
      const id = data.job?.id;
      if (!id) {
        setNote("The story started, but its page couldn't be found — reload to see it.");
        return true;
      }
      // The Film's own project: its page looks it up again by id, but setting
      // it now saves the round trip before the first read.
      if (data.projectId) setProjectId(data.projectId);
      navigate(filmPath(id));
      return true;
    } catch (err) {
      setNote(String(err?.message || err));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  // Back from Google (`?resume=1`): start the premise saved before sign-in.
  useEffect(() => {
    if (!sessionKnown || resumed.current || !params.has(RESUME_PARAM)) return;
    resumed.current = true;
    const next = new URLSearchParams(params);
    next.delete(RESUME_PARAM);
    setParams(next, { replace: true });
    if (!signedIn) return;
    const pending = takePendingStory();
    if (!pending) return;
    setNote("Starting your story…");
    start(pending.prompt, pending.seconds, pending.style);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKnown, signedIn]);

  const openFilm = (film) => {
    if (film.projectId) setProjectId(film.projectId);
    navigate(filmPath(film.filmId));
  };

  return (
    <>
      <SimpleView
        onSubmit={start}
        submitting={submitting}
        note={note}
        running={running}
        below={signedIn ? <LatestStories onPick={openFilm} /> : null}
      />
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </>
  );
}
