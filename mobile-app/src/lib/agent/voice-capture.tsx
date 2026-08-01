import { useCallback, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { create } from 'zustand';
import { transcribeAudio } from '@/lib/api';
import { useAudioRecording } from '@/lib/use-audio-recording';
import { getAgentMode, openForMode } from './pill-mode';
import { getActiveChatId } from './provider';

// DICTATION FROM THE TAB BAR. The accessory pill's round button is a mic: tap it
// and the pill itself becomes the recording bar (see agent-accessory.tsx), tap
// stop and the transcript is carried into the composer of whichever surface the
// pill is pointed at — the chat modal, or visual world's image modal when its
// toggle is on Image — as a DRAFT, never sent (lib/agent/pill-mode.ts).
// The pill can't send (it has no attachments, no model chip, and a
// message you never saw before it went out is the wrong kind of magic), so what
// it hands over is text in a field with the caret in it.
//
// Why the recorder lives HERE and not in the pill: react-native-screens renders
// the accessory twice (the `regular` and `inline` placements), so a hook in that
// component runs twice — two expo-audio recorders, two 1s timers, and a `stop`
// that lands on whichever copy the tap hit. The recorder is therefore owned by a
// single host mounted once in the tab layout, state lives in this store (shared
// by both copies), and the controls are module functions guarded on phase, so a
// tap on the invisible copy does exactly what the visible one promised.
//
// The host is also why the ticking timer is cheap: it re-renders itself (a
// null-rendering leaf) and the two pills that read `useVoiceDuration()`, not the
// tab tree it hangs in.

export type VoicePhase = 'idle' | 'recording' | 'transcribing';

type VoiceState = { phase: VoicePhase; duration: number };

const useVoiceStore = create<VoiceState>(() => ({ phase: 'idle', duration: 0 }));

/** Recording / transcribing / neither — drives the pill's swap to the recording view. */
export function useVoicePhase(): VoicePhase {
  return useVoiceStore((s) => s.phase);
}

/** Seconds elapsed in the current take. Subscribe to this ONLY where the timer prints. */
export function useVoiceDuration(): number {
  return useVoiceStore((s) => s.duration);
}

type Controls = {
  start: () => void;
  cancel: () => void;
  confirm: () => void;
};

let controls: Controls | null = null;

/**
 * The pill's three verbs, callable from either copy of the accessory. No-ops
 * before <AccessoryVoiceHost /> mounts; each one is re-checked against the phase
 * inside the host, so a double tap (or a tap on the hidden copy) can't start a
 * second take or stop a take that isn't running.
 */
export const voiceCapture = {
  start: () => controls?.start(),
  cancel: () => controls?.cancel(),
  stop: () => controls?.confirm(),
};

/**
 * Owns the one recorder behind the accessory pill's mic. Renders nothing; mount
 * it once, high enough to outlive tab switches and the chat modal (the tab
 * layout does, next to the other invisible subscribers).
 */
export function AccessoryVoiceHost() {
  const rec = useAudioRecording();

  // Mirror the hook's own tick into the store the pills read.
  useEffect(() => {
    useVoiceStore.setState({ duration: rec.duration });
  }, [rec.duration]);

  const start = useCallback(async () => {
    if (useVoiceStore.getState().phase !== 'idle') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await rec.start();
      useVoiceStore.setState({ phase: 'recording', duration: 0 });
    } catch (e) {
      useVoiceStore.setState({ phase: 'idle', duration: 0 });
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [rec]);

  // Discard the take without transcribing.
  const cancel = useCallback(async () => {
    if (useVoiceStore.getState().phase !== 'recording') return;
    useVoiceStore.setState({ phase: 'idle', duration: 0 });
    await rec.stop();
  }, [rec]);

  // Stop, transcribe, and OPEN THE PILL'S CURRENT SURFACE with the words in its
  // composer — the conversation in text mode, visual world's image composer in
  // image mode (lib/agent/pill-mode.ts). The pill stays on screen showing
  // "Transcribing…" until the navigation happens, so the wait has a place to live:
  // the modal arriving IS the completion signal.
  const confirm = useCallback(async () => {
    if (useVoiceStore.getState().phase !== 'recording') return;
    useVoiceStore.setState({ phase: 'transcribing' });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const uri = await rec.stop();
      if (!uri) throw new Error('No audio captured');
      const { text } = await transcribeAudio(uri);
      const trimmed = (text || '').trim();
      if (!trimmed) {
        toast.error("Didn't catch that — try again.");
        return;
      }
      // Same destination the pill's body has, whichever mode it's in. `focus`
      // puts the caret after the dictated text so the next move — edit, add a
      // reference, send or generate — is one tap away.
      const mode = getAgentMode();
      if (mode === 'text' && !getActiveChatId()) {
        // No session to carry it to (the pill lives inside <AgentProvider>, so in
        // practice unreachable). Say so rather than dropping the words silently.
        // Image mode has no such prerequisite — the generator needs no chat.
        toast.error('No chat to put that in yet — try again in a moment.');
        return;
      }
      openForMode(mode, { focus: true, draft: trimmed });
    } catch (e) {
      toast.error(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      useVoiceStore.setState({ phase: 'idle', duration: 0 });
    }
  }, [rec]);

  // Re-registered every render (the callbacks close over `rec`, which the hook
  // rebuilds), and cleared only by the registration that owns it — so a remount
  // can't null out the live host's controls.
  useEffect(() => {
    const mine: Controls = { start, cancel, confirm };
    controls = mine;
    return () => {
      if (controls === mine) controls = null;
    };
  }, [start, cancel, confirm]);

  // Nothing should keep the mic (and iOS's record-mode audio session) open past
  // this host. Unmount is the app tearing the tabs down, so drop any take.
  useEffect(() => {
    return () => {
      if (useVoiceStore.getState().phase === 'idle') return;
      useVoiceStore.setState({ phase: 'idle', duration: 0 });
      rec.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
