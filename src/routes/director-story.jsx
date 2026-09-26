// /director-story — the SIMPLE view: the hero and one input. Nothing else.
//
// Submitting starts a Film (POST /api/auto/films { prompt, seconds } — the
// length from the input's settings gear) IN A NEW PROJECT OF ITS OWN, made by
// the Worker, and moves the URL to that Film's own page,
// /director-story/create/:filmId (routes/director-story-film.jsx) — the URL is
// the state, so a reload never loses the run.
//
// Visiting here while a Film is being made does NOT hijack the page: it stays
// the simple view, with one small link to it. That Film is the USER's latest
// (GET /api/auto/films/latest — user-scoped, whatever project it is in), since
// a user makes one Film at a time. The shared pieces (auth, project, the
// views) live in components/DirectorStory.jsx.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  ACTIVE,
  AuthGate,
  SimpleView,
  fetchLatest,
  filmPath,
  getJSON,
  useDirectorProject,
} from "@/components/DirectorStory";
import { setProjectId } from "@/lib/projectFetch";

export function Component() {
  return <AuthGate>{(signedIn) => <SimpleStory signedIn={signedIn} />}</AuthGate>;
}

function SimpleStory({ signedIn }) {
  const navigate = useNavigate();
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

  const start = async (prompt, seconds) => {
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
        // The gear's length: it wins over any length the prompt states.
        body: JSON.stringify(seconds ? { prompt, seconds } : { prompt }),
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

  return <SimpleView onSubmit={start} submitting={submitting} note={note} running={running} />;
}
