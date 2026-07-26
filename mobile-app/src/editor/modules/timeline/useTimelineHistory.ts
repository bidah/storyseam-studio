// Timeline state + undo history + dirty tracking, in one hook. React Native port
// of web-editor/src/modules/timeline/useTimelineHistory.js.
//
// The state pattern is IDENTICAL to web (clone-and-snapshot undo, gesture
// bracketing so a whole drag is ONE undo). The only difference: the web version
// closes a gesture on a `window` "pointerup" event; RN has no window, so gesture
// handlers call `endGesture()` explicitly on `Gesture.onEnd`. Hermes may lack
// `structuredClone`, so we clone via JSON (snapshots are JSON anyway).
//
//   mutate(fn, silent)   – apply fn(clone) and mark dirty. `silent` skips the
//                          undo snapshot (per-frame updates inside a gesture).
//   beginGesture()       – open a gesture: snapshot once, then stay silent.
//   endGesture()         – close the gesture (call from Gesture.onEnd).
//   pushHistory()        – snapshot the current timeline unconditionally.
//   undo()               – restore the last snapshot (calls opts.onUndo after).
//   setTimeline(tl,{dirty}) – replace the timeline (load/from-cut set dirty=false).
//   resetHistory()       – clear the stack (after a load).
import { useCallback, useEffect, useRef, useState } from "react";
import type { Timeline } from "@/editor/core/timeline";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export interface TimelineHistory {
  timeline: Timeline | null;
  setTimeline: (tl: Timeline | null, opts?: { dirty?: boolean }) => void;
  timelineRef: React.RefObject<Timeline | null>;
  dirtyRef: React.RefObject<boolean>;
  inGestureRef: React.RefObject<boolean>;
  canUndo: boolean;
  pushHistory: () => void;
  beginGesture: () => void;
  endGesture: () => void;
  /** Close a gesture that turned out to be a NO-OP (drag released at the same
   *  frame, trim back to the same length): drops the snapshot `beginGesture`
   *  pushed so Undo isn't buried under do-nothing entries. */
  cancelGesture: () => void;
  mutate: (fn: (tl: Timeline) => Timeline, silent?: boolean) => void;
  undo: () => void;
  resetHistory: () => void;
}

export function useTimelineHistory({ onUndo }: { onUndo?: () => void } = {}): TimelineHistory {
  const [timeline, setTimelineState] = useState<Timeline | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const timelineRef = useRef<Timeline | null>(null);
  const histRef = useRef<string[]>([]); // undo stack of JSON snapshots
  const dirtyRef = useRef(false); // suppress autosave right after a fetch
  const inGestureRef = useRef(false); // true between gesture begin and end

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const pushHistory = useCallback(() => {
    const cur = timelineRef.current;
    if (!cur) return;
    histRef.current.push(JSON.stringify(cur));
    if (histRef.current.length > 80) histRef.current.shift();
    setCanUndo(true);
  }, []);

  const beginGesture = useCallback(() => {
    if (inGestureRef.current) return;
    inGestureRef.current = true;
    pushHistory();
  }, [pushHistory]);

  // RN equivalent of the web window "pointerup" handler: gesture recognizers
  // call this on `.onEnd`/`.onFinalize` so the NEXT drag records its own undo.
  const endGesture = useCallback(() => {
    inGestureRef.current = false;
  }, []);

  const cancelGesture = useCallback(() => {
    if (!inGestureRef.current) return;
    inGestureRef.current = false;
    histRef.current.pop();
    setCanUndo(histRef.current.length > 0);
  }, []);

  const mutate = useCallback(
    (fn: (tl: Timeline) => Timeline, silent?: boolean) => {
      dirtyRef.current = true;
      if (!silent) pushHistory();
      setTimelineState((prev) => (prev ? fn(clone(prev)) : prev));
    },
    [pushHistory],
  );

  const setTimeline = useCallback((tl: Timeline | null, { dirty = true }: { dirty?: boolean } = {}) => {
    dirtyRef.current = dirty;
    setTimelineState(tl);
  }, []);

  const resetHistory = useCallback(() => {
    histRef.current = [];
    setCanUndo(false);
  }, []);

  const undo = useCallback(() => {
    const snap = histRef.current.pop();
    if (!snap) return;
    dirtyRef.current = true;
    setTimelineState(JSON.parse(snap));
    setCanUndo(histRef.current.length > 0);
    onUndo?.();
  }, [onUndo]);

  return {
    timeline,
    setTimeline,
    timelineRef,
    dirtyRef,
    inGestureRef,
    canUndo,
    pushHistory,
    beginGesture,
    endGesture,
    cancelGesture,
    mutate,
    undo,
    resetHistory,
  };
}
