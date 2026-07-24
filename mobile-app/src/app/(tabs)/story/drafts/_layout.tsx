import { Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { X } from 'lucide-react-native';
import { useColors } from '@/lib/colors';

// Nested stack INSIDE the Drafts formSheet (registered in story/_layout as a
// formSheet). Living in the sheet, it draws the sheet's own native header —
// the "Drafts" title + a close button — the same trick the Settings sheet and
// Chat history use to get a native nav header inside a sheet. Match the app's
// page background (nav headers otherwise default to the iOS
// systemGroupedBackground gray inside a formSheet).
export default function DraftsLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.pageBg },
        headerShadowVisible: false,
        headerTintColor: colors.foreground,
        headerTitleStyle: { color: colors.foreground },
        contentStyle: { backgroundColor: colors.pageBg },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Drafts',
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
      />
    </Stack>
  );
}
