import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import {
  BookOpen,
  ChevronRight,
  Globe,
  Mic,
  Sparkles,
  UserPlus,
  Users,
  Wand2,
} from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { mediaUrl, postJson, putJson } from '@/lib/api';
import { agentIsBusy, useAgent, useSendToAgent } from '@/lib/agent/provider';
import { createWorldMessage } from '@/lib/agent/messages';
import { useColors } from '@/lib/colors';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import { EditableField } from './field';

// World sub-surface — port of src/routes/world.jsx (web). Every inline edit
// merge-patches PUT /api/world (the worker shallow-merges known sections);
// characters go through /api/world/character[/:id].

// The story map: the 5 questions that shape the story (verbatim from web).
const MAP = [
  { key: 'world', label: '1. What is the world of your story?', hint: 'Where is it taking place?' },
  { key: 'protagonist', label: '2. Who is the protagonist?', hint: 'What is their main goal?' },
  { key: 'antagonist', label: '3. Who or what is the antagonist?', hint: 'The force standing in the way.' },
  { key: 'stakes', label: '4. What is the stake if they fail?', hint: "What is lost if the goal isn't met?" },
  { key: 'theme', label: '5. What theme or message is driving the story?', hint: 'The idea underneath it all.' },
];

// Story depth: the core elements that make us understand the story.
const DEPTH = [
  { key: 'premise', label: 'Premise', hint: "What is the story really about? Beyond the plot, what's the deeper message?" },
  { key: 'wantVsNeed', label: 'Character development', hint: 'What they want vs. what they need.' },
  { key: 'conflict', label: 'Conflict & stakes', hint: 'Why should the audience care what these characters are going through?' },
  { key: 'obstacles', label: 'Obstacles & consequences', hint: 'The obstacles the protagonist faces — and what happens if they fail.' },
  { key: 'structure', label: 'Story structure', hint: 'How the story is shaped (the arc / beats).' },
];

// One character's type breakdown.
export const CHAR_FIELDS = [
  { key: 'archetype', label: 'Type / archetype', placeholder: 'Protagonist, mentor, foil…' },
  { key: 'role', label: 'Role in the story', placeholder: 'What they do in the plot' },
  { key: 'want', label: 'Want', placeholder: 'Their conscious goal' },
  { key: 'need', label: 'Need', placeholder: 'What they actually need' },
  { key: 'traits', label: 'Traits & personality', placeholder: 'Bright, playful, stubborn…' },
  { key: 'arc', label: 'Arc', placeholder: 'How they change' },
  { key: 'voice', label: 'Voice', placeholder: 'How they speak' },
  { key: 'appearance', label: 'Appearance', placeholder: 'Look / design notes' },
] as const;

export type SheetImage = { rel: string; url: string; thumb: string; name: string };
export type VoiceRef = { trackId: string; v: number | null; name: string; url: string };
export type WorldCharacter = {
  id: string;
  name: string;
  archetype: string;
  role: string;
  want: string;
  need: string;
  traits: string;
  arc: string;
  voice: string;
  appearance: string;
  sheetImage: SheetImage | null;
  voiceRef: VoiceRef | null;
};
export type WorldDoc = {
  title: string;
  logline: string;
  map: Record<string, string>;
  depth: Record<string, string>;
  characters: WorldCharacter[];
};

// Summary row — tapping opens the full character editor in a formSheet screen
// (src/app/character.tsx), which owns the detail fields, sheet image and voice.
function CharacterCard({ char }: { char: WorldCharacter }) {
  const colors = useColors();
  const sheet = char.sheetImage;
  const voiceRef = char.voiceRef;

  return (
    <Card className="mb-3 p-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${char.name || 'character'}`}
        className="flex-row items-center gap-3 active:opacity-70"
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          router.push({ pathname: '/character', params: { id: char.id } });
        }}
      >
        {sheet ? (
          <Image
            source={{ uri: mediaUrl(sheet.thumb || sheet.url) }}
            style={{ width: 52, height: 52, borderRadius: 10 }}
            contentFit="cover"
          />
        ) : (
          <View className="items-center justify-center rounded-[10px] bg-secondary" style={{ width: 52, height: 52 }}>
            <Users size={20} color={colors.mutedForeground} />
          </View>
        )}
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
            {char.name || 'Unnamed character'}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            {char.archetype ? <Badge variant="muted" label={char.archetype} /> : null}
            {voiceRef ? <Mic size={13} color={colors.primary} /> : null}
          </View>
        </View>
        <ChevronRight size={16} color={colors.mutedForeground} />
      </Pressable>
    </Card>
  );
}

