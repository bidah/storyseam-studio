import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { KeyboardController, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { Galeria } from '@nandorojo/galeria';
import { router } from 'expo-router';
import { toast } from 'sonner-native';
import {
  AlertCircle,
  ChevronDown,
  IdCard,
  ImagePlus,
  Library,
  MapPin,
  Mic,
  Package,
  Wand2,
  X,
} from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { GlassSurface } from '@/components/chat/glass-surface';
import { RecordingBar } from '@/components/chat/composer';
import { useChatColors } from '@/components/chat/theme';
import { useColors } from '@/lib/colors';
import { useEffectiveScheme } from '@/lib/theme';
import { agentIsBusy, useAgent, useSendToAgent } from '@/lib/agent/provider';
import { createVisualWorldMessage } from '@/lib/agent/messages';
import { apiFetch, apiJson, mediaUrl, postJson, transcribeAudio, uploadFile } from '@/lib/api';
import { createPickerRequest } from '@/lib/picker-bus';
import { ASPECTS } from '@/lib/gen-defaults';
import { useImageModelPickerStore } from '@/lib/image-model-picker';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useAudioRecording } from '@/lib/use-audio-recording';
import { useSuppressAgentAccessory } from '@/lib/agent/accessory-suppress';

// Visual world — the World tab's image-generation surface, port of the web
// World › Visual (src/routes/world/visual.jsx + the shared ImageStudio). The
// gallery lists /api/visual-world generations; the composer below rides the
// keyboard exactly like the chat composer (KeyboardStickyView + glass surface,
// mic record→transcribe) and fires POST /api/visual-world/generate. The nodes
// canvas is deliberately NOT ported — that stays web-only.


const COUNTS = [1, 2, 3, 4];

// Sheet tag display meta ('' = plain image). The tag layers the project's
// character/location/prop sheet prompt into the generation server-side.
const SHEET_TYPES = {
  character: { label: 'Character sheet', short: 'Character', icon: IdCard },
  location: { label: 'Location sheet', short: 'Location', icon: MapPin },
  prop: { label: 'Prop sheet', short: 'Prop', icon: Package },
} as const;
type SheetType = keyof typeof SHEET_TYPES | '';

export type VisualRef = {
  id: string; // stable client-side id for chip removal
  kind: 'library' | 'generation' | 'upload';
  rel?: string;
  genId?: string;
  url?: string; // uploads carry their absolute /files url
  thumb?: string; // display-ready URI for the chip
  name?: string;
};

export type VisualGen = {
  id: string;
  status: 'processing' | 'ready' | 'error';
  url: string; // relative /visual-media/<file>
  prompt: string;
  model?: string;
  aspectRatio?: string;
  presetId?: string;
  sheetType?: string;
  refs?: { kind?: string; rel?: string; genId?: string; url?: string; thumb?: string }[];
  ts?: number | string;
  savedRel?: string | null;
  error?: string;
};

export type VisualWorldDoc = {
  generations: VisualGen[];
  prompts: { id: string; name: string }[];
  settings?: { model?: string; count?: number; aspectRatio?: string; presetId?: string };
};

// Composer options open the /option-picker native formSheet (fit-to-content
// height, native header + close). Resolves the picked value, or null on dismiss.
async function sheetPick(
  title: string,
  options: { value: string; label: string }[],
  selected: string,
): Promise<string | null> {
  const { requestId, promise } = createPickerRequest();
  router.push({
    pathname: '/option-picker',
    params: { requestId, title, options: JSON.stringify(options), selected },
  });
  return (await promise) as string | null;
}

