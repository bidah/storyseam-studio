import { ActivityIndicator, Text, View } from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import { Button } from './button';

// Empty / loading / error states shared by every list screen.

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-1.5 px-8 py-16">
      <Text className="text-center text-base font-medium text-foreground">{title}</Text>
      {hint ? <Text className="text-center text-sm text-muted-foreground">{hint}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center py-16">
      <ActivityIndicator />
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8 py-16">
      <CircleAlert size={22} color="#f87171" />
      <Text className="text-center text-sm text-muted-foreground">{message}</Text>
      {onRetry ? <Button size="sm" variant="outline" title="Retry" onPress={onRetry} /> : null}
    </View>
  );
}
