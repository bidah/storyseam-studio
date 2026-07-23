import '../global.css';

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { colorScheme } from 'nativewind';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner-native';
import { hydrateAgentModel } from '@/lib/agent-model';
import { hydrateFalKey } from '@/lib/fal-key';
import { hydrateAtlasKey } from '@/lib/atlas-key';
import { hydrateProviders } from '@/lib/providers';
import { hydrateProjectId } from '@/lib/project';

SplashScreen.preventAutoHideAsync();

// Dark is the product's default look (parity with the web app's `class="dark"`).
colorScheme.set('dark');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0a0a0b',
    card: '#111113',
    border: '#27272a',
    primary: '#10b981',
  },
};

export default function RootLayout() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    hydrateAgentModel();
    hydrateFalKey();
    hydrateAtlasKey();
    hydrateProviders();
    hydrateProjectId().finally(() => {
      setBooted(true);
      SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  if (!booted) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navTheme}>
            <View className="dark flex-1 bg-background">
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0b' } }}>
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
                    sheetAllowedDetents: [0.5, 1],
                    sheetGrabberVisible: true,
                    sheetCornerRadius: 24,
                  }}
                />
                <Stack.Screen
                  name="model-picker"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: [0.4],
                    sheetGrabberVisible: true,
                    sheetCornerRadius: 24,
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
                    contentStyle: { backgroundColor: '#0B0B0F' },
                    animation: 'slide_from_bottom',
                    gestureEnabled: false,
                  }}
                />
              </Stack>
              <Toaster theme="dark" position="top-center" />
            </View>
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