// A compact "value ▾" chip for the composer's options row.
function OptionChip({
  label,
  active = true,
  icon,
  onPress,
  a11y,
}: {
  label: string;
  active?: boolean;
  icon?: React.ReactNode;
  onPress: () => void;
  a11y: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      className="h-8 flex-row items-center gap-1 rounded-full border border-border px-2.5 active:opacity-60"
      onPress={onPress}
    >
      {icon}
      <Text
        className={
          active ? 'text-[12px] font-medium text-foreground' : 'text-[12px] text-muted-foreground'
        }
        numberOfLines={1}
      >
        {label}
      </Text>
      <ChevronDown size={12} color={colors.mutedForeground} />
    </Pressable>
  );
}

// One gallery cell: image / spinner / error, with the sheet-type tag on top.
// Ready cells are Galeria tiles (the assets-folder pattern): tap = full-screen
// swipeable preview with a shared-element transition; long-press = the
// generation detail sheet. `galeriaIndex` is the cell's position in the
// ready-only urls array handed to the surrounding <Galeria>.
function GenerationCell({
  gen,
  size,
  galeriaIndex,
  onOpen,
}: {
  gen: VisualGen;
  size: number;
  galeriaIndex: number;
  onOpen: (g: VisualGen) => void;
}) {
  const colors = useColors();
  const tag = gen.sheetType ? SHEET_TYPES[gen.sheetType as keyof typeof SHEET_TYPES] : null;
  return (
    <View>
      {gen.status === 'ready' && gen.url ? (
        <View className="overflow-hidden rounded-[10px]" style={{ width: size, height: size }}>
          <Galeria.Image
            index={galeriaIndex}
            style={{ width: size, height: size }}
            onLongPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onOpen(gen);
            }}
          >
            <Image
              source={{ uri: mediaUrl(gen.url) }}
              accessibilityLabel={gen.prompt || 'generation'}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              transition={100}
            />
          </Galeria.Image>
        </View>
      ) : gen.status === 'error' ? (
        <View
          className="items-center justify-center rounded-[10px] border border-destructive/40 bg-secondary px-2"
          style={{ width: size, height: size }}
        >
          <AlertCircle size={16} color={colors.destructive} />
          <Text className="mt-1 text-center text-[9px] leading-3 text-destructive" numberOfLines={3}>
            {gen.error || 'Failed'}
          </Text>
        </View>
      ) : (
        <View
          className="items-center justify-center rounded-[10px] bg-secondary"
          style={{ width: size, height: size }}
        >
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text className="mt-1 text-[10px] text-muted-foreground">generating…</Text>
        </View>
      )}
      {tag && gen.status === 'ready' ? (
        <View pointerEvents="none" className="absolute left-1.5 top-1.5">
          <Badge variant="info" label={tag.short} />
        </View>
      ) : null}
    </View>
  );
}

export function VisualWorldSurface() {
  // This surface docks its OWN composer, so the tab bar's agent accessory
  // stands down while it's up — same rule the Chat tab gets, but expressed per
  // screen because Visual world is one segment inside the Story tab.
  useSuppressAgentAccessory();
  const { data, isPending, error, refetch } =
    useProjectResource<VisualWorldDoc>('visualWorld');
  if (isPending) return <Loading />;
  if (error)
    return <ErrorNote message={String((error as any)?.message || error)} onRetry={refetch} />;
  // Mounting the loaded surface only once data exists lets the composer seed
  // its state straight from the server-remembered settings (useState initial
  // values), with no seeding effect.
  return <Loaded data={data as VisualWorldDoc} refetch={refetch} />;
}

