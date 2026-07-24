import { Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { X } from 'lucide-react-native';

// Nested stack INSIDE the Drafts formSheet (registered in story/_layout as a
// formSheet). Living in the sheet, it draws the sheet's own native header —
// the "Drafts" title + a close button — the same trick the Settings sheet and
// Chat history use to get a native nav header inside a sheet. Match the app's
// near-black page background (nav headers otherwise default to the iOS
// systemGroupedBackground gray inside a formSheet).
const PAGE_BG = '#0a0a0b';
const FG = '#fafafa';

export default function DraftsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: PAGE_BG },
        headerShadowVisible: false,
        headerTintColor: FG,
        headerTitleStyle: { color: FG },
        contentStyle: { backgroundColor: PAGE_BG },
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
              <X size={20} color={FG} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
