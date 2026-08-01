import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import * as Haptics from 'expo-haptics';
import { CircleStop, Mic, Square, X } from 'lucide-react-native';
import { agentIsBusy, getAgent, useAgent } from '@/lib/agent/provider';
import { openForMode, useAgentMode } from '@/lib/agent/pill-mode';
import { useVoiceDuration, useVoicePhase, voiceCapture } from '@/lib/agent/voice-capture';
import { formatDuration } from '@/lib/use-audio-recording';
import { AgentModeToggle, PILL_CONTROL } from './agent-mode-toggle';
import { PulsingDot } from './pulsing-dot';
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
//     keyboard. Tapping instead OPENS THE CHAT — the whole conversation, with the
//     real <Composer> docked at the bottom and the caret already in it. (It used
//     to fade a composer-only overlay in over this spot, which put a bar on
//     screen with no transcript above it: a message to a conversation you
//     couldn't see, and no way to check on the turn you'd just sent.)
//   - Two copies exist at once. react-native-screens renders the accessory once
//     per placement (`regular` and `inline`) and switches between them by
//     toggling layer opacity — so local state is NOT shared between them, and
//     the hidden copy still hit-tests. Everything here therefore reads from
//     context (`useAgent`) rather than useState, and BOTH placements keep the
//     same controls in the same order so a tap that lands on the invisible copy
//     does exactly what the visible one promised.
//
// What the pill CAN do without a keyboard is listen. Its round button is a mic:
// a tap turns the pill into a recording bar in place (cancel · pulse · timer ·
// stop), and stopping transcribes and opens the chat with those words waiting in
// the composer — unsent. Sending stays a deliberate tap on a message you can see,
// which is also why the button was never a real send. The recorder itself lives
// in lib/agent/voice-capture.tsx, for the two-copies reason above.
//
// TWO DESTINATIONS, one pill. The leading slot is a write/image toggle
// (agent-mode-toggle.tsx) that points everything here — the body tap, the mic's
// hand-off — at either the studio agent's conversation or visual world's image
// generator, each presented as its own modal. Visual world used to be a segment
// inside the Story tab; making it a modal is what let this become the one place
// you reach for whether the next thing you want is words or a picture.
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
  // Words or pictures — which surface this pill opens, shared by both copies
  // (lib/agent/pill-mode.ts).
  const mode = useAgentMode();
  // SELECTED, both of them. This pill sits in the tab bar and is the only way
  // back into a running turn, so it is the last thing that should be re-rendering
  // several times a second while that turn streams — which is what a bare
  // `useAgent()` here used to do (see the note above useAgentBus). The busy flag
  // changes at most once per turn; the chat id and `stop` are read imperatively in
  // the handlers below, where no subscription is needed at all.
  const busy = useAgent(agentIsBusy);
  // Dictation state, shared by BOTH copies of this component (the recorder itself
  // is owned by <AccessoryVoiceHost /> — see lib/agent/voice-capture.tsx, which is
  // also why none of this is useState).
  const phase = useVoicePhase();
  const capturing = phase !== 'idle';
  const transcribing = phase === 'transcribing';

  // The accessory's own height is UIKit's to choose (it sizes the
  // UITabAccessory and pushes the frame back into the shadow tree), so nothing
  // here measures it. Screens that need to clear it read the tab's safe-area
  // bottom instead — see lib/use-tab-bar-inset.ts.

  // One destination per MODE, and in text mode it's the CURRENT session, opened
  // whole. Like a mini player: mid-turn it takes you to the conversation that's
  // streaming, and idle it takes you to the same one with the caret up, ready for
  // the next message. Nothing is minted on a tap; the project's active chat already
  // exists (`withActiveForProject`), blank if it has never been used. In image mode
  // it's visual world's generator — its gallery and its composer, over whichever tab
  // you're standing on.
  //
  // Both are MODALS, and that's the point: reaching either from Episode or Cuts
  // doesn't cost you the tab you were working in (lib/agent/pill-mode.ts).
  //
  // The keyboard comes up unless the agent is mid-turn: there you tapped this to
  // see how the work is going, and a keyboard would cover the reply landing. Image
  // mode has no turn to wait on, so it always opens ready to type.
  const open = () => {
    Haptics.selectionAsync().catch(() => {});
    openForMode(mode, { focus: mode === 'image' || !busy });
  };

  const stop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    getAgent()?.stop?.();
  };

  // The round button on the right is a MIC, not a send: the pill has nothing to
  // send from — no field, no attachments — so what it offers is the one thing you
  // can start without a keyboard. Tapping it turns the pill itself into the
  // recording bar (below); stopping opens the chat with the words already in the
  // composer, for the author to send. Every verb is guarded on phase inside the
  // host, so the invisible placement's copy of these buttons is harmless.

  // The label answers "what does tapping this do", so it follows the MODE — not
  // the agent's turn state, except in text mode where a running turn is what the
  // tap is about. Shorter in both modes than it used to be: the toggle now takes
  // the leading slot, so the label has a control beside it rather than a glyph.
  const label =
    mode === 'image'
      ? inline
        ? 'Image'
        : 'Describe an image…'
      : busy
        ? inline
          ? 'Working…'
          : 'Agent is working…'
        : inline
          ? 'Message'
          : 'Message the agent…';
  const glyph = inline ? 16 : 18;
  // Shared with the toggle at the other end of the row, which renders at exactly
  // this height — see PILL_CONTROL.
  const button = inline ? PILL_CONTROL.small : PILL_CONTROL.regular;
  // Stop belongs to a turn, and only text mode has one. In image mode the round
  // button stays the mic — but the spinner still rides beside the label, so
  // flipping to pictures never hides the fact that a turn is streaming.
  const showStop = busy && mode === 'text';

  return (
    // No glass of our own: UIKit already renders the accessory on a liquid-glass
    // platter, and a <GlassSurface> inside it would stack a second one.
    <Pressable
      // Mid-take the body is inert — the pill is a recorder right now, and opening
      // the chat under a running mic would leave the take orphaned behind a modal.
      // It stops being a button to VoiceOver too, so the cancel/stop pair inside
      // is what gets read instead of a target that no longer does anything.
      accessibilityRole={capturing ? undefined : 'button'}
      accessibilityLabel={
        capturing
          ? undefined
          : mode === 'image'
            ? 'Open visual world and generate an image'
            : busy
              ? 'Open the conversation the agent is working in'
              : 'Message the studio agent'
      }
      onPress={capturing ? undefined : open}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: inline ? 8 : 10,
        // Tight to the platter's edge on purpose. The toggle and the round mic
        // bookend this row, and every point of padding outside them is taken off
        // the label between them — which is the part that has something to say.
        // UIKit's glass platter already reads as the boundary, so the controls
        // don't need a margin to sit inside one.
        // Asymmetric by 2: the toggle is a segmented capsule whose own chrome
        // starts right at its edge, where the trailing button is a circle that
        // brings its own optical inset — so an equal padding leaves the left side
        // looking tighter than the right. This evens them up by eye.
        paddingLeft: inline ? 8 : 10,
        paddingRight: inline ? 6 : 8,
      }}
    >
      {capturing ? (
        <>
          {/* Same three slots as the idle pill — leading glyph, label, round
              button — so the take starting doesn't resize or reflow anything. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel recording"
            disabled={transcribing}
            onPress={() => voiceCapture.cancel()}
            style={{
              width: button,
              height: button,
              borderRadius: button / 2,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: c.border,
              opacity: transcribing ? 0.4 : 1,
            }}
          >
            <X size={glyph} color={c.mutedForeground} />
          </Pressable>

          <View className="flex-1 flex-row items-center gap-2" pointerEvents="none">
            {transcribing ? (
              <ActivityIndicator size="small" color={c.mutedForeground} />
            ) : (
              <PulsingDot />
            )}
            <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>
              {transcribing ? 'Transcribing…' : 'Recording…'}
            </Text>
            {!transcribing ? <Timer /> : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
            disabled={transcribing}
            onPress={() => voiceCapture.stop()}
            style={{
              width: button,
              height: button,
              borderRadius: button / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: c.higgsfield,
              opacity: transcribing ? 0.4 : 1,
            }}
          >
            <Square
              size={glyph - 4}
              color={c.higgsfieldForeground}
              fill={c.higgsfieldForeground}
            />
          </Pressable>
        </>
      ) : (
        <>
          {/* Write | Image — what this pill is pointed at, and the only way into
              visual world now that it's a modal rather than a Story segment. Its
              own tap targets, so it sits INSIDE the pill's press area without
              being swallowed by it. */}
          <AgentModeToggle variant="pill" compact={inline} />

          {busy ? <ActivityIndicator size="small" color={c.mutedForeground} /> : null}

          <Text
            className="flex-1 text-[15px] text-muted-foreground"
            numberOfLines={1}
            // The pill is one target; the label must not eat the press.
            pointerEvents="none"
          >
            {label}
          </Text>

          {/* Same slot in every state so the two placements' controls line up:
              stop while a turn is in flight, otherwise the mic that starts a
              take right here (the pill can't send — see the note above). */}
          {showStop ? (
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                mode === 'image'
                  ? 'Dictate an image prompt'
                  : 'Record a message for the studio agent'
              }
              onPress={() => voiceCapture.start()}
              style={{
                width: button,
                height: button,
                borderRadius: button / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: c.higgsfield,
              }}
            >
              <Mic size={glyph} color={c.higgsfieldForeground} />
            </Pressable>
          )}
        </>
      )}
    </Pressable>
  );
}

// The take's running time. Its own component so the 1s tick re-renders THIS
// text and nothing else — the pill above it holds the only route back into a
// streaming turn and has no business re-rendering once a second.
function Timer() {
  const duration = useVoiceDuration();
  return (
    <Text className="ml-auto text-[13px] tabular-nums text-muted-foreground">
      {formatDuration(duration)}
    </Text>
  );
}
