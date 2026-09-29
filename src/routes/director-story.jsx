// `/` — the SIMPLE view: the hero and one input. Nothing else.
//
// The input's Gen mode picks the pipeline (components/DirectorStory.jsx FLOWS):
// fal's H3 Director, or Seedance 2.5 (the story flow). It is remembered per
// browser; `?mode=seedance` (where /story-flow redirects) preselects it.
// (The file keeps its old name; the page moved from /director-story to `/`.)
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
  FLOWS,
  LatestStories,
  RESUME_PARAM,
  SignInDialog,
  SimpleView,
  StudioAgentCard,
  fetchLatest,
  filmPath,
  flowById,
  getJSON,
  readStoredFlow,
  savePendingStory,
  storeFlow,
  takePendingStory,
  clearStoryDraft,
  useDirectorProject,
} from "@/components/DirectorStory";
import { useSession } from "@/lib/auth-client";
import { useWaitlistAccess } from "@/lib/waitlist";
import { setProjectId } from "@/lib/projectFetch";
import { studioPath } from "@/lib/home";
import { MONO } from "@/lib/hudTheme";

export function Component() {
  return <StoryPage />;
}

/**
 * The simple view. The chosen FLOW (components/DirectorStory.jsx FLOWS) decides
 * the `engine` sent and the lengths offered.
 */
export function StoryPage() {
  const { data: session, isPending } = useSession();
  // Early access: a signed-in user counts as signed in here only once they're
  // known to be invited — one who isn't is hard-redirected to /waitlist by the
  // hook, and must not get a half-second of the project fetch and the resumed
  // premise first.
  const access = useWaitlistAccess();
  const signedIn = !!session && access === true;
  const sessionKnown = !isPending && (!session || access !== null);
  return <SimpleStory signedIn={signedIn} sessionKnown={sessionKnown} />;
}

function SimpleStory({ signedIn, sessionKnown }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [flow, setFlow] = useState(() => flowById(params.get("mode")) || readStoredFlow());
  const chooseFlow = (next) => {
    setFlow(next);
    storeFlow(next);
  };
  // `?mode=` is a one-shot: remember it, then drop it from the URL.
  useEffect(() => {
    if (!params.has("mode")) return;
    const asked = flowById(params.get("mode"));
    if (asked) storeFlow(asked);
    const next = new URLSearchParams(params);
    next.delete("mode");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [signInOpen, setSignInOpen] = useState(false);
  // Which door opened the dialog: a sent prompt (its premise is saved and
  // resumes) or the header's icon (nothing to resume).
  const [signInFromPrompt, setSignInFromPrompt] = useState(true);
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

  // opts: { seconds?, style?, resolution?, score?, music?, voices?, writer?, depth?, specialists? } — the input's settings.
  const start = async (prompt, opts = {}, as = flow) => {
    const { seconds, style, resolution, score, music, voices, writer, depth, specialists } = opts;
    if (submitting) return false;
    if (!signedIn) {
      // Keep the premise across the Google round trip; it starts on return.
      savePendingStory(as, prompt, opts);
      setSignInFromPrompt(true);
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
        // The flow's pipeline: the route is the choice.
        body: JSON.stringify({
          prompt,
          ...(seconds ? { seconds } : {}),
          ...(style ? { style } : {}),
          ...(as.engine ? { engine: as.engine } : {}),
          // The gear's resolution; absent is 480p.
          ...(resolution ? { resolution } : {}),
          // The gear's Score switch; only "off" is sent (absent is scored).
          ...(score === false ? { score: false } : {}),
          // The gear's score model; absent is MiniMax Music 3.
          ...(score !== false && music ? { music } : {}),
          // The gear's Voices pass (story engines only); absent runs none.
          ...(voices ? { voices } : {}),
          // The gear's writing model; absent is the studio's default.
          ...(writer ? { writer } : {}),
          // The writer button: a Deep Film sends its room along.
          ...(depth ? { depth } : {}),
          ...(depth && specialists ? { specialists } : {}),
        }),
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
      navigate(filmPath(id), { state: { engine: as.engine } });
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
    chooseFlow(pending.flow);
    setNote("Starting your story…");
    start(pending.prompt, pending.opts, pending.flow).then((ok) => { if (ok) clearStoryDraft(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKnown, signedIn]);

  // The studio road: a blank project under the name given, opened at its
  // studio root, where the author and the agent build it step by step.
  const launchStudio = async (name) => {
    const { res, data } = await getJSON("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok || !data.project?.id) throw new Error(data.error || `Couldn't create the project (${res.status}).`);
    setProjectId(data.project.id);
    navigate(studioPath(data.project.id, ""));
  };

  const openFilm = (film) => {
    if (film.projectId) setProjectId(film.projectId);
    navigate(filmPath(film.filmId), { state: { engine: film.engine || null } });
  };

  return (
    <>
      <SimpleView
        flow={flow}
        onFlow={chooseFlow}
        onSubmit={(prompt, opts) => start(prompt, opts)}
        submitting={submitting}
        note={note}
        running={running}
        // Under the box: an "or" rule, then the studio road, then Latest
        // stories. The rule and the page's gap-8 keep the card clearly apart
        // from the prompt box — it is the other way in, not an option of it.
        after={
          <div className="flex w-full flex-col">
            <div
              className="mb-8 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[var(--br-secondary)]"
              style={{ fontFamily: MONO }}
              aria-hidden
            >
              <span className="h-px flex-1 bg-[var(--br-secondary)]/30" />
              or
              <span className="h-px flex-1 bg-[var(--br-secondary)]/30" />
            </div>
            <StudioAgentCard
              signedIn={signedIn}
              onSignIn={() => { setSignInFromPrompt(false); setSignInOpen(true); }}
              onCreate={launchStudio}
            />
            {signedIn ? <LatestStories onPick={openFilm} /> : null}
          </div>
        }
        onSignIn={() => { setSignInFromPrompt(false); setSignInOpen(true); }}
      />
      <SignInDialog flow={flow} open={signInOpen} onOpenChange={setSignInOpen} withPremise={signInFromPrompt} />
    </>
  );
}
