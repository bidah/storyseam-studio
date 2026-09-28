import { useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Stack } from 'expo-router';
import { useReportSegment } from '@/lib/screen-report';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { ImportSection } from '@/components/assets/import-section';
import { LibrarySection } from '@/components/assets/library-section';
import { SoundsSection } from '@/components/assets/sounds-section';
import { providerEnabled } from '@/lib/providers';

// Import pulls from the author's Higgsfield account — gone with the provider flag.
const SHOW_IMPORT = providerEnabled('higgsfield');

type Seg = 'library' | 'import' | 'sounds';

// Assets tab: asset Library (folders → image grid), Import from Higgsfield
// (infinite grid of the user's generations), and the Sound studio.
//
// The Library/Import/Sounds switcher rides in the native header as a custom
// headerTitle (replacing the "Assets" text) — the iOS Photos-picker placement.
// Set here rather than in _layout.tsx so the `seg` state stays in scope; it
// merges with the menu/refresh native bar items the layout already installs.
export default function AssetsTab() {
  const [seg, setSeg] = useState<Seg>('library');

  // Which sub-surface is showing. The tabs layout only sees the route
  // (`/assets`), and this switcher is component state — so without this the
  // agent is told "library" while the author is in the Sound studio.
  useReportSegment({ view: seg === 'sounds' ? 'sounds' : 'library', path: '/assets' });

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            // The @expo/ui Host collapses to 0 width without an explicit size in
            // the nav-bar title slot, so pin a width for it to lay out into.
            <View style={{ width: 260 }}>
              <SegmentedNative<Seg>
                size="large"
                options={[
                  { value: 'library', label: 'Library' },
                  ...(SHOW_IMPORT ? [{ value: 'import' as const, label: 'Import' }] : []),
                  { value: 'sounds', label: 'Sounds' },
                ]}
                value={seg}
                onChange={setSeg}
              />
            </View>
          ),
        }}
      />
      {seg === 'library' ? (
        <LibrarySection />
      ) : seg === 'import' && SHOW_IMPORT ? (
        <ImportSection />
      ) : (
        <SoundsSection />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
}));
