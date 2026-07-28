import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { useChatComposer } from '@/components/chat/composer-host';
import { useConversations, useIsFreshChat } from '@/lib/agent/provider';
import { setPendingDraft } from '@/lib/agent/pending-draft';
import { useColors } from '@/lib/colors';
import { DISCOVER_BLURHASH } from '@/lib/discover';
import { useImageTint } from '@/lib/image-tint';
import { useDiscoverEntry } from '@/lib/use-discover';

// One Discover poster, opened. The card on the landing screen ZOOMS into this
// screen (Link.AppleZoom over there, iOS 18+) — which is the whole reason the
// hero below is wrapped in `<Link.AppleZoomTarget>`: it tells UIKit which rect
// the card should land on, so the picture flies into place instead of the card
// expanding into the screen as a whole.
//
// The screen is a poster and one decision: what this move is, and a button that
// starts it. The chat composer is deliberately absent (see the `hidden`
// registration below) — a second way to start would just cover the picture.

// The hero eats most of the screen. It runs under the transparent header
// (`contentInsetAdjustmentBehavior="never"`), so the bar's glass has a picture
// to refract on the way in. The flat trim pulls the ratio back so the text
// block clears the fold — at the bare ratio the picture crowded the copy out.
const HERO_RATIO = 0.62;
const HERO_TRIM = 170;

export default function DiscoverDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const card = useDiscoverEntry(slug);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  // Same hook the card used, and the hero is the same URI — so the hash is
  // already in the session cache and the colour is there on the first frame of
  // the zoom rather than snapping in once the screen has landed.
  const { blurhash, tint } = useImageTint(card?.image, card?.blurhash);
  // The two text colours the whole article is set in — from the picture when its
  // tint is known, from the theme until then.
  const foreground = tint?.foreground ?? colors.foreground;
  const subtle = tint?.subtle ?? colors.mutedForeground;
  const conv = useConversations();
  const reusable = useIsFreshChat();

  // The composer belongs to the stack, not to a screen (see composer-host), so
  // opting out is a registration like any other rather than something this
  // screen can just not render.
  useChatComposer(
    useMemo(
      () => ({ pending: false, busy: false, hidden: true, onStop: () => {}, onSubmit: async () => {} }),
      [],
    ),
  );

  // Same handoff the landing screen's cards use: mint (or reuse) a chat, park
  // the brief where the conversation screen will pick it up, and go. REPLACE
  // rather than push — this screen is the doorway, not a step you back through
  // on the way out of the conversation.
  const start = useCallback(() => {
    if (!card) return;
    const id: string = reusable && conv.activeId ? conv.activeId : conv.newChat();
    setPendingDraft(id, { text: card.prompt, attachments: [] });
    router.replace(`/(tabs)/chat/${id}`);
  }, [card, conv, reusable]);

  if (!card) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Discover' }} />
        <Empty title="Nothing here" hint="This card no longer exists." />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* No title in the bar — the masthead a few points below already carries
          the headline, and a second copy of it riding over the picture just
          doubles up. What's left is chrome: the back chevron and the menu. */}
      <Stack.Screen options={{ title: '' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <Link.AppleZoomTarget>
          <Image
            source={card.image ? { uri: card.image } : undefined}
            style={[styles.hero, { height: Math.round(height * HERO_RATIO) - HERO_TRIM }]}
            contentFit="cover"
            contentPosition="center"
            cachePolicy="memory-disk"
            // The picture's own blur, at the picture's own crop — the hero
            // resolves out of it rather than appearing over a flat plate.
            placeholder={{ blurhash: blurhash ?? DISCOVER_BLURHASH }}
            placeholderContentFit="cover"
            transition={{ duration: 420, effect: 'cross-dissolve' }}
          />
        </Link.AppleZoomTarget>

        {/* The MASTHEAD carries the picture's own colour (the blurhash's average
            term — see lib/image-tint.ts), the same fill the card's caption block
            wears. That's what makes the zoom continuous: the poster grows into a
            bigger version of itself, colour and all — and then the colour stops.
            Only the headline block is tinted; the story below it runs on the
            page, which is what keeps a long read legible instead of setting
            three screens of body copy on an arbitrary photographic colour. */}
        <View
          className="gap-2 px-5 pb-6 pt-6"
          style={{ backgroundColor: tint?.background ?? colors.pageBg }}
        >
          <Text style={[styles.kicker, { color: subtle }]}>{card.kicker.toUpperCase()}</Text>
          <Text style={[styles.title, { color: foreground }]}>{card.title}</Text>
          <Text style={[styles.standfirst, { color: subtle }]}>{card.tagline}</Text>
        </View>

        {/* The story, set like an App Store Today piece: one paragraph whose
            opening phrase is bold and in the page's foreground colour, running
            STRAIGHT INTO the body text rather than sitting over it — hence a
            nested <Text>, which inherits the parent's line box so the two
            weights share a single flowing paragraph. Then heading-over-paragraph
            the rest of the way down, all in the app's own text colours. */}
        <View style={[styles.body, { backgroundColor: colors.pageBg }]}>
          <View className="px-5 pt-7">
            <Text style={[styles.lead, { color: colors.mutedForeground }]}>
              <Text style={[styles.leadOpener, { color: colors.foreground }]}>
                {card.lead.opener}
              </Text>
              {card.lead.rest}
            </Text>

            {card.sections.map((s) => (
              <View key={s.heading}>
                <Text style={[styles.heading, { color: colors.foreground }]}>{s.heading}</Text>
                <Text style={[styles.copy, { color: colors.mutedForeground }]}>{s.body}</Text>
              </View>
            ))}
          </View>

          <View className="px-5 pt-9">
            <Button title="Try this" onPress={start} size="lg" />
            {/* Says what the button will actually do, because it doesn't open a
                form — it opens a conversation that has already started. */}
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Opens a new chat with this brief already sent.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// Editorial type scale, one step up from the app's UI type: this screen is
// something to READ, and body copy set at row-label size reads as a caption. The
// leading is generous for the same reason — long paragraphs need the air.
const styles = StyleSheet.create({
  hero: { width: '100%', backgroundColor: '#0b0b0c' },
  // Runs to the bottom of the scroll view, so the colour block ends with the
  // page rather than stopping under the last line of text.
  body: { flexGrow: 1, paddingBottom: 40 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 1.1 },
  title: { fontSize: 32, fontWeight: '700', lineHeight: 37, letterSpacing: -0.6 },
  standfirst: { fontSize: 17, lineHeight: 23 },
  lead: { fontSize: 19, lineHeight: 27 },
  // Same size and leading as the paragraph it opens — only the weight and the
  // colour change, or the two halves stop being one sentence.
  leadOpener: { fontSize: 19, lineHeight: 27, fontWeight: '700' },
  heading: { fontSize: 22, fontWeight: '700', lineHeight: 27, marginTop: 30, marginBottom: 8 },
  copy: { fontSize: 18, lineHeight: 26 },
  note: { marginTop: 12, fontSize: 13, textAlign: 'center' },
});
