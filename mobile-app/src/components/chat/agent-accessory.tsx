import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import * as Haptics from 'expo-haptics';
import { ArrowUp, CircleStop, MessageSquareText } from 'lucide-react-native';
import { agentIsBusy, useAgent } from '@/lib/agent/provider';
import { requestComposerFocus } from '@/lib/agent/composer-focus';
import { useChatColors } from './theme';

// The studio agent's presence in the tab bar — a UITabAccessory (iOS 26+) that
// rides ABOVE the tab bar and therefore outlives tab switches, the way Music's
// mini player does. Mounted from src/app/(tabs)/_layout.tsx.
//
// It is a PILL, not the composer. Two things make that the only workable shape:
//
//   - No keyboard avoidance. The accessory lives in the tab bar's frame and
//     nothing (UIKit or react-native-screens) lifts it when the keyboard comes
//     up, so a live <TextInput> here would be typed into from under the
//     keyboard. Tapping hands off to the real <Composer> on the chat tab
//     instead (see lib/agent/composer-focus.ts).
//   - Two copies exist at once. react-native-screens renders the accessory once
//     per placement (`regular` and `inline`) and switches between them by
//     toggling layer opacity — so local state is NOT shared between them, and
//     the hidden copy still hit-tests. Everything here therefore reads from
//     context (`useAgent`) rather than useState, and BOTH placements keep the
//     same controls in the same order so a tap that lands on the invisible copy
//     does exactly what the visible one promised.
//
// The `inline` variant below is the SHRUNKEN form UIKit lays out once the tab
// bar minimizes on scroll. It is written and ready but currently unreachable —
// react-native-screens can't get UIKit to track a scroll view nested in a
// native stack, so the bar never minimizes; see the `minimizeBehavior` note in
// app/(tabs)/_layout.tsx. Keep both placements in step so the day that lands,
// the small form is already right.
export function AgentAccessory() {
  // Each copy reports its OWN placement (a fixed value per copy), not whichever
  // one is currently on screen — see the note above.
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const inline = placement === 'inline';
  const c = useChatColors();
  const agent = useAgent();
  const busy = agentIsBusy(agent);

  // The accessory's own height is UIKit's to choose (it sizes the
  // UITabAccessory and pushes the frame back into the shadow tree), so nothing
  // here measures it. Screens that need to clear it read the tab's safe-area
  // bottom instead — see lib/use-tab-bar-inset.ts.

  // Mid-turn the pill behaves like a mini player: it takes you to the
  // conversation that's streaming. Otherwise it's "start writing" — the chat
  // tab's landing screen, with its composer focused.
  const open = () => {
    Haptics.selectionAsync().catch(() => {});
    if (busy && agent?.chatId) {
      router.navigate(`/(tabs)/chat/${agent.chatId}`);
      return;
    }
    requestComposerFocus();
    router.navigate('/(tabs)/chat');
  };

  const stop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    agent?.stop?.();
  };

  const label = busy
    ? inline
      ? 'Working…'
      : 'Agent is working…'
    : inline
      ? 'Message the agent'
      : 'Message the studio agent…';
  const glyph = inline ? 16 : 18;
  const button = inline ? 30 : 34;

  return (
    // No glass of our own: UIKit already renders the accessory on a liquid-glass
    // platter, and a <GlassSurface> inside it would stack a second one.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? 'Open the conversation the agent is working in' : 'Message the studio agent'}
      onPress={open}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: inline ? 8 : 10,
        paddingHorizontal: inline ? 12 : 16,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={c.mutedForeground} />
      ) : (
        <MessageSquareText size={glyph} color={c.mutedForeground} />
      )}

      <Text
        className="flex-1 text-[15px] text-muted-foreground"
        numberOfLines={1}
        // The pill is one target; the label must not eat the press.
        pointerEvents="none"
      >
        {label}
      </Text>

      {/* Same slot in both states so the two placements' controls line up:
          stop while a turn is in flight, otherwise the composer's send button
          echoed as an affordance (it opens the composer like the rest of the
          pill — there is nothing to send from here). */}
      {busy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          onPress={stop}
          style={{
            width: button,
            height: button,
            borderRadius: button / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.muted,
          }}
        >
          <CircleStop size={glyph} color={c.foreground} />
        </Pressable>
      ) : (
        <View
          style={{
            width: button,
            height: button,
            borderRadius: button / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.higgsfield,
          }}
          pointerEvents="none"
        >
          <ArrowUp size={glyph} color={c.higgsfieldForeground} />
        </View>
      )}
    </Pressable>
  );
}
