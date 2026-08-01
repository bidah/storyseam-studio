/**
 * The zoom's RETURN leg — what the landing row and the Story showcase have to
 * tell each other so that swiping back lands where the deck actually is.
 *
 * Going FORWARD is settled (see chat/showcase.tsx): the row's card flies into
 * the showcase, which opens already scrolled to it. Coming BACK the author is
 * usually somewhere else entirely — they flicked through four cards before
 * deciding to leave — and a pop is the same UIKit zoom run in reverse, which
 * means it needs the same two things the push needed, only mirrored:
 *
 *   1. the row behind must be SNAPPED to the card the showcase is showing, so
 *      there is an on-screen rect to fly into rather than one scrolled off the
 *      side (the exact failure the forward leg's `contentOffset` note describes);
 *   2. the transition must be POINTED at that card, because the source view is
 *      whichever <Link> was tapped — an identity minted at push time, and by now
 *      the wrong one.
 *
 * Both are cross-screen facts about views that are mounted at once (the showcase
 * is pushed onto the row's own stack), so they live here as a module rather than
 * in either screen's state: neither one owns the pair, and nothing about them
 * should survive a reload.
 *
 * (2) needs the identifier expo-router minted for each card's <Link>, which is a
 * `useId()` living in the link's own context. There is no public way to read it,
 * so each card reports its own on mount — see the beacon in chat/index.tsx.
 */

type Listener = (cardId: string) => void;

/** Card id → the zoom source identifier of the <Link> wrapping that card. */
const sourceIds = new Map<string, string>();

const listeners = new Set<Listener>();

/**
 * A landing card announces the zoom identity it was given. Returns the
 * unregister, so a card that leaves the deck takes its (now dead) view with it.
 */
export function registerZoomSource(cardId: string, identifier: string): () => void {
  sourceIds.set(cardId, identifier);
  return () => {
    // Only if it's still ours: a remount registers the new one first.
    if (sourceIds.get(cardId) === identifier) sourceIds.delete(cardId);
  };
}

/** The zoom identity of a card's row poster, if the row has rendered it. */
export function zoomSourceId(cardId: string): string | undefined {
  return sourceIds.get(cardId);
}

/** The showcase settled on a card — line the row up behind it. */
export function showcaseMovedTo(cardId: string): void {
  for (const listener of listeners) listener(cardId);
}

export function onShowcaseMove(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
