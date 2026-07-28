import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { ArrowUp } from 'lucide-react-native';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { GlassSurface } from './glass-surface';

// The Pro banner — the upgrade pitch at the top of the Home tab, above the
// project's own sections. One card, one action.
//
// It is the only surface in the app that brings its own colour: everything else
// takes the theme, or (the Discover posters) a colour sampled from its own
// picture. This one is deliberately a blue slab in both themes, because it isn't
// part of the project — it's the app talking about itself, and it should read
// as an insert rather than as another row of your work.

// The gradient: the brand blue at the top easing into cyan-blue at the bottom.
// Two stops, no invented midpoint — a third stop between two hues this close
// only flattens the ramp. The slight horizontal drift (x2 = 0.18) keeps it from
// reading as a flat top-to-bottom fade.
const GRADIENT = [
  { offset: '0', color: '#2682FE' },
  { offset: '1', color: '#02B3FF' },
];

// The dust: motes that drift UP the card, catching the light for an instant and
// going out, so the slab is never quite still.
//
// Placed with MEASURED PIXELS, not percentages. A `top: '70%'` on an absolutely
// positioned child resolves against the parent's height — and this card's height
// is auto (it's whatever the copy and the pill need), so Yoga had nothing to
// resolve against and every low mote collapsed to the top of the card. Measured
// on the device: all motion sat in the top third and the bottom five-eighths of
// the slab were literally zero. Hence the onLayout below: the field only renders
// once the card has a real size, and each mote's fraction is multiplied by it.
//
// One SIZE for all of them — varying it made the big ones read as stars and the
// small ones as dirt on the screen; depth comes from `peak` (how bright a mote
// gets) instead, the same trick a starfield uses.
//
// The numbers are AUTHORED, not rolled. Random per-mount values would re-scatter
// the field on every render (and the durations would occasionally line up into a
// visible pulse); these durations are deliberately non-harmonic and the delays
// spread across the longest of them, so the loop never resynchronises and the
// eye reads it as random.
const MOTE_SIZE = 1.5;

// x, y are FRACTIONS of the card. rise is in points, and stays modest — the card
// clips, so a mote whose arc runs past an edge spends its life invisible.
//
// The positions were sampled OFFLINE (rejection sampling with a minimum spacing,
// measured in the card's own 4.2:1 aspect so "spread out" means spread out on
// screen rather than in normalized units) and then frozen into this table. That
// buys the irregularity of randomness — clusters, gaps, nothing on a grid — with
// none of its cost: the field is identical on every render and every launch.
const MOTES = [
  { x: 0.866, y: 0.90, rise: 29, peak: 0.6, delay: 656, duration: 1472 },
  { x: 0.456, y: 0.80, rise: 25, peak: 0.83, delay: 1168, duration: 1824 },
  { x: 0.841, y: 0.57, rise: 25, peak: 0.54, delay: 272, duration: 1536 },
  { x: 0.656, y: 0.71, rise: 31, peak: 0.46, delay: 1824, duration: 1248 },
  { x: 0.757, y: 0.88, rise: 34, peak: 0.53, delay: 208, duration: 1856 },
  { x: 0.063, y: 0.30, rise: 27, peak: 0.81, delay: 576, duration: 1216 },
  { x: 0.300, y: 0.23, rise: 22, peak: 0.84, delay: 416, duration: 1312 },
  { x: 0.247, y: 0.54, rise: 23, peak: 0.5, delay: 128, duration: 1728 },
  { x: 0.733, y: 0.16, rise: 33, peak: 0.48, delay: 704, duration: 1504 },
  { x: 0.153, y: 0.66, rise: 29, peak: 0.66, delay: 1376, duration: 1408 },
  { x: 0.419, y: 0.19, rise: 25, peak: 0.61, delay: 1296, duration: 1824 },
  { x: 0.957, y: 0.90, rise: 27, peak: 0.6, delay: 1312, duration: 1376 },
  { x: 0.360, y: 0.61, rise: 31, peak: 0.83, delay: 960, duration: 1952 },
  { x: 0.572, y: 0.38, rise: 23, peak: 0.72, delay: 1440, duration: 1920 },
  { x: 0.923, y: 0.43, rise: 27, peak: 0.79, delay: 528, duration: 1280 },
  { x: 0.212, y: 0.88, rise: 24, peak: 0.61, delay: 1376, duration: 1568 },
  { x: 0.828, y: 0.23, rise: 28, peak: 0.59, delay: 896, duration: 1472 },
  { x: 0.495, y: 0.08, rise: 28, peak: 0.55, delay: 1344, duration: 1504 },
  { x: 0.690, y: 0.40, rise: 31, peak: 0.82, delay: 1616, duration: 1792 },
  { x: 0.445, y: 0.48, rise: 25, peak: 0.68, delay: 1456, duration: 1472 },
  { x: 0.901, y: 0.10, rise: 34, peak: 0.63, delay: 480, duration: 1536 },
  { x: 0.533, y: 0.82, rise: 34, peak: 0.69, delay: 864, duration: 1440 },
  { x: 0.765, y: 0.43, rise: 22, peak: 0.62, delay: 1728, duration: 1536 },
  { x: 0.146, y: 0.36, rise: 33, peak: 0.56, delay: 912, duration: 1632 },
  { x: 0.033, y: 0.92, rise: 28, peak: 0.53, delay: 352, duration: 1472 },
  { x: 0.645, y: 0.17, rise: 34, peak: 0.61, delay: 784, duration: 1472 },
  { x: 0.108, y: 0.90, rise: 30, peak: 0.65, delay: 240, duration: 1248 },
  { x: 0.024, y: 0.61, rise: 29, peak: 0.48, delay: 112, duration: 1664 },
] as const;

