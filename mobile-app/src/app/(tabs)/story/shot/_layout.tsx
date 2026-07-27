import { Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { X } from 'lucide-react-native';
import { useColors } from '@/lib/colors';

// Nested stack INSIDE the shot-editor formSheet (registered in story/_layout).
// Living in the sheet, it draws the sheet's own native header — the "Shot MS-xx"
// title (set by the screen) + a close button — the same trick the Drafts sheet,
// Settings and Chat history use. Match the app's page background (nav headers
// otherwise default to the iOS systemGroupedBackground gray inside a formSheet).
export default function ShotSheetLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.pageBg },
        headerShadowVisible: false,
        headerTintColor: colors.foreground,
        headerTitleStyle: { color: colors.foreground },
        contentStyle: { backgroundColor: colors.pageBg },
        // Close (dismiss the sheet) on the trailing side. Native bar button
        // (xmark) on iOS; the <Pressable> fallback covers Android/web.
        unstable_headerRightItems: () => [
          {
            type: 'button',
            label: '',
            icon: { type: 'sfSymbol', name: 'xmark' },
            accessibilityLabel: 'Close',
            onPress: () => router.back(),
          },
        ],
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            onPress={() => router.back()}
          >
            <X size={20} color={colors.foreground} />
          </Pressable>
        ),
      }}
    >
      <Stack.Screen name="[n]" />
    </Stack>
  );
}
