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
import { hydrateAgentModel } from '@/lib/agent-model';
import { hydrateFalKey } from '@/lib/fal-key';
import { hydrateAtlasKey } from '@/lib/atlas-key';
import { hydrateProviders } from '@/lib/providers';
import { hydrateProjectId } from '@/lib/project';
import { hydrateTheme, useEffectiveScheme } from '@/lib/theme';
import { getColors } from '@/lib/colors';

SplashScreen.preventAutoHideAsync();

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
  const scheme = useEffectiveScheme();
  const colors = getColors(scheme);
  const isDark = scheme === 'dark';

  useEffect(() => {
    hydrateAgentModel();
    hydrateFalKey();
    hydrateAtlasKey();
    hydrateProviders();
    hydrateTheme();
    hydrateProjectId().finally(() => {
      setBooted(true);
      SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  // Keep NativeWind's active scheme in lockstep with the resolved preference so
  // the `.dark:root` CSS variables (global.css) flip for className-based surfaces.
  useEffect(() => {
    colorScheme.set(scheme);
  }, [scheme]);

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
                <Stack.Screen name="(auth)/sign-in" />
                <Stack.Screen name="(auth)/sign-up" />
                <Stack.Screen name="(tabs)" />
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
                    sheetCornerRadius: 24,
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
                    sheetCornerRadius: 24,
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
                    sheetCornerRadius: 24,
                  }}
                />
                <Stack.Screen
                  name="sound-picker"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.6, 1],
                    sheetGrabberVisible: true,
                    sheetCornerRadius: 24,
                  }}
                />
                <Stack.Screen
                  name="character"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.9, 1],
                    sheetGrabberVisible: true,
                    sheetCornerRadius: 24,
                  }}
                />
                <Stack.Screen
                  name="option-picker"
                  options={{
                    presentation: 'formSheet',
                    // The sheet hugs its rows — no half-screen stop.
                    sheetAllowedDetents: 'fitToContents',
                    sheetGrabberVisible: true,
                    sheetCornerRadius: 24,
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
                    sheetCornerRadius: 24,
                  }}
                />
                <Stack.Screen
                  name="import-folder"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.6, 1],
                    sheetGrabberVisible: true,
                    sheetCornerRadius: 24,
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
