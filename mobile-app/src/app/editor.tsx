import { useMemo } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { BackendProvider, createCutsBackend, Editor } from '@/editor';

// Full-screen timeline editor — the ported Edit Studio editor, wired to the
// shared Worker via the cuts backend. Opened from the Cuts tab: `/editor?v=3`
// builds a fresh timeline from complete-cut version 3; `/editor` with no param
// resumes the currently-saved editor timeline. Presented as a fullScreenModal
// (see the root _layout Stack.Screen), so Close dismisses back to Cuts.
export default function EditorScreen() {
  const { v } = useLocalSearchParams<{ v?: string }>();
  const fromCutV = v != null && v !== '' ? Number(v) : undefined;

  const backend = useMemo(
    () => createCutsBackend({ fromCutV: Number.isFinite(fromCutV) ? fromCutV : undefined }),
    [fromCutV],
  );

  return (
    <BackendProvider backend={backend}>
      <StatusBar style="light" />
      <Editor onClose={() => router.back()} />
    </BackendProvider>
  );
}
