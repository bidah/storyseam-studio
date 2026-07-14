import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Globe,
  ImagePlus,
  Mic,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wand2,
  X,
} from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { apiJson, deleteJson, mediaUrl, postJson, putJson } from '@/lib/api';
import { agentIsBusy, useAgent } from '@/lib/agent/provider';
import { createWorldMessage } from '@/lib/agent/messages';
import { createPickerRequest } from '@/lib/picker-bus';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { EditableField } from './field';

// World sub-surface — port of src/routes/world.jsx (web). Every inline edit
// merge-patches PUT /api/world (the worker shallow-merges known sections);
// characters go through /api/world/character[/:id].

const MUTED = '#a1a1aa';
const PRIMARY = '#10b981';

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
const CHAR_FIELDS = [
  { key: 'archetype', label: 'Type / archetype', placeholder: 'Protagonist, mentor, foil…' },
  { key: 'role', label: 'Role in the story', placeholder: 'What they do in the plot' },
  { key: 'want', label: 'Want', placeholder: 'Their conscious goal' },
  { key: 'need', label: 'Need', placeholder: 'What they actually need' },
  { key: 'traits', label: 'Traits & personality', placeholder: 'Bright, playful, stubborn…' },
  { key: 'arc', label: 'Arc', placeholder: 'How they change' },
  { key: 'voice', label: 'Voice', placeholder: 'How they speak' },
  { key: 'appearance', label: 'Appearance', placeholder: 'Look / design notes' },
] as const;

type SheetImage = { rel: string; url: string; thumb: string; name: string };
type VoiceRef = { trackId: string; v: number | null; name: string; url: string };
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
type WorldDoc = {
  title: string;
  logline: string;
  map: Record<string, string>;
  depth: Record<string, string>;
  characters: WorldCharacter[];
};

function CharacterCard({
  char,
  onPatch,
  onRemove,
}: {
  char: WorldCharacter;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sheet = char.sheetImage;
  const voiceRef = char.voiceRef;

  // Link/change the character sheet via the shared library picker sheet. The
  // picker resolves `rel` keys only, so we look the image up in /api/library to
  // send the web-parity payload { rel, url, thumb, name }.
  const pickSheet = async () => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/library-picker', params: { requestId, mode: 'single' } });
    const rels = (await promise) as string[] | null;
    const rel = rels?.[0];
    if (!rel) return;
    let im: any = null;
    try {
      const lib = await apiJson<any>('/api/library');
      for (const f of lib.folders || []) {
        const hit = (f.images || []).find((x: any) => x.rel === rel);
        if (hit) {
          im = hit;
          break;
        }
      }
    } catch {
      /* fall back to rel-only below */
    }
    await onPatch({
      sheetImage: im ? { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name } : { rel },
    });
  };

  const pickVoice = async () => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/sound-picker', params: { requestId } });
    const take = (await promise) as VoiceRef | null;
    if (!take) return;
    await onPatch({ voiceRef: take });
  };

  return (
    <Card className="mb-3 p-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Collapse' : 'Edit'} ${char.name || 'character'}`}
        className="flex-row items-center gap-3 active:opacity-70"
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setOpen((o) => !o);
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
            <Users size={20} color={MUTED} />
          </View>
        )}
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
            {char.name || 'Unnamed character'}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            {char.archetype ? <Badge variant="muted" label={char.archetype} /> : null}
            {voiceRef ? <Mic size={13} color={PRIMARY} /> : null}
          </View>
        </View>
        {open ? <ChevronUp size={16} color={MUTED} /> : <ChevronDown size={16} color={MUTED} />}
      </Pressable>

      {open ? (
        <View className="mt-3 gap-3 border-t border-border pt-3">
          <EditableField
            label="Name"
            value={char.name}
            placeholder="Character name"
            multiline={false}
            onCommit={(v) => onPatch({ name: v })}
          />

          {/* Character sheet image */}
          <View className="rounded-xl border border-border bg-secondary/40 p-2.5">
            <Eyebrow className="mb-1.5">Character sheet</Eyebrow>
            {sheet ? (
              <View className="flex-row items-center gap-3">
                <Image
                  source={{ uri: mediaUrl(sheet.thumb || sheet.url) }}
                  style={{ width: 88, height: 88, borderRadius: 10 }}
                  contentFit="cover"
                />
                <View className="flex-1 gap-1.5">
                  <Button size="sm" variant="outline" title="Change sheet" onPress={pickSheet}>
                    <ImagePlus size={13} color="#fafafa" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Unlink"
                    textClassName="text-muted-foreground"
                    onPress={() => onPatch({ sheetImage: null })}
                  >
                    <X size={13} color={MUTED} />
                  </Button>
                </View>
              </View>
            ) : (
              <Button size="sm" variant="outline" title="Link character sheet" onPress={pickSheet}>
                <ImagePlus size={13} color="#fafafa" />
              </Button>
            )}
          </View>

          {/* Attached voice */}
          <View className="rounded-xl border border-border bg-secondary/40 p-2.5">
            <Eyebrow className="mb-1.5">Voice</Eyebrow>
            {voiceRef ? (
              <View className="gap-1.5">
                <View className="flex-row items-center gap-2">
                  <Mic size={14} color={PRIMARY} />
                  <Text className="flex-1 text-[14px] font-medium text-foreground" numberOfLines={1}>
                    {voiceRef.name || 'Voice'}
                    {voiceRef.v != null ? `  ·  v${voiceRef.v}` : ''}
                  </Text>
                </View>
                <View className="flex-row gap-1.5">
                  <Button size="sm" variant="outline" title="Change voice" onPress={pickVoice}>
                    <Mic size={13} color="#fafafa" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Unlink"
                    textClassName="text-muted-foreground"
                    onPress={() => onPatch({ voiceRef: null })}
                  >
                    <X size={13} color={MUTED} />
                  </Button>
                </View>
              </View>
            ) : (
              <Button size="sm" variant="outline" title="Attach voice" onPress={pickVoice}>
                <Mic size={13} color="#fafafa" />
              </Button>
            )}
          </View>

          {CHAR_FIELDS.map((f) => (
            <EditableField
              key={f.key}
              label={f.label}
              value={char[f.key]}
              placeholder={f.placeholder}
              onCommit={(v) => onPatch({ [f.key]: v })}
            />
          ))}

          <Button
            size="sm"
            variant="ghost"
            title="Remove character"
            textClassName="text-destructive"
            onPress={onRemove}
          >
            <Trash2 size={13} color="#f87171" />
          </Button>
        </View>
      ) : null}
    </Card>
  );
}

