// /director-story/create/:filmId — the STORY view of ONE Film.
//
// The URL is the state: the page reads its Film by id (GET /api/auto/films/:id
// — the running job, a queued one, or a finished/stopped one from the
// project's history), so a reload anywhere in a run lands back here, on the
// same Film. Live updates ride the project's `data` channel (<LiveSync>),
// filtered to this Film's id, with a slow poll as the backstop while it is
// running or queued.
//
// A Film id belongs to ONE project. If this project has no such Film (the
// author switched projects in the studio, or the link is someone else's) the
// page says so and offers a new story — it never crashes.
//
// No loading screen: the steps render at once, all waiting, and fill in when
// the job arrives. The shared pieces live in components/DirectorStory.jsx.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import {
  ACTIVE,
  AuthGate,
  LiveSync,
  PATH,
  POLL_MS,
  Page,
  StoryView,
  fetchFilm,
  retryFilm,
  useDirectorProject,
} from "@/components/DirectorStory";
import { MONO } from "@/lib/hudTheme";

// Keep polling while the Film is being made, waiting its turn, or not read yet.
const POLLED = new Set([...ACTIVE, "queued", "loading"]);

export function Component() {
  return <AuthGate>{(signedIn) => <FilmStory signedIn={signedIn} />}</AuthGate>;
}

function FilmStory({ signedIn }) {
  const { filmId } = useParams();
  const navigate = useNavigate();
  const { projectId, error } = useDirectorProject(signedIn);
  // `undefined` = not read yet; `null` = not in this project.
  const [job, setJob] = useState(undefined);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchFilm(filmId);
      setJob(next);
    } catch { /* the next event or poll tries again */ }
  }, [filmId]);

  // A new id in the URL (a submit from here, or history navigation) starts over.
  useEffect(() => { setJob(undefined); setRetryError(null); }, [filmId]);

  useEffect(() => {
    if (projectId) refresh();
  }, [projectId, refresh]);

  // Live updates: every step transition carries the whole public job. A frame
  // about THIS Film that carries another job (it was queued behind that one)
  // means our position may have moved — read it again.
  const onEvent = (last) => {
    if (last?.resource !== "auto") return;
    if (last.job?.id === filmId) setJob(last.job);
    else if (last.filmId === filmId || job?.status === "queued") refresh();
  };

  const status = job === undefined ? "loading" : job?.status;
  const polled = !!projectId && POLLED.has(status);
  useEffect(() => {
    if (!polled) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [polled, refresh]);

  const onNew = () => navigate(PATH);

  // Retry a stopped Film from its failed step: the answer is the running job,
  // so the failed step flips back to running at once; the live events and the
  // poll carry it on from there. A refusal replaces the stopped line.
  const onRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const next = await retryFilm(filmId);
      if (next) setJob(next);
      else refresh();
    } catch (err) {
      setRetryError(err.message);
    } finally {
      setRetrying(false);
    }
  };

  if (job === null) return <Stranded message="This story isn't in your current project." />;
  if (error && job === undefined) return <Stranded message={error} />;

  return (
    <>
      {projectId ? <LiveSync key={projectId} onEvent={onEvent} onResync={refresh} /> : null}
      <StoryView
        job={job || { id: filmId, prompt: "", status: "loading", steps: [] }}
        onNew={onNew}
        onRetry={onRetry}
        retrying={retrying}
        retryError={retryError}
      />
    </>
  );
}

function Stranded({ message }) {
  return (
    <Page className="items-center justify-center px-4">
      <main className="flex max-w-md flex-col items-center gap-5 text-center" data-not-found>
        <p className="text-base">{message}</p>
        <Link
          to={PATH}
          className="flex items-center gap-1.5 border border-[var(--br-secondary)]/40 px-3 py-1.5 text-[0.72rem] uppercase text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)]"
          style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
        >
          <Plus size={12} aria-hidden /> New story
        </Link>
      </main>
    </Page>
  );
}
