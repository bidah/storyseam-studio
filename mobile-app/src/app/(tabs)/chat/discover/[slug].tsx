import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles } from 'lucide-react-native';
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
const HERO_TRIM = 80;

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
      <Stack.Screen options={{ title: card.title }} />
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

        {/* Everything under the hero sits on the picture's own colour (the
            blurhash's average term — see lib/image-tint.ts), the same fill the
            card's caption block wears. That's what makes the zoom continuous:
            the poster grows into a bigger version of itself, colour and all. */}
        <View
          style={[styles.body, { backgroundColor: tint?.background ?? colors.pageBg }]}
        >
          <View className="gap-3 px-5 pt-6">
            <Text style={[styles.kicker, { color: tint?.subtle ?? colors.mutedForeground }]}>
              {card.kicker.toUpperCase()}
            </Text>
            <Text style={[styles.title, { color: tint?.foreground ?? colors.foreground }]}>
              {card.title}
            </Text>
            <Text style={[styles.copy, { color: tint?.subtle ?? colors.mutedForeground }]}>
              {card.body}
            </Text>
          </View>

          <View className="px-5 pt-7">
            <Button title="Start this" onPress={start} size="lg">
              <Sparkles size={18} color="#ecfdf5" />
            </Button>
            {/* Says what the button will actually do, because it doesn't open a
                form — it opens a conversation that has already started. */}
            <Text
              style={[styles.note, { color: tint?.subtle ?? colors.mutedForeground }]}
            >
              Opens a new chat with this brief already sent.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', backgroundColor: '#0b0b0c' },
  // Runs to the bottom of the scroll view, so the colour block ends with the
  // page rather than stopping under the last line of text.
  body: { flexGrow: 1, minHeight: 400, paddingBottom: 40 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 1.1 },
  title: { fontSize: 32, fontWeight: '700', lineHeight: 37, letterSpacing: -0.6 },
  copy: { fontSize: 16, lineHeight: 24 },
  note: { marginTop: 12, fontSize: 13, textAlign: 'center' },
});
