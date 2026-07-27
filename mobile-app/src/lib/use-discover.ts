import { useMemo } from 'react';
import { mediaUrl } from './api';
import { useProjectResource } from './queries';
import {
  DISCOVER,
  DISCOVER_HERO_BLURHASH,
  DISCOVER_HERO_REL,
  type DiscoverArt,
  type DiscoverEntry,
} from './discover';

// Hangs the project's own artwork on the Discover deck (see discover.ts).
//
// A Discover card is a picture first, and the picture should be THIS project's
// work: the newest concept frame for "Find the look", a storyboard still for
// "See it as boards". When a strand has produced nothing yet — and on a brand
// new project none of them have — the card falls back to the shipped hero
// rather than dropping out of the row, because the deck is editorial: these
// moves are worth showing before they've been made, not after.
//
// Two project resources, both shared: the same react-query keys the World and
// Episode tabs already fetch, so opening Chat after either of them is a cache
// read, and the SSE firehose invalidation that repaints those tabs repaints
// these cards too.

type VisualDoc = { generations?: { status?: string; url?: string }[] };
type Take = { url?: string; selected?: boolean };
type BoardDoc = { stills?: Record<string, Record<string, Take[]>> };

export type DiscoverCard = DiscoverEntry & {
  /** Ready-to-render URI — project media if there is any, else the hero. */
  image: string | undefined;
  /**
   * The picture's blurhash when it is already known — only the shipped hero,
   * whose hash is a build-time constant. Project media resolves its own after
   * first sight (see lib/image-tint.ts), so this is undefined for it.
   */
  blurhash: string | undefined;
  /** True when the picture is the project's own work, not the shipped hero. */
  fromProject: boolean;
};

// The worker `unshift`es new generations, so index 0 is the newest — take the
// first one that actually finished (a "processing" record has no bytes yet).
function newestVisual(doc: VisualDoc | undefined): string | null {
  const gen = doc?.generations?.find((g) => g.status === 'ready' && g.url);
  return gen?.url ?? null;
}

// `stills` is bundle → shot → takes, keyed by ids rather than ordered by time,
// so there is no "newest" to find. Walk it in key order and take the first
// SELECTED take (the one the episode would actually use), falling back to the
// first take of all — deterministic, which is what matters: the card must not
// swap its picture on every render.
function anyStill(doc: BoardDoc | undefined): string | null {
  const stills = doc?.stills;
  if (!stills) return null;
  let firstAny: string | null = null;
  for (const bundle of Object.keys(stills).sort()) {
    const shots = stills[bundle] ?? {};
    for (const shot of Object.keys(shots).sort()) {
      for (const take of shots[shot] ?? []) {
        if (!take?.url) continue;
        if (take.selected) return take.url;
        firstAny ??= take.url;
      }
    }
  }
  return firstAny;
}

export function useDiscover(): DiscoverCard[] {
  const visual = useProjectResource<VisualDoc>('visualWorld');
  const board = useProjectResource<BoardDoc>('storyboard');

  const art = useMemo<Record<Exclude<DiscoverArt, null>, string | null>>(
    () => ({ visual: newestVisual(visual.data), storyboard: anyStill(board.data) }),
    [visual.data, board.data],
  );

  return useMemo(
    () =>
      DISCOVER.map((entry) => {
        const rel = entry.art ? art[entry.art] : null;
        return {
          ...entry,
          image: mediaUrl(rel ?? DISCOVER_HERO_REL),
          blurhash: rel ? undefined : DISCOVER_HERO_BLURHASH,
          fromProject: !!rel,
        };
      }),
    [art],
  );
}

/** One card by slug, for the detail screen. Undefined for an unknown slug. */
export function useDiscoverEntry(slug: string | undefined): DiscoverCard | undefined {
  const cards = useDiscover();
  return cards.find((c) => c.slug === slug);
}
