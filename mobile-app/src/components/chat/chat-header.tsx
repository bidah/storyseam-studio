import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { History, SquarePen } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { AGENT_MODELS, useAgentModelStore } from '@/lib/agent-model';
import { chatColors } from './theme';

// Right-side controls for the Chat tab's native header: model pill (with a
// status dot) · chat history · new chat. The project switcher sits in
// headerLeft (shared, see header-buttons.tsx).
export function ChatHeaderRight({
  busy,
  errored,
  onHistoryPress,
  onNewChat,
}: {
  busy: boolean;
  errored: boolean;
  onHistoryPress: () => void;
  onNewChat: () => void;
}) {
  const modelId = useAgentModelStore((s) => s.model);
  const active = AGENT_MODELS.find((m) => m.id === modelId) ?? AGENT_MODELS[0];

  return (
    <View className="flex-row items-center gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Model: ${active.label}`}
        className="flex-row items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1.5 active:opacity-70"
        onPress={() => router.push('/model-picker')}
      >
        <View
          className={cn(
            'h-2 w-2 rounded-full',
            errored ? 'bg-destructive' : busy ? 'bg-primary' : 'bg-muted-foreground/40',
          )}
        />
        <Text className="max-w-24 text-[13px] font-semibold text-foreground" numberOfLines={1}>
          {active.label}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Chat history"
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        onPress={onHistoryPress}
      >
        <History size={18} color={chatColors.mutedForeground} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New chat"
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        onPress={onNewChat}
      >
        <SquarePen size={18} color={chatColors.mutedForeground} />
      </Pressable>
    </View>
  );
}
