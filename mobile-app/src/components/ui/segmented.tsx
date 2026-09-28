import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import * as Haptics from 'expo-haptics';

const styles = StyleSheet.create((theme) => ({
  track: {
    flexDirection: 'row',
    borderRadius: 0,
    backgroundColor: theme.colors.secondary,
    padding: 4,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    paddingVertical: 6,
  },
  segmentActive: {
    backgroundColor: theme.colors.card,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.mutedForeground,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
}));

// iOS-style segmented control used for in-tab sub-surfaces
// (Story: World|Script|Shots · Assets: Library|Sounds · Sounds: Music|SFX|Voice).
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.track, style]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="tab"
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => {
              if (!active) {
                Haptics.selectionAsync().catch(() => {});
                onChange(opt.value);
              }
            }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