type Mote = (typeof MOTES)[number];

// One mote's whole life on a single 0→1 clock: the position and the opacity are
// both read off it, so a mote can't be bright while standing still. Linear on
// purpose — dust doesn't ease.
function Mote({ mote, width, height }: { mote: Mote; width: number; height: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      mote.delay,
      withRepeat(withTiming(1, { duration: mote.duration, easing: Easing.linear }), -1, false),
    );
  }, [t, mote.delay, mote.duration]);

  const style = useAnimatedStyle(() => ({
    // Barely a plateau: up over the first third, FULL for about a tenth of the
    // life, then a long fade out. A mote should read as a glint that catches the
    // light for an instant, not a dot that switches on, sits there, switches off.
    opacity: interpolate(t.value, [0, 0.32, 0.42, 1], [0, mote.peak, mote.peak, 0]),
    // Starts BELOW where it's placed and ends above it, so the fade-in happens
    // low and the fade-out high.
    transform: [{ translateY: interpolate(t.value, [0, 1], [mote.rise / 2, -mote.rise / 2]) }],
  }));

  return (
    <Animated.View
      style={[
        styles.mote,
        { left: mote.x * width - MOTE_SIZE / 2, top: mote.y * height - MOTE_SIZE / 2 },
        style,
      ]}
    />
  );
}

// The field. It measures the card and renders nothing until it has a size —
// there is no position to give a mote before then, and one frame of nothing is
// cheaper than a frame of every mote stacked in the corner.
function MoteField() {
  const [box, setBox] = useState({ width: 0, height: 0 });
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {box.height
        ? MOTES.map((m) => (
            <Mote key={`${m.x}-${m.y}`} mote={m} width={box.width} height={box.height} />
          ))
        : null}
    </View>
  );
}

// The four-point sparkle, drawn rather than borrowed: lucide's star glyphs are
// five-pointed or outlined, and this shape — straight points with concave
// shoulders — is the mark itself. One path, so it scales to any size.
function Sparkle({ size = 34, color = '#cfe6ff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 0C12.62 6.2 17.8 11.38 24 12c-6.2.62-11.38 5.8-12 12-.62-6.2-5.8-11.38-12-12C6.2 11.38 11.38 6.2 12 0Z"
        fill={color}
      />
    </Svg>
  );
}

