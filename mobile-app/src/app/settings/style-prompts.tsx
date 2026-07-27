import { useState } from 'react';
import { router, Stack } from 'expo-router';
import { toast } from 'sonner-native';
import StylePromptsForm from '@/components/style-prompts-form';
import { ErrorNote, Loading } from '@/components/ui/empty';
import {
  newStylePrompt,
  promptPreview,
  saveStylePrompts,
  type PromptsDoc,
} from '@/lib/prompts';
import { useInvalidate, useProjectResource } from '@/lib/queries';

// Style presets list, pushed WITHIN the settings sheet's nested stack. Unlike
// the device settings on the sheet itself these are PROJECT state (the
// visual-world doc), so every action is a write + the canonical invalidate.
// `/api/visual-world/prompts` replaces the whole library, which is why add and
// delete both PUT the full list.
export default function StylePromptsScreen() {
  const { data, isLoading, error, refetch } = useProjectResource<PromptsDoc>('visualWorld');
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const prompts = data?.prompts ?? [];

  const write = async (next: typeof prompts) => {
    setBusy(true);
    try {
      await saveStylePrompts(next);
      invalidate('visualWorld');
      return true;
    } catch (e: any) {
      toast.error(String(e?.message || e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Create then open — the preset exists server-side before the editor loads it,
  // so the editor never has to special-case an unsaved row.
  const add = async () => {
    const p = newStylePrompt();
    if (await write([...prompts, p])) router.push(`/settings/style-prompt?id=${p.id}`);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Style presets' }} />
      {isLoading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorNote message={String((error as Error).message || error)} onRetry={() => refetch()} />
      ) : (
        <StylePromptsForm
          presets={prompts.map((p) => ({
            id: p.id,
            name: p.name,
            preview: promptPreview(p),
            builtin: !!p.builtin,
          }))}
          busy={busy}
          onOpen={(id) => router.push(`/settings/style-prompt?id=${id}`)}
          onDelete={(id) => void write(prompts.filter((p) => p.id !== id))}
          onAdd={add}
        />
      )}
    </>
  );
}
