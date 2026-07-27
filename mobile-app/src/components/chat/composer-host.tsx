import { createContext, useCallback, useContext, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
// Height flows the opposite way: the host measures the docked bar once and
// publishes it, and every screen reads `useComposerHeight()` to reserve scroll
// room under the shared bar.

export type ComposerConfig = {
  /** A HITL input request is awaiting an answer (typed text becomes its response). */
  pending: boolean;
  busy: boolean;
  onStop: () => void;
  /** Uploads + dispatches; resolves once the turn is dispatched. Throws to keep composer content. */
  onSubmit: (text: string, atts: LocalAttachment[]) => Promise<void>;
  /** Bump to open the keyboard (the tab-bar accessory hand-off — see Composer). */
  focusTick?: number;
};

const noop = () => {};
const swallow = async () => {};

const RegisterCtx = createContext<(cfg: ComposerConfig) => void>(noop);
const HeightCtx = createContext(0);

export function ChatComposerScope({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState(0);
  const [cfg, setCfg] = useState<ComposerConfig | null>(null);
  // Screens re-register on every focus (and on every config change while
  // focused), so bail on identical configs or each registration would re-render
  // the scope for nothing.
  const register = useCallback((next: ComposerConfig) => {
    setCfg((prev) =>
      prev &&
      prev.pending === next.pending &&
      prev.busy === next.busy &&
      prev.onStop === next.onStop &&
      prev.onSubmit === next.onSubmit &&
      prev.focusTick === next.focusTick
        ? prev
        : next,
    );
  }, []);
  return (
    <RegisterCtx.Provider value={register}>
      <HeightCtx.Provider value={height}>
        <View style={styles.fill}>
          {children}
          <Composer
            pending={cfg?.pending ?? false}
            busy={cfg?.busy ?? false}
            onStop={cfg?.onStop ?? noop}
            onSubmit={cfg?.onSubmit ?? swallow}
            focusTick={cfg?.focusTick}
            onHeightChange={setHeight}
          />
        </View>
      </HeightCtx.Provider>
    </RegisterCtx.Provider>
  );
}

/**
 * Point the shared composer at this screen. Pass a MEMOIZED config (the hook
 * re-registers whenever its identity changes) built from stable callbacks.
 */
export function useChatComposer(cfg: ComposerConfig) {
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
});
