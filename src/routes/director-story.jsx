// /director-story — the SIMPLE view: the hero and one input. Nothing else.
//
// Submitting starts a Film (POST /api/auto/films) and moves the URL to that
// Film's own page, /director-story/create/:filmId (routes/director-story-film
// .jsx) — the URL is the state, so a reload never loses the run. A Film queued
// behind another keeps its id when it starts (worker/src/lib/film-queue.js), so
// a queued one navigates to its id too and that page says "Queued".
//
// Visiting here while a Film is running does NOT hijack the page: it stays the
// simple view, with one small link to the running Film. The shared pieces
// (auth, project, the views) live in components/DirectorStory.jsx.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  ACTIVE,
  AuthGate,
  SimpleView,
  fetchCurrent,
  filmPath,
  getJSON,
  useDirectorProject,
} from "@/components/DirectorStory";

export function Component() {
  return <AuthGate>{(signedIn) => <SimpleStory signedIn={signedIn} />}</AuthGate>;
}

function SimpleStory({ signedIn }) {
  const navigate = useNavigate();
  const { projectId, error, ready } = useDirectorProject(signedIn);
  const [note, setNote] = useState(null); // the one line under the input
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(null);

  useEffect(() => { if (error) setNote(error); }, [error]);

  // A Film already in progress on this project → offer the link to it.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetchCurrent()
      .then((current) => { if (live && current && ACTIVE.has(current.status)) setRunning(current); })
      .catch(() => {});
    return () => { live = false; };
  }, [projectId]);

  const start = async (prompt) => {
    if (submitting) return false;
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
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok || !data.ok) {
        setNote(data.refusal?.message || data.error || `Couldn't start (${res.status}).`);
        return false;
      }
      // Started → the job's id; queued → the queue item's id (it becomes the
      // job's id when it starts).
      const id = data.queued ? (data.film?.id ?? data.item?.id) : data.job?.id;
      if (!id) {
        setNote("The story started, but its page couldn't be found — reload to see it.");
        return true;
      }
      navigate(filmPath(id));
      return true;
    } catch (err) {
      setNote(String(err?.message || err));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return <SimpleView onSubmit={start} submitting={submitting} note={note} running={running} />;
}
