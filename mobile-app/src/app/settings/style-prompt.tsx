import { useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { toast } from 'sonner-native';
import PromptForm from '@/components/prompt-form';
import { ErrorNote, Loading } from '@/components/ui/empty';
import { saveStylePrompts, type PromptsDoc, type StylePrompt } from '@/lib/prompts';
import { useInvalidate, useProjectResource } from '@/lib/queries';

// One style preset — name, the image block prepended to every generation as the
// house style, and the optional video/motion block kept for later Seedance
// renders. The route owns the draft and the toolbar Save (the same shape as
// settings/provider-key); PromptForm only renders the fields and reports edits.
// The form mounts keyed on the preset id and only once the doc has loaded,
// because the native fields capture their initial text on first render.
export default function StylePromptScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data, isLoading, error, refetch } = useProjectResource<PromptsDoc>('visualWorld');
  const invalidate = useInvalidate();
  const prompts = data?.prompts;
  const preset = prompts?.find((p) => p.id === id);

  // Edits land in a ref (the fields are uncontrolled — re-rendering them on
  // every keystroke would fight the native text view) and only `dirty` is state,
  // because it drives the Save button.
  const draft = useRef<Partial<StylePrompt>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const edit = (key: string, value: string) => {
    draft.current = { ...draft.current, [key]: value };
    setDirty(true);
  };

  const write = async (next: StylePrompt[]) => {
    setBusy(true);
    try {
      await saveStylePrompts(next);
      invalidate('visualWorld');
      router.back();
    } catch (e: any) {
      toast.error(String(e?.message || e));
      setBusy(false);
    }
  };

  const save = () => {
    if (!prompts || !preset) return;
    void write(prompts.map((p) => (p.id === preset.id ? { ...p, ...draft.current } : p)));
  };

  const remove = () => {
    if (!prompts || !preset) return;
    void write(prompts.filter((p) => p.id !== preset.id));
  };

  return (
    <>
      <Stack.Screen options={{ title: preset?.name || 'Style preset' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button disabled={!dirty || busy} onPress={save}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {isLoading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorNote message={String((error as Error).message || error)} onRetry={() => refetch()} />
      ) : !preset ? (
        <ErrorNote message="This preset no longer exists." />
      ) : (
        <PromptForm
          key={preset.id}
          fields={[
            {
              key: 'name',
              title: 'Name',
              placeholder: 'Preset name',
              initial: preset.name,
              lines: 1,
            },
            {
              key: 'image',
              title: 'Image style',
              footer: 'Prepended to every scene as the house style.',
              placeholder: 'Style, palette, composition…',
              initial: preset.image,
              lines: 8,
            },
            {
              key: 'video',
              title: 'Video / motion (optional)',
              footer: 'Camera and motion clauses, kept for later Seedance renders.',
              placeholder: 'Slow push-in, handheld drift…',
              initial: preset.video,
              lines: 4,
            },
          ]}
          onChange={edit}
          destructive={{ label: 'Delete preset', onPress: remove }}
        />
      )}
    </>
  );
}
