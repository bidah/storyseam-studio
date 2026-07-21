import { useState } from 'react';
import { View } from 'react-native';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { ImportSection } from '@/components/assets/import-section';
import { LibrarySection } from '@/components/assets/library-section';
import { SoundsSection } from '@/components/assets/sounds-section';

type Seg = 'library' | 'import' | 'sounds';

// Assets tab: asset Library (folders → image grid), Import from Higgsfield
// (infinite grid of the user's generations), and the Sound studio.
export default function AssetsTab() {
  const [seg, setSeg] = useState<Seg>('library');

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-3">
        <SegmentedNative<Seg>
          options={[
            { value: 'library', label: 'Library' },
            { value: 'import', label: 'Import' },
            { value: 'sounds', label: 'Sounds' },
          ]}
          value={seg}
          onChange={setSeg}
        />
      </View>
      {seg === 'library' ? (
        <LibrarySection />
      ) : seg === 'import' ? (
        <ImportSection />
      ) : (
        <SoundsSection />
      )}
    </View>
  );
}
