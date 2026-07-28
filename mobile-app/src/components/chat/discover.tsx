import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/lib/colors';
import { DISCOVER_BLURHASH } from '@/lib/discover';
import { useImageTint } from '@/lib/image-tint';
import { useDiscover, type DiscoverCard } from '@/lib/use-discover';

// The Chat landing screen's DISCOVER row: full-width posters under the
// horizontally scrolling "Continue building your story" deck. Wide on purpose —
// the big moves (see lib/discover.ts), and they get the page's whole width the
// way the small derived cards get a swipe.
//
// The press is a ZOOM: the poster expands into `chat/discover/[slug]`, whose
// hero is the same picture (Link.AppleZoomTarget over there). Three things make
// that work, and it silently degrades to a plain push if any is missing:
//
//   - `<Link asChild>` — required, not stylistic. Expo Router threads the zoom
//     through the HREF (it rewrites it with a source id the destination screen
//     reads back off its route params), so `router.push` gets no zoom at all,
//     and `Link.AppleZoom` THROWS without `asChild`.
//   - `<Link.AppleZoom>` takes exactly ONE child — more than one warns and
//     renders nothing — so the whole card is wrapped as a single view rather
//     than the image with the caption beside it. The card is what expands.
//   - iOS 18+. Off iOS the component is a passthrough, so Android just pushes.
//
// The card is deliberately built like a small copy of the screen it opens:
// picture on top, text block below it in the picture's OWN colour (see
// lib/image-tint.ts — the tint is the blurhash's average term). So the zoom has
// something to land on, and the colour continues across the transition instead
// of the poster dissolving into an unrelated page.
//
// No bouncy press wrapper here, unlike the small cards: a press-shrink transform
// would be fighting the zoom for the same frame, and the zoom IS the feedback.

// The poster's picture. 16:10 — a hair wider than the small cards' band, which
// at full width is a cinema frame rather than a banner.
const ART_RATIO = 16 / 10;

function DiscoverPoster({ card }: { card: DiscoverCard }) {
  // `card.blurhash` is set for the shipped hero (a build-time constant), absent
  // for project media — which then gets hashed after its first download, so the
  // blur-up and the tint show from the second sight onward.
  const { blurhash, tint } = useImageTint(card.image, card.blurhash);
  const colors = useColors();

  return (
    <Link
      href={{ pathname: '/(tabs)/chat/discover/[slug]', params: { slug: card.slug } }}
      asChild
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${card.title} — ${card.tagline}`}
        // Radix's Slot composes handlers, so this runs alongside the Link's own
        // navigation press rather than replacing it.
        onPress={() => Haptics.selectionAsync().catch(() => {})}
        style={styles.shadow}
      >
        <Link.AppleZoom>
          <View className="border border-border bg-card" style={styles.card}>
            <Image
              source={card.image ? { uri: card.image } : undefined}
              style={styles.art}
              contentFit="cover"
              contentPosition="center"
              cachePolicy="memory-disk"
              // The picture's own blur while it decodes, held at the same crop
              // as the picture so the two are the same frame — one blurs UP into
              // the other instead of cutting.
              placeholder={{ blurhash: blurhash ?? DISCOVER_BLURHASH }}
              placeholderContentFit="cover"
              transition={{ duration: 420, effect: 'cross-dissolve' }}
            />
            {/* Until the tint is known the block wears the app's own card
                colours, so nothing flashes unreadable on the way there. */}
            <View style={[styles.caption, { backgroundColor: tint?.background ?? colors.surface }]}>
              <Text
                style={[styles.kicker, { color: tint?.subtle ?? colors.mutedForeground }]}
                numberOfLines={1}
              >
                {card.kicker.toUpperCase()}
              </Text>
              <Text
                style={[styles.title, { color: tint?.foreground ?? colors.foreground }]}
                numberOfLines={2}
              >
                {card.title}
              </Text>
              <Text
                style={[styles.tagline, { color: tint?.subtle ?? colors.mutedForeground }]}
                numberOfLines={2}
              >
                {card.tagline}
              </Text>
            </View>
          </View>
        </Link.AppleZoom>
      </Pressable>
    </Link>
  );
}

export function DiscoverSection() {
  const cards = useDiscover();
  return (
    <View className="gap-3">
      {/* The same headline every section on the landing screen wears (see
          sectionTitle in app/(tabs)/chat/index.tsx), the project name at the top
          of the page included — the decks are peers, so nothing outranks. */}
      <Text accessibilityRole="header" className="px-5 text-foreground" style={styles.headline}>
        Discover
      </Text>
      <View style={styles.stack}>
        {cards.map((card) => (
          <DiscoverPoster key={card.slug} card={card} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Half the large title — kept in lockstep with smallTitle in
  // app/(tabs)/chat/index.tsx.
  headline: { fontSize: 20, fontWeight: '700', lineHeight: 25 },
  // The page margin lives here (matching the card rows above), and the posters
  // stack rather than scroll sideways.
  stack: { paddingHorizontal: 20, gap: 16 },
  // Same split as the small cards: the shadow on an outer wrapper, because the
  // card body clips to hold its corner radius and a clipping view drops its own
  // shadow on iOS.
  shadow: {
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
  },
  card: { borderRadius: 24, overflow: 'hidden' },
  art: { width: '100%', aspectRatio: ART_RATIO, backgroundColor: '#0b0b0c' },
  // The text block. Its colour comes from the picture above it, so the two read
  // as one object; the `bg-card` on the parent is what it falls back to for the
  // frame or two before the tint is known.
  caption: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 21, letterSpacing: -0.2, marginTop: 3 },
  tagline: { fontSize: 14, lineHeight: 18, marginTop: 2 },
});
