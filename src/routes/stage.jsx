import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  AlertTriangle, CircleDot, Clock, Film, Play, Square, Trash2,
} from "lucide-react";
import { invalidateTabCache } from "@/lib/tabCache";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { useFalKey } from "@/lib/falKey";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, Panel, ErrorNote, Eyebrow, fmtTime } from "@/components/shared";
import { stageTransport } from "@/director/transport";
import { useDirectorSession } from "@/director/use-session";
import { useStageRecorder } from "@/director/use-recorder";

/* ------------------------------------------------------------------ *
 * The Stage — where a Series becomes a film.                          *
 *                                                                     *
 * Three facts shape every decision on this screen:                    *
 *                                                                     *
 *   1. A sitting BILLS FROM ITS FIRST SECOND, with a sixty-second     *
 *      minimum — and a session the endpoint refuses at the door bills *
 *      that minimum for nothing. So the refusals are shown before the *
 *      play button, not after it.                                     *
 *   2. Two sittings of one Series are DIFFERENT FILMS. The endpoint   *
 *      is not deterministic, so "try again" is a second purchase, and *
 *      the word "retry" never appears here.                           *
 *   3. A sitting that is not recorded AS IT PLAYS cannot be           *
 *      recovered. fal keeps nothing. So the recorder is armed by the  *
 *      session, not by a button somebody can forget to press.         *
 * ------------------------------------------------------------------ */

