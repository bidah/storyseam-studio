import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

// Status pill — mirrors the web app's extended shadcn Badge
// (success / warning / info / muted variants for statuses).

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'info'
  | 'muted'
  | 'destructive'
  | 'outline';

// '26' = 15% alpha on the 8-digit hex — the web Badge's `bg-*/15` tints.
const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    variants: {
      variant: {
        default: { backgroundColor: `${theme.colors.primary}26` },
        success: { backgroundColor: `${theme.colors.success}26` },
        warning: { backgroundColor: `${theme.colors.warning}26` },
        info: { backgroundColor: `${theme.colors.info}26` },
        muted: { backgroundColor: theme.colors.muted },
        destructive: { backgroundColor: `${theme.colors.destructive}26` },
        outline: { borderWidth: 1, borderColor: theme.colors.border },
      },
    },
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    variants: {
      variant: {
        default: { color: theme.colors.primary },
        success: { color: theme.colors.success },
        warning: { color: theme.colors.warning },
        info: { color: theme.colors.info },
        muted: { color: theme.colors.mutedForeground },
        destructive: { color: theme.colors.destructive },
        outline: { color: theme.colors.mutedForeground },
      },
    },
  },
}));

type Props = {
  label: string;
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export function Badge({ label, variant = 'default', style, children }: Props) {
  // `default` is unistyles' FALLBACK key, not a selectable name — it's the
  // branch applied when the group gets no selection, so it goes as `undefined`.
  styles.useVariants({ variant: variant === 'default' ? undefined : variant });
  return (
    <View style={[styles.badge, style]}>
      {children}
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}
