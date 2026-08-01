/**
 * How the phone builds the deck: EVERYTHING, live cards first, finished ones
 * badged at the end.
 *
 * `buildSuggestions` defaults to 6 live cards and 3 completed ones — caps that
 * were written for the web landing panel, a 2×2 grid with room for four tiles.
 * The phone has no such ceiling: the landing row scrolls sideways forever and
 * the showcase is one card per screenful, so a cap there doesn't tidy the deck,
 * it hides work the author still has to do — and it truncates the completed
 * tail, which is the only place the app says "you did this".
 *
 * Shared by both surfaces on purpose. The showcase opens on the card the
 * landing row was tapped (`initialScrollIndex`), so the two decks have to BE
 * the same list — a different cap on either side would land the zoom on a
 * different card than the one it flew out of.
 *
 * This does NOT uncap the script doctors: `deriveCards` still admits at most
 * two unread reviews and one stale one, so six near-identical "run the X
 * doctor" cards can't crowd out the rest of the pipeline.
 */
export const FULL_DECK = { max: Infinity, maxCompleted: Infinity } as const;
