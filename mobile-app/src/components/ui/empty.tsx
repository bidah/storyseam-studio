import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { CircleAlert } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { Button } from './button';

// Empty / loading / error states shared by every list screen.

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  empty: {
    gap: 6,
    paddingHorizontal: 32,
  },
  error: {
    gap: 12,
    paddingHorizontal: 32,
  },
  title: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  hint: {
    textAlign: 'center',
    fontSize: 14,
    color: theme.colors.mutedForeground,
  },
}));

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={[styles.center, styles.empty]}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.center, styles.error]}>
      <CircleAlert size={22} color={colors.destructive} />
      <Text style={styles.hint}>{message}</Text>
      {onRetry ? <Button size="sm" variant="outline" title="Retry" onPress={onRetry} /> : null}
    </View>
  );
}
