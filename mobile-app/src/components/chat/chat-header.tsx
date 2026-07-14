import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronDown, Cpu, History, SquarePen } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { AGENT_MODELS, useAgentModelStore } from '@/lib/agent-model';
import { chatColors } from './theme';

// Compact chat header: history · model pill (status dot) · new chat.
export function ChatHeader({
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
  const insets = useSafeAreaInsets();
  const modelId = useAgentModelStore((s) => s.model);
  const active = AGENT_MODELS.find((m) => m.id === modelId) ?? AGENT_MODELS[0];

  return (
    <View
      style={{ paddingTop: insets.top }}
      className="border-b border-border bg-background px-3 pb-2"
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Chat history"
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          onPress={onHistoryPress}
        >
          <History size={18} color={chatColors.mutedForeground} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Model: ${active.label}`}
          className="flex-row items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 active:opacity-70"
          onPress={() => router.push('/model-picker')}
        >
          <View
            className={cn(
              'h-2 w-2 rounded-full',
              errored ? 'bg-destructive' : busy ? 'bg-primary' : 'bg-muted-foreground/40',
            )}
          />
          <Cpu size={13} color={chatColors.mutedForeground} />
          <Text className="text-[13px] font-semibold text-foreground">{active.label}</Text>
          <ChevronDown size={13} color={chatColors.mutedForeground} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          onPress={onNewChat}
        >
          <SquarePen size={18} color={chatColors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}