async function stageApi(url, opts) {
  const res = await fetch(url, {
    headers: opts?.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

/* ---- the picture --------------------------------------------------------- */

function Picture({ stream, aspectRatio, holding }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream ?? null;
    if (stream) el.play().catch(() => {});
  }, [stream]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-border bg-black"
      style={{ aspectRatio: aspectRatio === "9:16" ? "9 / 16" : "16 / 9" }}
    >
      <video ref={ref} playsInline muted={false} className="h-full w-full object-contain" />
      {/* A held picture is not a stalled one — the chunk that would have moved
          it is late. Saying which is the difference between waiting and
          reloading the page. */}
      {holding ? (
        <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-amber-300">
          holding — the next chunk is late
        </div>
      ) : null}
    </div>
  );
}

/* ---- kept sittings ------------------------------------------------------- */

function Sittings({ kept, onForget, busy }) {
  if (!kept.length) {
    return (
      <Empty>
        Nothing kept yet. A sitting is recorded as it plays — it cannot be fetched afterwards.
      </Empty>
    );
  }
  return (
    <div className="space-y-2">
      {kept.map((s) => (
        <div key={s.id} className="rounded-md border border-border p-2">
          <video src={s.scoredUrl || s.url} controls className="w-full rounded" preload="metadata" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm">{s.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {fmtTime(s.seconds || 0)} · {new Date(s.recordedAt).toLocaleString()}
                {s.scoredUrl ? " · scored" : ""}
              </div>
            </div>
            <button
              type="button"
              aria-label="Forget this sitting"
              title="Forget this sitting — the file stays"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onForget(s.id)}
              disabled={busy}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- the tab ------------------------------------------------------------- */

function StageTab() {
  const initial = useLoaderData();
  const { revalidate } = useRevalidator();
  useRevalidateOnMount("stage");
  const falKey = useFalKey();

  const [seriesId, setSeriesId] = useState(initial.selectedId);
  const [plan, setPlan] = useState(null);
  const [issues, setIssues] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // One transport per credential. Rebuilding it mid-sitting would drop the
  // connection, so it is memoised on the only thing it depends on.
  const transport = useMemo(() => stageTransport(falKey || null), [falKey]);
  const session = useDirectorSession({ transport });

  const recorder = useStageRecorder({
    seriesId: seriesId || "",
    stream: session.stream ?? null,
    filmSeconds: () => session.filmS,
  });

  // The recorder is driven BY the session rather than by a button: a sitting
  // that was not being written as it arrived is a sitting that is simply gone.
  useEffect(() => { recorder.sync(session.state); }, [session.state, recorder]);

  // A film that lands in the bucket is a row the rail has not read yet.
  useEffect(() => {
    if (!recorder.kept) return;
    invalidateTabCache("stage");
    revalidate();
  }, [recorder.kept, revalidate]);

  const load = useCallback(async (id) => {
    if (!id) { setPlan(null); return; }
    setError("");
    try {
      const [showing, view] = await Promise.all([
        stageApi(`/api/stage/series/${encodeURIComponent(id)}`),
        stageApi(`/api/director/series/${encodeURIComponent(id)}`),
      ]);
      setPlan(showing);
      setIssues(view.issues || {});
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(seriesId); }, [seriesId, load]);

  // Anything that is not idle or finished is a session that is BILLING, which
  // is what the stop button has to be available for — not just the state where
  // a picture happens to be on screen.
  const OPEN = ["opening", "configuring", "buffering", "live", "closing"];
  const live = OPEN.includes(session.state);
  const refusals = Object.entries(issues);
  const ready = plan && refusals.length === 0;

  const forget = async (id) => {
    setBusy(true);
    try {
      await stageApi(`/api/stage/sittings/${encodeURIComponent(id)}`, { method: "DELETE" });
      invalidateTabCache("stage");
      revalidate();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Film size={18} />
        <h1 className="text-lg font-semibold">Stage</h1>
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={seriesId || ""}
          onChange={(e) => setSeriesId(e.target.value)}
          disabled={live}
        >
          <option value="">Pick a Series…</option>
          {(initial.series || []).map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {refusals.length ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-500">
            <AlertTriangle size={13} />
            This sitting would be refused at the door — and billed anyway
          </div>
          {refusals.map(([field, message]) => (
            <p key={field} className="text-sm text-muted-foreground">{message}</p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <Picture
            stream={session.stream ?? null}
            aspectRatio={plan?.aspectRatio}
            holding={session.holding}
          />

          <div className="flex flex-wrap items-center gap-3">
            {live ? (
              <Button variant="destructive" onClick={session.stop}>
                <Square size={14} /> Stop
              </Button>
            ) : (
              <Button
                disabled={!ready}
                onClick={() => {
                  // The whole screening — `configure`, then each appended reel
                  // — rather than the recipe alone, so a sheet cut into reels
                  // plays as one film.
                  session.open({
                    configure: plan.configure,
                    reels: plan.reels,
                    filmSeconds: plan.filmSeconds,
                  });
                }}
              >
                <Play size={14} /> Play
              </Button>
            )}

            {plan ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock size={12} />
                {fmtTime(session.filmS)} of ~{fmtTime(plan.filmSeconds)} film
                {session.elapsedS ? ` · ${fmtTime(session.elapsedS)} elapsed` : ""}
              </span>
            ) : null}

            {recorder.recording ? (
              <Badge variant="warning" className="gap-1">
                <CircleDot size={11} /> recording
              </Badge>
            ) : null}
            {recorder.status ? (
              <span className="text-xs text-muted-foreground">{recorder.status}</span>
            ) : null}
          </div>

          {session.message ? <p className="text-sm">{session.message}</p> : null}
          {session.detail ? (
            <p className="font-mono text-xs text-muted-foreground">{session.detail}</p>
          ) : null}

          {!falKey ? (
            <p className="text-xs text-muted-foreground">
              A sitting is billed to your own fal key — add it in Settings.
            </p>
          ) : null}

          {plan?.reels?.length ? (
            <p className="text-xs text-muted-foreground">
              {plan.reels.length + 1} reels. The reel change is visible, like a projectionist’s:
              it lands on a chunk boundary after the previous reel’s last beat.
            </p>
          ) : null}
        </div>

        <Panel>
          <div className="space-y-3">
            <Eyebrow>Kept sittings</Eyebrow>
            <Sittings kept={initial.kept || []} onForget={forget} busy={busy} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function loader() {
  return swr("stage", async () => {
    const [dir, sittings] = await Promise.all([
      fetch("/api/director").then((r) => r.json()),
      fetch("/api/stage/sittings").then((r) => r.json()),
    ]);
    if (dir.error) throw new Error(dir.error);
    return { ...dir, kept: sittings.kept || [] };
  });
}

export function Component() {
  return <StageTab />;
}
