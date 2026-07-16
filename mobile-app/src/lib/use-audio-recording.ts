import { useEffect, useState } from 'react';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';

// m:ss for the recording timer.
export function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type RecordingStatus = 'idle' | 'recording' | 'stopped';

// Push-to-talk recorder for the chat composer's mic button. Records a
// HIGH_QUALITY .m4a whose local uri feeds transcribeAudio() → the Worker's
// Whisper (Cloudflare Workers AI) endpoint. Self-contained: owns its own
// status + a 1s duration tick, no global store.
export function useAudioRecording() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (status !== 'recording') return;
    const id = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Requests mic permission, arms the recorder, and starts. Throws if the
  // permission is denied so the caller can toast.
  const start = async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) throw new Error('Microphone access is needed to record.');
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setDuration(0);
    setStatus('recording');
  };

  // Stops and returns the recorded file uri (null if nothing was captured).
  const stop = async (): Promise<string | null> => {
    try {
      await recorder.stop();
    } catch {
      /* already stopped / never armed */
    }
    // Hand the audio session back to playback mode (iOS keeps it in record
    // mode otherwise, muting later sound previews).
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    setStatus('stopped');
    return recorder.uri ?? null;
  };

  return { status, duration, start, stop };
}