export function WorldSurface() {
  const { data, isPending, error, refetch, isRefetching } = useProjectResource<WorldDoc>('world');
  const invalidate = useInvalidate();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      invalidate('world');
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Save failed'));
    }
  };

  const patchWorld = (body: Record<string, unknown>) => run(() => putJson('/api/world', body));
  const patchChar = (id: string, patch: Record<string, unknown>) =>
    run(() => putJson(`/api/world/character/${id}`, patch));
  const addChar = () => run(() => postJson('/api/world/character', {}));
  const removeChar = (char: WorldCharacter) =>
    Alert.alert('Remove character', `Remove "${char.name || 'this character'}" from the world? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => run(() => deleteJson(`/api/world/character/${char.id}`)),
      },
    ]);

  const createWithAgent = () => {
    agent.send({ message: createWorldMessage() }).catch(() => {});
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
      {!agentBusy ? <Wand2 size={15} color="white" /> : null}
    </Button>
  );

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-4 pb-28 pt-3"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={MUTED} />}
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
              <Globe size={11} color={MUTED} />
            </Badge>
            <Badge variant="outline" label={`${depthFilled}/${DEPTH.length} story depth`}>
              <BookOpen size={11} color={MUTED} />
            </Badge>
            <Badge variant="info" label={`${characters.length} characters`}>
              <Users size={11} color="#60a5fa" />
            </Badge>
            {agentBusy ? <Badge variant="warning" label="agent working…" /> : null}
          </View>

          {/* Title + logline */}
          <Card>
            <View className="mb-2 flex-row items-center gap-2">
              <Sparkles size={15} color={PRIMARY} />
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
              <Globe size={15} color={PRIMARY} />
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
              <BookOpen size={15} color={PRIMARY} />
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
                <Users size={15} color={PRIMARY} />
                <CardTitle>Characters</CardTitle>
              </View>
              <Button size="sm" variant="outline" title="Add" onPress={addChar}>
                <UserPlus size={13} color="#fafafa" />
              </Button>
            </View>
            {characters.length === 0 ? (
              <Card className="items-center py-6">
                <Text className="text-sm text-muted-foreground">
                  no characters yet — add one, or let the agent build the roster.
                </Text>
              </Card>
            ) : (
              characters.map((char) => (
                <CharacterCard
                  key={char.id}
                  char={char}
                  onPatch={(patch) => patchChar(char.id, patch)}
                  onRemove={() => removeChar(char)}
                />
              ))
            )}
          </View>

          <View className="mt-2">{agentButton}</View>
        </View>
      )}
    </ScrollView>
  );
}
