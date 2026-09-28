import { useEffect, useState } from 'react';
import { Animated } from 'react-native';

// A red dot that pulses while recording — the only motion in a recording bar.
// Its own module because BOTH recording surfaces show it: the composer's bar
// (composer.tsx) and the tab bar's accessory pill (agent-accessory.tsx), and the
// pill must not import the composer just to get a dot — that would drag the image
// picker and the keyboard controller into the tab bar's startup graph.
export function PulsingDot() {
  // Lazy useState, not a ref: the value is created once and never reassigned,
  // and reading `ref.current` during render is what react-hooks/refs flags.
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ width: 10, height: 10, borderRadius: 0, backgroundColor: '#ef4444', opacity }}
    />
  );
}
