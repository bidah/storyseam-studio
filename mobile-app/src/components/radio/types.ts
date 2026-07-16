// Shapes returned by the Worker's radio + animatic routes (worker/src/routes/
// radio.js, animatic.js). The radio view is DERIVED from the shot list on every
// read — scenes and lines are never stored, only user intent (casting, line
// edits) and render results (takes). So these are read models: mutating a line
// means PUTting the intent, not patching this object.
import type { VoiceRef as WorldVoiceRef } from '@/components/story/world';

// The radio view adds `refUrl` to the World's voiceRef: the absolute /files/
// URL the render agent can actually fetch (the stored /sound-media/ one is
// project-scoped and 404s without the project header).
export type VoiceRef = WorldVoiceRef & { refUrl?: string | null };

export type RadioTake = {
  trackId: string;
  v: number | null;
  status: string;
  url: string | null;
  duration: number;
  ready: boolean;
};

export type RadioLine = {
  id: string;
  shotId: string;
  shotN: number;
  character: string;
  text: string;
  voiceRef: VoiceRef | null;
  take: RadioTake | null;
};

export type RadioScene = {
  beat: string;
  beatTitle?: string;
  lines: RadioLine[];
};

export type CastingEntry = {
  character: string;
  voiceRef: VoiceRef | null;
  source: 'world' | 'override' | null;
};

export type RadioPayload = {
  generatedAt: string | null;
  scenes: RadioScene[];
  casting: CastingEntry[];
  totalLines: number;
  readyLines: number;
};

// GET /api/animatic — the coverage counts behind the Build animatic button.
// `unmatched` is the tell that the shot list's ids have drifted from the
// episode manifest's: those shots can't be matched to a still at all, so they'd
// silently build as slates.
export type AnimaticCoverage = {
  shots: number;
  withStill: number;
  slates: number;
  voiced: number;
  unmatched: number;
  fromPacks: number;
  hasManifest: boolean;
};