function Loaded({
  data,
  refetch,
}: {
  data: VisualWorldDoc;
  refetch: () => void;
}) {
  const c = useChatColors();
  const scheme = useEffectiveScheme();
  const invalidate = useInvalidate();
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);
  const sendToAgent = useSendToAgent();

  // 3-up grid (the library-picker cell math).
  const cell = Math.floor((width - 16 * 2 - 8 * 2) / 3);

  const generations = data.generations || [];
  const prompts = data.prompts || [];
  const pending = generations.filter((g) => g.status === 'processing').length;

  // Composer state — initial values come from the server-remembered settings.
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(() => data.settings?.model || '');
  const [count, setCount] = useState(() => Number(data.settings?.count) || 1);
  const [aspectRatio, setAspectRatio] = useState(() => data.settings?.aspectRatio || '16:9');
  const [presetId, setPresetId] = useState(
    () => data.settings?.presetId ?? (data.prompts?.[0]?.id || ''),
  );
  const [sheetType, setSheetType] = useState<SheetType>('');
  const [refs, setRefs] = useState<VisualRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);

  // Voice input — the chat composer's record→transcribe flow, verbatim.
  const rec = useAudioRecording();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // The real Higgsfield image-model catalog. Best-effort — when not signed in
  // the empty list still works (the server resolves Nano Banana Pro).
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiJson<{ models?: { id: string; label: string }[] }>('/api/visual-world/models')
      .then((j) => {
        if (!cancelled && j?.models) setModels(j.models.filter((m) => m.id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll while any card is still processing (the web surface's 3s loop).
  // `invalidate` is a fresh closure every render, so the interval reads it
  // through a latest-ref updated in its own effect.
  const invalidateRef = useRef(invalidate);
  useEffect(() => {
    invalidateRef.current = invalidate;
  });
  useEffect(() => {
    if (pending === 0) return;
    let stop = false;
    let inFlight = false;
    const t = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await apiFetch('/api/visual-world/poll');
      } catch {
        /* transient */
      } finally {
        inFlight = false;
      }
      if (!stop) invalidateRef.current('visualWorld');
    }, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [pending]);

  /* ---- composer actions -------------------------------------------------- */

  const addRefs = (items: Omit<VisualRef, 'id'>[]) =>
    setRefs((cur) => [...cur, ...items.map((r) => ({ id: Crypto.randomUUID(), ...r }))]);

  // Photos → upload to R2 now so generate can forward the absolute /files url.
  const pickFromPhotos = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.error('Photo library access is needed to attach references.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 4,
        quality: 0.9,
      });
      if (result.canceled) return;
      setAttaching(true);
      try {
        const added: Omit<VisualRef, 'id'>[] = [];
        for (const a of result.assets || []) {
          const ext = (a.fileName?.split('.').pop() || 'jpg').toLowerCase();
          const name = a.fileName || `ref-${Date.now()}.${ext}`;
          const { url } = await uploadFile(a.uri, name, a.mimeType || 'image/jpeg');
          added.push({ kind: 'upload', url, thumb: a.uri, name });
        }
        if (added.length) addRefs(added);
      } finally {
        setAttaching(false);
      }
    } catch (e) {
      toast.error(`Attach failed: ${e instanceof Error ? e.message : String(e)}`);
      setAttaching(false);
    }
  };

  // Asset library → rel keys via the shared picker sheet; thumbs looked up in
  // /api/library (the character-sheet pattern).
  const pickFromLibrary = async () => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/library-picker', params: { requestId, mode: 'multi' } });
    const rels = (await promise) as string[] | null;
    if (!rels?.length) return;
    let images: any[] = [];
    try {
      const lib = await apiJson<any>('/api/library');
      images = (lib.folders || []).flatMap((f: any) => f.images || []);
    } catch {
      /* rel-only refs still generate */
    }
    addRefs(
      rels.map((rel) => {
        const im = images.find((x) => x.rel === rel);
        return {
          kind: 'library' as const,
          rel,
          thumb: mediaUrl(im?.thumb || im?.url),
          name: im?.name || rel,
        };
      }),
    );
  };

  const attachRef = async () => {
    const v = await sheetPick(
      'Add a reference image',
      [
        { value: 'photos', label: 'Photo library' },
        { value: 'library', label: 'Asset library' },
      ],
      '',
    );
    if (v === 'photos') void pickFromPhotos();
    else if (v === 'library') void pickFromLibrary();
  };

  const generate = async () => {
    const text = prompt.trim();
    if (!text || busy || attaching) return;
    if (sheetType === 'location' && refs.length === 0) {
      // A location sheet formalizes an EXISTING place — the server enforces the
      // reference requirement too.
      toast.error('Location sheets need a reference image — add one first.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setBusy(true);
    try {
      await postJson('/api/visual-world/generate', {
        prompt: text,
        model,
        count,
        aspectRatio,
        presetId,
        sheetType,
        refs: refs.map((r) => ({
          kind: r.kind,
          rel: r.rel,
          genId: r.genId,
          ...(r.kind === 'upload' ? { url: r.url } : {}),
        })),
      });
      KeyboardController.dismiss();
      invalidate('visualWorld');
    } catch (e) {
      toast.error(`Generate failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await rec.start();
      setRecording(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const cancelRecording = async () => {
    setRecording(false);
    await rec.stop();
  };
  const confirmRecording = async () => {
    setRecording(false);
    setTranscribing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const uri = await rec.stop();
      if (!uri) throw new Error('No audio captured');
      const { text: heard } = await transcribeAudio(uri);
      const trimmed = (heard || '').trim();
      if (!trimmed) {
        toast.error("Didn't catch that — try again.");
        return;
      }
      setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${trimmed}` : trimmed));
    } catch (e) {
      toast.error(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTranscribing(false);
    }
  };

  /* ---- detail sheet round-trip ------------------------------------------- */

  // Tapping a card opens /generation as a formSheet; "Recreate" / "Use as
  // reference" resolve back here through the picker bus.
  const openDetail = async (g: VisualGen) => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/generation', params: { id: g.id, requestId } });
    const res = (await promise) as { action: 'recreate' | 'ref'; id: string } | null;
    if (!res) return;
    const gen = (data?.generations || []).find((x) => x.id === res.id);
    if (!gen) return;
    if (res.action === 'recreate') {
      setPrompt(gen.prompt || '');
      if (gen.model) setModel(gen.model);
      if (gen.aspectRatio) setAspectRatio(gen.aspectRatio);
      if (gen.presetId) setPresetId(gen.presetId);
      setSheetType((gen.sheetType as SheetType) || '');
      setRefs(
        (gen.refs || []).map((r) => ({
          id: Crypto.randomUUID(),
          kind: (r.kind as VisualRef['kind']) || 'library',
          rel: r.rel,
          genId: r.genId,
          ...(r.kind === 'upload' ? { url: r.url } : {}),
          thumb: mediaUrl(r.thumb || r.url),
        })),
      );
    } else if (res.action === 'ref') {
      setRefs((cur) =>
        cur.some((r) => r.genId === gen.id)
          ? cur
          : [
              ...cur,
              {
                id: Crypto.randomUUID(),
                kind: 'generation',
                genId: gen.id,
                thumb: mediaUrl(gen.url),
                name: 'gen',
              },
            ],
      );
    }
  };

  /* ---- option pickers ----------------------------------------------------- */

  const modelLabel = models.find((m) => m.id === model)?.label || 'Nano Banana Pro';
  const presetLabel = prompts.find((p) => p.id === presetId)?.name || 'No style';
  const sheetMeta = sheetType ? SHEET_TYPES[sheetType] : null;

  // "" is the empty-value sentinel for "default"/"none" rows (route params drop
  // empty strings, so the row value must be non-empty and map back to "").
  const NONE = '__none__';
  const pickModel = async () => {
    // Dedicated two-level sheet: 6 default models + a "More models" pill that
    // slides in the rest (nested stack). The pick still returns via picker-bus.
    const { requestId, promise } = createPickerRequest();
    useImageModelPickerStore.getState().set({
      options: [
        { value: NONE, label: 'Nano Banana Pro (default)' },
        ...models.map((m) => ({ value: m.id, label: m.label })),
      ],
      selected: model || NONE,
      requestId,
    });
    router.push('/image-model-picker');
    const v = (await promise) as string | null;
    if (v != null) setModel(v === NONE ? '' : v);
  };
  const pickCount = async () => {
    const v = await sheetPick(
      'Images per generation',
      COUNTS.map((n) => ({ value: String(n), label: `${n} image${n > 1 ? 's' : ''}` })),
      String(count),
    );
    if (v != null) setCount(Number(v) || 1);
  };
  const pickAspect = async () => {
    const v = await sheetPick(
      'Aspect ratio',
      ASPECTS.map((a) => ({ value: a, label: a })),
      aspectRatio,
    );
    if (v != null) setAspectRatio(v);
  };
  const pickPreset = async () => {
    const v = await sheetPick(
      'Prompt style',
      [
        { value: NONE, label: 'No style preset' },
        ...prompts.map((p) => ({ value: p.id, label: p.name })),
      ],
      presetId || NONE,
    );
    if (v != null) setPresetId(v === NONE ? '' : v);
  };
  const pickSheetType = async () => {
    const v = await sheetPick(
      'Tag as design sheet',
      [
        { value: NONE, label: 'No sheet tag' },
        ...Object.entries(SHEET_TYPES).map(([key, s]) => ({ value: key, label: s.label })),
      ],
      sheetType || NONE,
    );
    if (v != null) setSheetType(v === NONE ? '' : (v as SheetType));
  };

  const explore = () => {
    sendToAgent(createVisualWorldMessage(prompt.trim() || undefined)).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast('Sent to agent — watch the Chat tab');
  };

  /* ------------------------------------------------------------------------ */

  const canSend = prompt.trim().length > 0 && !busy && !attaching;

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-64 pt-3"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.mutedForeground} />
        }
      >
        {/* Status row: pending badge + let-the-agent-explore (web parity). */}
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            {pending > 0 ? <Badge variant="warning" label={`${pending} generating`} /> : null}
            {agentBusy ? <Badge variant="warning" label="agent working…" /> : null}
          </View>
          <Button
            size="sm"
            variant="outline"
            title={agentBusy ? 'Agent working…' : 'Let the agent explore'}
            disabled={agentBusy}
            onPress={explore}
          >
            <Wand2 size={13} color={c.foreground} />
          </Button>
        </View>

        {generations.length === 0 ? (
          <View className="pt-6">
            <Empty
              title="No images yet"
              hint="Describe a character or place below and hit Generate — or let the agent explore the look."
            />
          </View>
        ) : (
          // Full-res urls in grid order for READY cells only — Galeria.Image
          // indexes into this array (processing/error cells aren't previewable).
          <Galeria
            urls={generations
              .filter((g) => g.status === 'ready' && g.url)
              .map((g) => mediaUrl(g.url) ?? '')}
            theme={scheme}
          >
            <View className="flex-row flex-wrap gap-2">
              {(() => {
                let ready = -1;
                return generations.map((g) => {
                  if (g.status === 'ready' && g.url) ready += 1;
                  return (
                    <GenerationCell
                      key={g.id}
                      gen={g}
                      size={cell}
                      galeriaIndex={ready}
                      onOpen={openDetail}
                    />
                  );
                });
              })()}
            </View>
          </Galeria>
        )}
      </ScrollView>

      {/* Composer — glass surface riding the keyboard (the chat composer shape). */}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={{ paddingHorizontal: 15, paddingBottom: Math.max(insets.bottom, 8) + 5 }}>
          <GlassSurface
            glassEffectStyle="regular"
            fallbackColor={c.card}
            style={{
              borderRadius: 24,
              overflow: 'hidden',
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 8,
              gap: 8,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            {recording || transcribing ? (
              <RecordingBar
                transcribing={transcribing}
                duration={rec.duration}
                onCancel={cancelRecording}
                onConfirm={confirmRecording}
              />
            ) : (
              <>
                {refs.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View className="flex-row gap-3 py-1">
                      {refs.map((r) => (
                        <View key={r.id}>
                          <Image
                            source={{ uri: r.thumb }}
                            accessibilityLabel={r.name || 'reference'}
                            contentFit="cover"
                            style={{
                              width: 48,
                              height: 48,
                              borderRadius: 8,
                              backgroundColor: c.muted,
                            }}
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${r.name || 'reference'}`}
                            className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-secondary"
                            onPress={() =>
                              setRefs((prev) => prev.filter((x) => x.id !== r.id))
                            }
                          >
                            <X size={11} color={c.foreground} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                ) : null}

                <TextInput
                  className="max-h-32 px-1 py-1 text-[15px] leading-5 text-foreground"
                  placeholder="Describe a character or a place…"
                  placeholderTextColor={c.mutedForeground}
                  multiline
                  value={prompt}
                  onChangeText={setPrompt}
                  editable={!busy}
                />

                {/* Options: model · count · aspect · style · sheet tag. */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <View className="flex-row items-center gap-2">
                    <OptionChip a11y={`Model: ${modelLabel}`} label={modelLabel} onPress={pickModel} />
                    <OptionChip a11y={`Count: ${count}`} label={`${count}×`} onPress={pickCount} />
                    <OptionChip
                      a11y={`Aspect: ${aspectRatio}`}
                      label={aspectRatio}
                      onPress={pickAspect}
                    />
                    <OptionChip
                      a11y={`Style: ${presetLabel}`}
                      label={presetLabel}
                      active={!!presetId}
                      onPress={pickPreset}
                    />
                    <OptionChip
                      a11y={`Sheet tag: ${sheetMeta?.label || 'none'}`}
                      label={sheetMeta?.short || 'No tag'}
                      active={!!sheetType}
                      icon={
                        sheetMeta ? (
                          <sheetMeta.icon size={13} color={c.foreground} />
                        ) : undefined
                      }
                      onPress={pickSheetType}
                    />
                  </View>
                </ScrollView>

                <View className="flex-row items-center">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add reference image"
                    disabled={attaching}
                    className="h-9 w-9 items-center justify-center rounded-full border border-border active:opacity-60"
                    onPress={attachRef}
                  >
                    {attaching ? (
                      <ActivityIndicator size="small" color={c.mutedForeground} />
                    ) : (
                      <ImagePlus size={17} color={c.mutedForeground} />
                    )}
                  </Pressable>
                  {refs.length > 0 ? (
                    <View className="ml-2 flex-row items-center gap-1">
                      <Library size={13} color={c.mutedForeground} />
                      <Text className="text-[12px] text-muted-foreground">
                        {refs.length} ref{refs.length > 1 ? 's' : ''}
                      </Text>
                    </View>
                  ) : null}

                  <View className="ml-auto">
                    {prompt.trim().length === 0 && !busy ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Dictate the prompt"
                        style={{ backgroundColor: c.higgsfield }}
                        className="h-9 w-9 items-center justify-center rounded-full active:opacity-80"
                        onPress={startRecording}
                      >
                        <Mic size={18} color={c.higgsfieldForeground} />
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={busy ? 'Generating' : 'Generate'}
                        disabled={!canSend}
                        style={{ backgroundColor: c.higgsfield }}
                        className={
                          canSend
                            ? 'h-9 flex-row items-center gap-1.5 rounded-full px-3.5 active:opacity-80'
                            : 'h-9 flex-row items-center gap-1.5 rounded-full px-3.5 opacity-40'
                        }
                        onPress={generate}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={c.higgsfieldForeground} />
                        ) : (
                          <Wand2 size={15} color={c.higgsfieldForeground} />
                        )}
                        <Text
                          className="text-[13px] font-semibold"
                          style={{ color: c.higgsfieldForeground }}
                        >
                          Generate
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </>
            )}
          </GlassSurface>
        </View>
      </KeyboardStickyView>
    </View>
  );
}