export function WorldSurface() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const { data, isPending, error, refetch } = useProjectResource<WorldDoc>('world');
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const invalidate = useInvalidate();
  // Selected: this screen only asks whether a turn is running, so it must not
  // re-render on every streamed batch (see useAgent in lib/agent/provider).
  const agentBusy = useAgent(agentIsBusy);
  const sendToAgent = useSendToAgent();

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      invalidate('world');
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Save failed'));
    }
  };

  const patchWorld = (body: Record<string, unknown>) => run(() => putJson('/api/world', body));
  const addChar = () => run(() => postJson('/api/world/character', {}));

  const createWithAgent = () => {
    sendToAgent(createWorldMessage()).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast('Sent to agent — watch the Chat tab');
  };

  if (isPending) return <Loading />;
  if (error) return <ErrorNote message={String((error as any)?.message || error)} onRetry={refetch} />;

  const world = data as WorldDoc;
  const characters = world.characters || [];
  const mapFilled = MAP.filter((m) => (world.map?.[m.key] || '').trim()).length;
  const depthFilled = DEPTH.filter((d) => (world.depth?.[d.key] || '').trim()).length;
  const isEmpty =
    !world.title?.trim() &&
    !world.logline?.trim() &&
    mapFilled === 0 &&
    depthFilled === 0 &&
    characters.length === 0;

  const agentButton = (
    <Button
      title={agentBusy ? 'Agent working…' : "Let's create the world"}
      disabled={agentBusy}
      loading={agentBusy}
      onPress={createWithAgent}
    >
      {!agentBusy ? <Wand2 size={15} color={colors.primaryForeground} /> : null}
    </Button>
  );

  return (
    <ScrollView
      {...barInset}
      className="flex-1"
      contentContainerClassName="px-4 pb-28 pt-3"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
    >
      {isEmpty ? (
        <View className="pt-8">
          <Empty
            title="No world yet"
            hint="The world that makes the series — let the agent interview you, or fill any field in directly."
          />
          {agentButton}
        </View>
      ) : (
        <View className="gap-4">
          {/* Progress pills */}
          <View className="flex-row flex-wrap items-center gap-2">
            <Badge variant="outline" label={`${mapFilled}/${MAP.length} story map`}>
              <Globe size={11} color={colors.mutedForeground} />
            </Badge>
            <Badge variant="outline" label={`${depthFilled}/${DEPTH.length} story depth`}>
              <BookOpen size={11} color={colors.mutedForeground} />
            </Badge>
            <Badge variant="info" label={`${characters.length} characters`}>
              <Users size={11} color={colors.info} />
            </Badge>
            {agentBusy ? <Badge variant="warning" label="agent working…" /> : null}
          </View>

          {/* Title + logline */}
          <Card>
            <View className="mb-2 flex-row items-center gap-2">
              <Sparkles size={15} color={colors.primary} />
              <CardTitle>The series</CardTitle>
            </View>
            <EditableField
              label="Title"
              value={world.title}
              placeholder="Untitled world"
              multiline={false}
              onCommit={(v) => patchWorld({ title: v })}
            />
            <EditableField
              label="Logline"
              value={world.logline}
              placeholder="One sentence that captures the series."
              className="mt-2"
              onCommit={(v) => patchWorld({ logline: v })}
            />
          </Card>

          {/* Story map */}
          <Card>
            <View className="mb-2 flex-row items-center gap-2">
              <Globe size={15} color={colors.primary} />
              <CardTitle>Story map</CardTitle>
              <View className="ml-auto">
                <Badge variant="outline" label={`${mapFilled}/${MAP.length}`} />
              </View>
            </View>
            <View className="gap-3">
              {MAP.map((m) => (
                <EditableField
                  key={m.key}
                  label={m.label}
                  hint={m.hint}
                  value={world.map?.[m.key]}
                  onCommit={(v) => patchWorld({ map: { [m.key]: v } })}
                />
              ))}
            </View>
          </Card>

          {/* Story depth */}
          <Card>
            <View className="mb-2 flex-row items-center gap-2">
              <BookOpen size={15} color={colors.primary} />
              <CardTitle>Story depth</CardTitle>
              <View className="ml-auto">
                <Badge variant="outline" label={`${depthFilled}/${DEPTH.length}`} />
              </View>
            </View>
            <Text className="mb-2 text-[12px] text-muted-foreground">
              Understand the story — the core elements beneath the plot.
            </Text>
            <View className="gap-3">
              {DEPTH.map((d) => (
                <EditableField
                  key={d.key}
                  label={d.label}
                  hint={d.hint}
                  value={world.depth?.[d.key]}
                  onCommit={(v) => patchWorld({ depth: { [d.key]: v } })}
                />
              ))}
            </View>
          </Card>

          {/* Characters */}
          <View>
            <View className="mb-2 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Users size={15} color={colors.primary} />
                <CardTitle>Characters</CardTitle>
              </View>
              <Button size="sm" variant="outline" title="Add" onPress={addChar}>
                <UserPlus size={13} color={colors.foreground} />
              </Button>
            </View>
            {characters.length === 0 ? (
              <Card className="items-center py-6">
                <Text className="text-sm text-muted-foreground">
                  no characters yet — add one, or let the agent build the roster.
                </Text>
              </Card>
            ) : (
              characters.map((char) => <CharacterCard key={char.id} char={char} />)
            )}
          </View>

          <View className="mt-2">{agentButton}</View>
        </View>
      )}
    </ScrollView>
  );
}
