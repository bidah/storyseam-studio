import { useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { toast } from 'sonner-native';
import PromptForm from '@/components/prompt-form';
import { ErrorNote, Loading } from '@/components/ui/empty';
import { isSheetKind, saveSheetPrompts, SHEET_META, type PromptsDoc } from '@/lib/prompts';
import { useInvalidate, useProjectResource } from '@/lib/queries';

// One design-sheet prompt (?kind=character|location|prop) — the block layered on
// top of the style prompt when a generation is tagged as that kind of sheet, from
// the World composer or from the agent. Saving an empty field is meaningful: the
// server backfills its seed default, so clearing the box restores it.
export default function SheetPromptScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind = isSheetKind(params.kind) ? params.kind : 'character';
  const meta = SHEET_META[kind];
  const { data, isLoading, error, refetch } = useProjectResource<PromptsDoc>('visualWorld');
  const invalidate = useInvalidate();
  const stored = data?.sheetPrompts?.[kind];

  // Uncontrolled field + a dirty flag for the toolbar Save, same as the style
  // preset editor.
  const draft = useRef('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await saveSheetPrompts({ [kind]: draft.current });
      invalidate('visualWorld');
      router.back();
    } catch (e: any) {
      toast.error(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: meta.label }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button disabled={!dirty || busy} onPress={() => void save()}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {isLoading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorNote message={String((error as Error).message || error)} onRetry={() => refetch()} />
      ) : (
        <PromptForm
          key={kind}
          fields={[
            {
              key: kind,
              title: meta.title,
              footer: meta.footer,
              placeholder: meta.placeholder,
              initial: stored ?? '',
              lines: 10,
            },
          ]}
          onChange={(_, value) => {
            draft.current = value;
            setDirty(true);
          }}
        />
      )}
    </>
  );
}
