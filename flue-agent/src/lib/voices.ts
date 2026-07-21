// Which Sound Studio tracks count as "voice" tracks a World character can be
// given — the agent-side mirror of isVoiceTrack() in src/routes/world.jsx.
// Ported verbatim from eve's agent/lib/voices.ts (pure functions).
const VOICE_RE =
  /^\s*(@audio\d|use a seed audio voice reference to voice-act)/i;

export function isVoiceTrack(t: any): boolean {
  if (!t) return false;
  if (t.kind === "voice") return true;
  if (t.kind === "sfx" || t.kind === "music") return false;
  const versions = t.versions || [];
  const v1 = versions.find((v: any) => v.v === 1) || versions[0];
  return VOICE_RE.test(v1?.prompt || "");
}

// Flatten every liked, rendered voice take across the Sound Studio into pickable
// options — the exact shape a character's `voiceRef` is built from.
export function attachableVoices(
  tracks: any[],
): Array<{ trackId: string; v: number; name: string; url: string }> {
  return (tracks || [])
    .filter(isVoiceTrack)
    .flatMap((t: any) =>
      (t.versions || [])
        .filter((v: any) => v.liked && v.url)
        .map((v: any) => ({
          trackId: t.id,
          v: v.v,
          name: t.name || v.name || "Untitled voice",
          url: v.url,
        })),
    );
}
