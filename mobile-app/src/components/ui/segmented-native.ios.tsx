import type { ColorValue } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import { Host } from '@expo/ui';
import { Image, Picker, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  controlSize,
  pickerStyle,
  scaleEffect,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';

// `large` keeps controlSize large's roomy typography, but a segmented Picker
// ignores `.frame(height:)` (its height is locked to controlSize, and there's
// no step between `regular` ~34 and `large` ~44). So shrink the whole capsule a
// touch with scaleEffect — it stays centered in its 44pt slot and lines up with
// the nav-bar menu button.
const LARGE_SCALE = 0.9;

// The height the capsule ACTUALLY renders at for each controlSize — UIKit's
// standard segmented control is 32pt, and `large` is the taller Photos-picker
// one. Since the control ignores `.frame(height:)`, this table is the only way to
// hit an exact height: scale by target ÷ native (see `height` below).
const NATIVE_HEIGHT = { small: 28, regular: 32, large: 44 } as const;

// The slot the Host reserves when no exact height is asked for. Roomier than the
// capsule so it isn't cropped; the control centres itself inside.
const HEIGHT = { small: 30, regular: 34, large: 44 } as const;

// Native SwiftUI segmented control (real UISegmentedControl under the hood).
// On iOS 26 it adopts the Liquid Glass look automatically — no extra modifier.
// Drop-in replacement for `@/components/ui/segmented` (same props); the plain
// `.tsx` sibling is the JS fallback for Android/web where swift-ui can't load.
//
// Segments are TEXT by default and SF SYMBOLS when an option carries `icon` —
// same control, same selection chrome, same heights. The icon form is what the
// agent pill's write/image toggle uses (components/chat/agent-mode-toggle.tsx):
// two glyphs where a label would be redundant, in a control narrow enough to sit
// in a row beside a round button. `label` stays REQUIRED either way — it's the
// VoiceOver reading for an icon segment, and what the Android/web fallback draws.
//
// Heads-up: glass sometimes fails to propagate through the UIHostingController
// hosting layer and the segments render flat — that's expo/expo#44739, not this
// code.
export function SegmentedNative<T extends string>({
  options,
  value,
  onChange,
  size = 'regular',
  height,
  tintColor,
  iconColor,
  selectedIconColor,
}: {
  options: { value: T; label: string; icon?: SFSymbol }[];
  value: T;
  onChange: (v: T) => void;
  // 'large' bumps the control to the taller Photos-picker capsule; 'small' is
  // the shrunken form for a compact row. Default slim.
  size?: 'small' | 'regular' | 'large';
  /**
   * Render at EXACTLY this height, instead of whatever the controlSize locks the
   * capsule to. For a control that has to line up with a neighbour of a known
   * size — the agent pill's toggle, which must match the round send button at the
   * other end of its row — "close enough" reads as one of the two being wrong.
   * Scales the whole capsule (glyphs included) by target ÷ NATIVE_HEIGHT, since
   * a segmented Picker ignores `.frame(height:)`.
   */
  height?: number;
  /**
   * Colour of the SELECTION capsule. Left off, the control wears the system's
   * own selection chrome, which is what a sub-surface switcher in a nav bar
   * wants. The agent pill passes its accent so the toggle matches the round send
   * button at the other end of that row.
   */
  tintColor?: ColorValue;
  /** Icon segments only: the unselected glyph colour. */
  iconColor?: ColorValue;
  /** Icon segments only: the glyph sitting ON the selection capsule. */
  selectedIconColor?: ColorValue;
}) {
  // An exact height wins; otherwise `large` gets its nudge down into the 44pt
  // nav-bar slot and everything else renders at its natural size.
  const scale = height ? height / NATIVE_HEIGHT[size] : size === 'large' ? LARGE_SCALE : 1;
  return (
    // Width comes from the caller — a SwiftUI view that sizes itself collapses to
    // 0 in the RN tree without one (see the nav-bar note at every call site).
    <Host style={{ height: height ?? HEIGHT[size] }}>
      <Picker
        modifiers={[
          pickerStyle('segmented'),
          controlSize(size),
          ...(tintColor ? [tint(tintColor)] : []),
          ...(scale === 1 ? [] : [scaleEffect(scale)]),
        ]}
        selection={value}
        onSelectionChange={(selection: T) => {
          if (selection !== value) {
            Haptics.selectionAsync().catch(() => {});
            onChange(selection);
          }
        }}
      >
        {options.map((opt) =>
          opt.icon ? (
            <Image
              key={opt.value}
              systemName={opt.icon}
              // Explicit per-state colours, because the selection capsule is
              // ours here rather than the system's: a glyph left to the default
              // label colour would sit on an accent capsule it wasn't chosen
              // against. Undefined on both = the system decides, as before.
              color={opt.value === value ? selectedIconColor : iconColor}
              modifiers={[tag(opt.value), accessibilityLabel(opt.label)]}
            />
          ) : (
            <Text key={opt.value} modifiers={[tag(opt.value)]}>
              {opt.label}
            </Text>
          ),
        )}
      </Picker>
    </Host>
  );
}
