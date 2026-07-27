import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { Composer, type LocalAttachment } from './composer';

// ONE composer for the whole chat stack, hosted by the stack's LAYOUT rather
// than by each screen. It overlays the <Stack> the way the tab bar underlays it:
// pushing a conversation slides the screen in UNDERNEATH the bar, so the bar
// (and the draft typed into it) simply stays put instead of a second composer
// riding in with the transition.
//
// The bar itself is dumb about which screen it serves. Whichever screen is
// FOCUSED registers its config — submit/stop handlers, busy/pending state —
// through `useChatComposer`, and the host renders the latest registration.
// Registration is focus-gated (the landing screen stays mounted under a pushed
// conversation, so "mounted" can't be the key) and never cleared on blur: during
// a transition the outgoing screen's config holds until the incoming screen's
// focus effect replaces it, so the bar never flashes through an empty state.
//
// A screen can also register NULL — "I dock no composer": the landing screen
// does, because there the tab bar's agent pill (see agent-accessory.tsx) is the
// way to start typing, and the bar has to stand down rather than double up
// with it (or linger after a conversation pops back to the landing).
//
// Height flows the opposite way: the host measures the docked bar once and
// publishes it, and every screen reads `useComposerHeight()` to reserve scroll
// room under the shared bar.

export type ComposerConfig = {
  /** A HITL input request is awaiting an answer (typed text becomes its response). */
  pending: boolean;
  busy: boolean;
  /**
   * Put the bar away for this screen (the Discover detail poster, which has a
   * button instead). It stays MOUNTED and merely fades out — unmounting would
   * throw away whatever draft is half-typed on the screen underneath, which is
   * the one thing this shared bar exists to preserve across a push.
   */
  hidden?: boolean;
  onStop: () => void;
  /** Uploads + dispatches; resolves once the turn is dispatched. Throws to keep composer content. */
  onSubmit: (text: string, atts: LocalAttachment[]) => Promise<void>;
  /** Bump to open the keyboard (the tab-bar accessory hand-off — see Composer). */
  focusTick?: number;
};

const noop = () => {};

const RegisterCtx = createContext<(cfg: ComposerConfig | null) => void>(noop);
const HeightCtx = createContext(0);

export function ChatComposerScope({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState(0);
  const [cfg, setCfg] = useState<ComposerConfig | null>(null);
  // Screens re-register on every focus (and on every config change while
  // focused), so bail on identical configs or each registration would re-render
  // the scope for nothing.
  const register = useCallback((next: ComposerConfig | null) => {
    setCfg((prev) =>
      prev &&
      next &&
      prev.pending === next.pending &&
      prev.busy === next.busy &&
      prev.hidden === next.hidden &&
      prev.onStop === next.onStop &&
      prev.onSubmit === next.onSubmit &&
      prev.focusTick === next.focusTick
        ? prev
        : next,
    );
  }, []);
  const hidden = !!cfg?.hidden;
  const fade = useSharedValue(1);
  useEffect(() => {
    fade.value = withTiming(hidden ? 0 : 1, { duration: 180 });
  }, [hidden, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  return (
    <RegisterCtx.Provider value={register}>
      <HeightCtx.Provider value={height}>
        <View style={styles.fill}>
          {children}
          {cfg ? (
            // The hiding layer is FULL-SCREEN, not a wrapper hugging the bar:
            // the composer docks itself with `position:absolute; bottom:0`, so a
            // zero-height parent would re-anchor it to the top of the stack and
            // throw it up under the header. It fades rather than unmounting —
            // a screen that hides the bar (the Discover poster) must not cost
            // the half-typed draft on the screen underneath it.
            <Animated.View
              style={[styles.layer, fadeStyle]}
              pointerEvents={hidden ? 'none' : 'box-none'}
            >
              <Composer
                pending={cfg.pending}
                busy={cfg.busy}
                onStop={cfg.onStop}
                onSubmit={cfg.onSubmit}
                focusTick={cfg.focusTick}
                onHeightChange={setHeight}
              />
            </Animated.View>
          ) : null}
        </View>
      </HeightCtx.Provider>
    </RegisterCtx.Provider>
  );
}

/**
 * Point the shared composer at this screen. Pass a MEMOIZED config (the hook
 * re-registers whenever its identity changes) built from stable callbacks —
 * or null from a screen that docks no composer (the accessory pill's turf).
 */
export function useChatComposer(cfg: ComposerConfig | null) {
  const register = useContext(RegisterCtx);
  // useFocusEffect re-runs when the callback changes while focused, so one
  // effect covers both "screen gained focus" and "busy flipped mid-turn".
  useFocusEffect(
    useCallback(() => {
      register(cfg);
    }, [register, cfg]),
  );
}

/** Measured height of the shared docked bar, for reserving scroll room. */
export function useComposerHeight() {
  return useContext(HeightCtx);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
