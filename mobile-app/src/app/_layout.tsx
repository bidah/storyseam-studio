import '../global.css';

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { colorScheme } from 'nativewind';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner-native';
import { bootstrap } from '@/lib/boot';
import { splashReady } from '@/lib/splash';
import { applyNativeScheme, useEffectiveScheme, useThemeStore } from '@/lib/theme';
import { getColors } from '@/lib/colors';

SplashScreen.preventAutoHideAsync();

// How long after the tree is ready to wait for a landing screen to announce
// itself before lifting the splash regardless — see the effect that uses it.
const SPLASH_FALLBACK_MS = 1200;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

// React Navigation theme (JS-drawn chrome), derived from the resolved scheme.
function navThemeFor(scheme: 'dark' | 'light') {
  const c = getColors(scheme);
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: c.pageBg,
      card: c.surface,
      border: c.border,
      primary: c.primary,
      text: c.foreground,
    },
  };
}

export default function RootLayout() {
  const [booted, setBooted] = useState(false);
  const themePref = useThemeStore((s) => s.pref);
  const scheme = useEffectiveScheme();
  const colors = getColors(scheme);
  const isDark = scheme === 'dark';

  // Stored preferences, the session, the active project, its status digest and
  // the local chat store — all of it resolved behind the splash, so this tree
  // mounts on something finished. Capped by a deadline, so a dead network delays
  // the app rather than holding it hostage (lib/boot.ts).
  useEffect(() => {
    bootstrap(queryClient).finally(() => setBooted(true));
  }, []);

  // The splash is lifted by whichever LANDING screen the root redirect picks —
  // (tabs) or /sign-in, each on its own first layout (lib/splash.ts). Not from
  // here: this tree's first layout happens while `app/index.tsx` is still the
  // active route, and that route renders null on purpose, so hiding on it
  // uncovered a blank screen and left the real one to arrive afterwards.
  //
  // Lift it anyway, shortly after, if neither ever announces itself. A landing
  // that doesn't mount (a failed screen, an onLayout a host component swallows)
  // would otherwise strand the app on the splash forever — a far worse failure
  // than the frame of background this trades against. Seen for real on an iOS
  // dev client, which is why the fallback is here at all.
  useEffect(() => {
    if (!booted) return;
    const timer = setTimeout(splashReady, SPLASH_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [booted]);

  // Keep NativeWind's active scheme in lockstep with the resolved preference so
  // the `.dark:root` CSS variables (global.css) flip for className-based surfaces.
  useEffect(() => {
    colorScheme.set(scheme);
  }, [scheme]);

  // …and UIKit's, so the native chrome (nav bars, SwiftUI Forms, keyboard)
  // follows the preference instead of the OS. Headers can then stay color-free.
  useEffect(() => {
    applyNativeScheme(themePref);
  }, [themePref]);

  if (!booted) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navThemeFor(scheme)}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <View className={isDark ? 'dark flex-1 bg-background' : 'flex-1 bg-background'}>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.pageBg } }}>
                <Stack.Screen name="index" />
                {/* The two COLD-START landings, and neither is a push the author
                    made — `index` is a pure redirect (it exists to choose between
                    them), so animating either one plays a screen transition on
                    top of the splash lift: a blank frame that slides. They're a
                    swap of what the app opens on, so they cut.

                    `sign-up` deliberately keeps its animation: it's reached by a
                    tap on sign-in, which IS a push. */}
                <Stack.Screen name="(auth)/sign-in" options={{ animation: 'none' }} />
                <Stack.Screen name="(auth)/sign-up" />
                <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
                {/* The chat modal — the studio agent over whatever tab you were
                    on, opened by the tab bar's accessory pill from everywhere but
                    Home (see lib/agent/chat-route.ts). A ROOT route on purpose:
                    presenting it from inside a tab's stack would switch the
                    visible tab first, which is the exact thing it exists to
                    avoid. `presentation: 'modal'` is the page-sheet look — rounded
                    top corners, the app stepping back behind it, swipe-down to
                    dismiss. Its own nested stack (hub → conversation) owns the
                    headers, so no header here. */}
                <Stack.Screen
                  name="session"
                  options={{ presentation: 'modal', headerShown: false }}
                />
                <Stack.Screen
                  name="projects"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.6, 1],
                    sheetGrabberVisible: true,
                    sheetCornerRadius: 24,
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{
                    presentation: 'formSheet',
                    // Single detent on purpose: opens fully, swipe-down closes
                    // fully — no half-open stop hiding the provider cards.
                    sheetAllowedDetents: [1],
                    sheetGrabberVisible: true,
                    sheetCornerRadius: 24,
                    // The header is owned by settings/_layout's nested stack
                    // (so the provider-key push gets its own Back button + Save
                    // toolbar within the sheet), not this outer screen.
                    headerShown: false,
                  }}
                />
                <Stack.Screen
                  name="model-picker"
                  options={{
                    presentation: 'formSheet',
                    // Hug the model rows — no half-screen stop.
                    sheetAllowedDetents: 'fitToContents',
                    sheetGrabberVisible: true,
                    // Larger radius so the floating (detached) sheet's corners sit
                    // in harmony with the phone's rounded screen corners.
                    // Native header inside the sheet (title + close on the right).
                    headerShown: true,
                  }}
                />
                <Stack.Screen
                  name="image-model-picker"
                  options={{
                    presentation: 'formSheet',
                    // Single screen (two in-place pages) so fitToContents can
                    // measure and hug the rows, like the option-picker.
                    sheetAllowedDetents: 'fitToContents',
                    sheetGrabberVisible: true,
                    // Larger radius so the floating (detached) sheet's corners sit
                    // in harmony with the phone's rounded screen corners.
                    // Native header inside the sheet (title + close/back).
                    headerShown: true,
                  }}
                />
                <Stack.Screen
                  name="library-picker"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.75, 1],
                    sheetGrabberVisible: true,
                  }}
                />
                <Stack.Screen
                  name="sound-picker"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.6, 1],
                    sheetGrabberVisible: true,
                  }}
                />
                <Stack.Screen
                  name="character"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.9, 1],
                    sheetGrabberVisible: true,
                  }}
                />
                <Stack.Screen
                  name="option-picker"
                  options={{
                    presentation: 'formSheet',
                    // The sheet hugs its rows — no half-screen stop.
                    sheetAllowedDetents: 'fitToContents',
                    sheetGrabberVisible: true,
                    // Larger radius so the floating (detached) sheet's corners sit
                    // in harmony with the phone's rounded screen corners.
                    // Native header inside the sheet (title + close on the right).
                    headerShown: true,
                  }}
                />
                <Stack.Screen
                  name="generation"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.9, 1],
                    sheetGrabberVisible: true,
                  }}
                />
                <Stack.Screen
                  name="import-folder"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.6, 1],
                    sheetGrabberVisible: true,
                  }}
                />
                <Stack.Screen
                  name="viewer"
                  options={{
                    presentation: 'fullScreenModal',
                    contentStyle: { backgroundColor: 'black' },
                  }}
                />
                <Stack.Screen
                  name="editor"
                  options={{
                    presentation: 'fullScreenModal',
                    // Dark by design (like the viewer): the ported Edit Studio is
                    // an always-dark creative surface, matching the web app.
                    contentStyle: { backgroundColor: '#0B0B0F' },
                    animation: 'slide_from_bottom',
                    gestureEnabled: false,
                  }}
                />
              </Stack>
              <Toaster theme={scheme} position="top-center" />
            </View>
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