export function ProBanner({ onPress }: { onPress?: () => void }) {
  return (
    // BouncyPressable, like every other tappable card here — and NOT a bare
    // <Pressable style={({ pressed }) => …}>: NativeWind's interop wraps
    // Pressable, and a FUNCTION style silently doesn't make it through, so the
    // card lost its margin, its radius, its border and its row layout all at
    // once. This wrapper puts a plain object style on an inner View, which
    // always lands.
    <BouncyPressable
      accessibilityLabel="Pro — subscribe now, upgrade"
      onPress={onPress}
      pressedScale={0.98}
      style={styles.card}
    >
      {/* The gradient, as an svg under the content: it paints a real ramp
          without pulling in a native gradient module, and the card's own
          `overflow: hidden` clips it into the rounded corners.
          A UNIT VIEWBOX stretched with `preserveAspectRatio="none"`, NOT a
          `width="100%"` rect: RNSVG resolves percentages against the canvas as
          measured when it first renders and does not re-resolve them on a later
          layout, so growing the card's padding left the old gradient height
          behind and a dark band under it. A viewBox is re-fitted every layout by
          definition. */}
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="proGradient" x1="0" y1="0" x2="0.18" y2="1">
            {GRADIENT.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill="url(#proGradient)" />
      </Svg>

      {/* The motes ride ABOVE the gradient as plain Animated.Views rather than
          as <Circle>s inside the svg: animating svg props means
          createAnimatedComponent + animatedProps for every one of them, where a
          rounded 2.5pt View is the same pixels for none of the ceremony. */}
      <MoteField />

      <Sparkle />

      <View style={styles.copy}>
        <Text style={styles.title}>Pro</Text>
        <Text style={styles.subtitle}>Subscribe now</Text>
      </View>

      {/* The action. Real liquid glass on iOS 26 — over a blue slab it has
          something to refract, which is the whole reason it reads as a button
          rather than a painted pill. The hairline ring lives on a WRAPPER view,
          never on the glass itself: a border is a property of the RN view's
          bounds and can't follow the swell UIKit gives a glass surface, so it
          would double-edge. The wrapper also guarantees the ring is there when
          glass isn't (pre-26, Android). */}
      <View style={styles.pillRing}>
        <GlassSurface
          glassEffectStyle="clear"
          style={styles.pill}
          fallbackColor="rgba(255,255,255,0.16)"
        >
          <View style={styles.badge}>
            <ArrowUp size={11} color="#2f80f5" strokeWidth={3} />
          </View>
          <Text style={styles.cta}>Upgrade</Text>
        </GlassSurface>
      </View>
    </BouncyPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingLeft: 22,
    paddingRight: 18,
    // Taller than it is wide-padded: the slab wants air above and below the copy
    // more than it wants it at the edges, or it reads as a toolbar.
    paddingVertical: 24,
    borderRadius: 28,
    // Clips the gradient svg into the corners. The border rides on the same
    // view, so it traces the clip exactly.
    overflow: 'hidden',
    // hairlineWidth, not 1: on a 3x screen a 1pt border is three device pixels
    // of white against a saturated blue, which reads as a drawn outline rather
    // than an edge. This is the thinnest line the display can draw.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  // Absolutely placed, so a mote's `left`/`top` are a position in the card and
  // its transform is free to carry the drift.
  mote: {
    position: 'absolute',
    width: MOTE_SIZE,
    height: MOTE_SIZE,
    borderRadius: MOTE_SIZE,
    backgroundColor: '#fff',
  },
  // The ring the reference has around the button. On the wrapper, not the glass.
  pillRing: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.65)',
    overflow: 'hidden',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  // Deliberately quiet against the headline — it's the terms, not the offer.
  subtitle: { color: 'rgba(255,255,255,0.66)', fontSize: 15, marginTop: 1 },
  // Smaller than the copy beside it on purpose: the card is the pitch, the pill
  // is the way out of it — sized as a control, not as a second headline.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    // The badge is small enough now that the old 5pt lead-in read as the disc
    // being shoved against the ring; both ends get real air instead.
    paddingLeft: 9,
    // Not symmetric with the lead-in and not meant to be: the badge is a solid
    // disc that fills its side, the label is text with its own air, so matching
    // the numbers would leave the right side looking the loose one.
    paddingRight: 11,
    borderRadius: 18,
  },
  // The white disc the arrow sits in — the one solid thing on the glass, which
  // is what gives the button a focal point at a glance.
  badge: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cta: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
