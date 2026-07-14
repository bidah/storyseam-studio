import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Eyebrow } from '@/components/ui/card';
import { AGENT_MODELS, useAgentModelStore } from '@/lib/agent-model';

// Native formSheet model picker (mirrors the web picker: the id rides every
// /eve request as x-eve-model; the agent maps it per turn).
export default function ModelPickerSheet() {
  const { model, setModel } = useAgentModelStore();

  return (
    <View className="flex-1 bg-background px-5 pt-6">
      <Eyebrow>Chat model</Eyebrow>
      {AGENT_MODELS.map((m) => (
        <Pressable
          key={m.id}
          className="flex-row items-center justify-between rounded-xl px-3 py-3.5 active:bg-secondary"
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setModel(m.id);
            router.back();
          }}
        >
          <View>
            <Text className="text-[15px] font-medium text-foreground">{m.label}</Text>
            <Text className="text-[13px] text-muted-foreground">{m.hint}</Text>
          </View>
          {model === m.id ? <Check size={18} color="#10b981" /> : null}
        </Pressable>
      ))}
    </View>
  );
}
