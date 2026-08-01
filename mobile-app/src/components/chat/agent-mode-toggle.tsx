import { View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { openForMode, useAgentMode, type AgentMode } from '@/lib/agent/pill-mode';
import { agentIsBusy, getAgent } from '@/lib/agent/provider';
import { useChatColors } from './theme';

// THE TOGGLE. Two icons — write and image — that choose what the tab bar's pill
// is for, and with it which surface a tap opens: the studio agent's conversation
// or visual world's image generator (see lib/agent/pill-mode.ts).
//
// It is not a preference switch that you then have to act on. Picking a segment
// FLIPS THE MODE AND OPENS THAT SURFACE in the same tap — the mode and the modal
// are the same fact, and a toggle that only re-labelled the pill would leave the
// author holding a setting instead of a screen.
//
// It's the SAME control the Assets and Story headers wear (SegmentedNative — a
// real UISegmentedControl, liquid glass on iOS 26), just carrying SF Symbols
// instead of words, and taking its heights from that component rather than
// inventing its own: `regular` is 34, exactly the pill's round mic button, so the
// two ends of that row line up instead of being a couple of points apart.
//
// It's drawn in three places, all reading the one store:
//
//   · the pill, `variant="pill"`   — presents the modal over whatever tab you're on
//   · both modal headers, `variant="modal"` — SWAPS one modal for the other
//
// The modal variant is why `replace` exists: the pill is underneath a presented
// modal and can't be reached, so without a copy of this control in the header
// there'd be no way from a conversation to the image composer that didn't go
// close → find the pill → tap.
//
// A segmented control's selected segment is INERT — tapping Image while already
// in image mode does nothing, in either variant. On the pill that's not a dead
// end: the pill's body is one big target that opens the current mode's surface,
// so the "open what I'm already pointed at" gesture still exists, one glyph over.

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

const OPTIONS: { value: AgentMode; label: string; icon: SFSymbol }[] = [
  { value: 'text', label: 'Write to the studio agent', icon: 'pencil' },
  { value: 'image', label: 'Generate an image', icon: 'photo' },
];

export function AgentModeToggle({
  variant = 'pill',
  compact = false,
}: {
  /** `pill` presents over the tabs; `modal` swaps the modal that's already up. */
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
        onChange={(next) =>
          openForMode(next, {
            replace: variant === 'modal',
            // Same rule the pill's body follows: arriving ready to type, unless
            // the agent is mid-turn and a keyboard would cover the reply landing.
            // Image mode has no turn to wait on. Read imperatively — this control
            // is drawn inside two ROOT modals, outside <AgentProvider>, and has no
            // business re-rendering on a streaming turn anyway.
            focus: next === 'image' || !agentIsBusy(getAgent()),
          })
        }
      />
    </View>
  );
}
