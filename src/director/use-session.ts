import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDirectorSession,
  type DirectorSession,
  type Snapshot,
  type TransportFactory,
} from './session';
import type { Recipe, Screening } from '@/lib/series';

// The shared state machine, bound to a browser.
//
// The device's hook (`use-director-session.ts` in mobile-app) does the same job
// and cannot be imported here: it reaches for React Native's `AppState`. What
// that hook uses `AppState` FOR is the thing worth keeping — a session that
// outlives the intention that opened it is a session still being billed — so
// this one does the same with the browser's own signal.
//
// `visibilitychange` rather than `blur`. A tab switched away from, a window
// minimised, a laptop lid closed: all of them hide the document, and none of
// them is somebody watching. `blur` also fires when the user clicks the
// address bar, which is not a reason to end a sitting that cost a
// sixty-second minimum.

export type DirectorSessionHandle = Snapshot & {
  /** Whole seconds since play was pressed. Wall clock — for waiting, not film. */
  elapsedS: number;
  /**
   * Whole seconds of FILM, which is the clock a script is written on and the
   * one a sitting is billed by. It advances in the 5–15s steps that chunks
   * arrive in and stands still between them; while it is still, so is the
   * picture.
   */
  filmS: number;
  open: (showing: Screening | Recipe) => void;
  stop: () => void;
  direct: DirectorSession['direct'];
};

export function useDirectorSession(options: {
  transport: TransportFactory;
  /** Every control-channel message, forwarded — the recorder's cue list. */
  onEvent?: (event: { type: string; [k: string]: unknown }) => void;
}): DirectorSessionHandle {
  const { transport, onEvent } = options;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const session = useMemo(
    () =>
      createDirectorSession({
        transport,
        onEvent: (event) => onEventRef.current?.(event),
        // The Stage IS the developer surface — there is no separate admin
        // behind it — so the trace is always on. It is `console.debug`, which
        // a browser hides by default and shows when somebody goes looking.
        onTrace: (line) => console.debug(`[director:trace] ${line}`),
      }),
    [transport],
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [snapshot, setSnapshot] = useState<Snapshot>(session.snapshot);
  useEffect(() => {
    setSnapshot(session.snapshot);
    return session.subscribe(setSnapshot);
  }, [session]);

  // A hidden tab must not be streaming. Ending rather than pausing, because
  // there is no cheap way to hold a Director stream: coming back shows the
  // poster and a play button, since a restart has a price and the page does
  // not get to decide to pay it.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void sessionRef.current.stop();
    };
    document.addEventListener('visibilitychange', onHidden);
    // A closed tab gets no unmount. Without this the runner waits out its own
    // timeout, and that wait is billed.
    const onLeaving = () => void sessionRef.current.stop();
    window.addEventListener('pagehide', onLeaving);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onLeaving);
    };
  }, []);

  // And a component that goes away mid-stream takes its session with it.
  useEffect(() => () => void session.stop(), [session]);

  const running =
    snapshot.startedAt !== null && !['idle', 'ended', 'failed'].includes(snapshot.state);
  const [elapsedS, setElapsedS] = useState(0);
  useEffect(() => {
    if (!running || snapshot.startedAt === null) {
      setElapsedS(0);
      return;
    }
    const startedAt = snapshot.startedAt;
    const tick = () => setElapsedS(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [running, snapshot.startedAt]);

  const open = useCallback((showing: Screening | Recipe) => session.open(showing), [session]);
  const stop = useCallback(() => void session.stop(), [session]);
  const direct = useCallback<DirectorSession['direct']>(
    (prompt, extras) => session.direct(prompt, extras),
    [session],
  );

  return { ...snapshot, elapsedS, filmS: Math.floor(snapshot.videoSeconds), open, stop, direct };
}
