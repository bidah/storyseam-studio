import * as Haptics from 'expo-haptics';
import { View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { openForMode, setAgentMode, useAgentMode, type AgentMode } from '@/lib/agent/pill-mode';
import { agentIsBusy, getAgent } from '@/lib/agent/provider';
import { useChatColors } from './theme';

// THE TOGGLE. Two icons — write and image — that choose what the tab bar's pill
// is for, and with it which surface a tap opens: the studio agent's conversation
// or visual world's image generator (see lib/agent/pill-mode.ts).
//
// ON THE PILL IT ONLY POINTS. Picking a segment flips the mode and stops there;
// the pill's label is the feedback ("Message the agent…" ⇄ "Describe an image…")
// and the body tap beside it is what opens the surface. It used to present the
// modal in the same tap, on the theory that a mode you then have to act on leaves
// the author holding a setting instead of a screen — but aiming and going are
// separable gestures, and fusing them meant every stray tap on the toggle threw a
// modal over the tab you were reading. It also put a presentation on the same
// tap as a native control's own selection animation, which is where the modal
// occasionally stuck on screen and refused to dismiss. Nothing is lost by
// splitting them: the pill body is a big target one glyph away, and the header
// copy below covers the case the fusion was really for.
//
// IN A MODAL HEADER IT TRAVELS, because there the two are genuinely one fact:
// you are looking at one of the surfaces, so choosing the other means swapping to
// it. Without that the pill would be buried under the presented modal and
// "actually, let me just ask the agent" would cost close → find the pill → tap.
//
// It's the SAME control the Assets and Story headers wear (SegmentedNative — a
// real UISegmentedControl, liquid glass on iOS 26), just carrying SF Symbols
// instead of words, and taking its heights from that component rather than
// inventing its own: `regular` is 34, exactly the pill's round mic button, so the
// two ends of that row line up instead of being a couple of points apart.
//
// It's drawn in three places, all reading the one store:
//
//   · the pill, `variant="pill"`   — re-labels the pill, and nothing else
//   · both modal headers, `variant="modal"` — SWAPS one modal for the other
//
// The modal variant is why `replace` exists: it takes the presented modal away
// and puts its sibling up in its place, rather than stacking a second one.
//
// A segmented control's selected segment is INERT — tapping Image while already
// in image mode does nothing, in either variant. Neither is a dead end: on the
// pill the body beside it opens the current mode's surface, and in a modal header
// the surface you'd be asking for is the one you're already standing on.

/**
 * Diameter of the pill's round mic/send button, per accessory placement — and
 * therefore the height of the toggle at the other end of that row. ONE constant
 * for both, because "the same height as the send button" is a fact that has to
 * survive either of them being retuned; agent-accessory.tsx imports it for the
 * button itself.
 */
export const PILL_CONTROL = { regular: 34, small: 30 } as const;

// Widths for the two-segment icon form. A SwiftUI view that sizes itself
// collapses to 0 in the RN tree, so the Host needs one from us — same reason the
// Assets and Story headers pin 260 for their three text segments.
const WIDTH = { small: 72, regular: 84, large: 96 } as const;

// Nouns, not verbs. VoiceOver reads these ("Image, selected") and the
// Android/web fallback prints them, and on the pill picking one no longer DOES
// anything — it says what the pill is for. Announcing "Generate an image" for a
// tap that generates nothing is the kind of promise a screen reader shouldn't
// make; the pill's own label carries the fuller sentence.
const OPTIONS: { value: AgentMode; label: string; icon: SFSymbol }[] = [
  { value: 'text', label: 'Write', icon: 'pencil' },
  { value: 'image', label: 'Image', icon: 'photo' },
];

export function AgentModeToggle({
  variant = 'pill',
  compact = false,
}: {
  /** `pill` only points the pill; `modal` swaps the modal that's already up. */
  variant?: 'pill' | 'modal';
  /** The accessory's `inline` placement — the shrunken tab bar. */
  compact?: boolean;
}) {
  const mode = useAgentMode();
  const c = useChatColors();

  // In a nav bar it takes the roomy Photos-picker height the sibling segmented
  // controls there already use; in the pill it matches the round button beside it.
  const size = variant === 'modal' ? 'large' : compact ? 'small' : 'regular';

  return (
    <View style={{ width: WIDTH[size] }}>
      <SegmentedNative<AgentMode>
        size={size}
        // In the pill, EXACTLY the send button's diameter. A segmented capsule
        // renders at whatever its controlSize locks it to (32pt for `regular`),
        // so left alone it would sit two points shorter than the 34pt circle
        // across the row — close enough to look like a mistake rather than a
        // choice. In a nav bar there's no such neighbour, so `large` keeps its
        // natural height there.
        height={variant === 'modal' ? undefined : PILL_CONTROL[size as 'regular' | 'small']}
        // The ACCENT, not the system's grey selection — the same colour as the
        // round send/mic button at the other end of this row, and the Generate
        // button in the image composer. It's the one colour in the app that means
        // "this is the live action", so wearing it is what makes the selected half
        // read as selected at pill size rather than as a slightly lighter button.
        tintColor={c.higgsfield}
        selectedIconColor={c.higgsfieldForeground}
        iconColor={c.mutedForeground}
        options={OPTIONS}
        value={mode}
        onChange={(next) => {
          // On the pill: AIM ONLY. The label under it changes, the tab you were
          // reading stays where it is, and opening is the next tap's job.
          // A selection haptic because there's no navigation to confirm the tap —
          // UISegmentedControl doesn't ring one itself, and the pill's body tap
          // does, so the two halves of that row would otherwise feel unlike.
          if (variant !== 'modal') {
            Haptics.selectionAsync().catch(() => {});
            setAgentMode(next);
            return;
          }

          // In a modal header: swap this modal for its sibling.
          openForMode(next, {
            replace: true,
            // Same rule the pill's body follows: arriving ready to type, unless
            // the agent is mid-turn and a keyboard would cover the reply landing.
            // Image mode has no turn to wait on. Read imperatively — this control
            // is drawn inside two ROOT modals, outside <AgentProvider>, and has no
            // business re-rendering on a streaming turn anyway.
            focus: next === 'image' || !agentIsBusy(getAgent()),
          });
        }}
      />
    </View>
  );
}
