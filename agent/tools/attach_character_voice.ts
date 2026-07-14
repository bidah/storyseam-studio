import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";
import { isVoiceTrack } from "../lib/voices.js";

// The model sees this as `attach_character_voice`.
export default defineTool({
  description:
    "Attach a liked Sound Studio voice take to a World character as their voice (shown and playable on the World tab). Pass the character's `id` (from get_world) and the voice's `trackId` + version `v` (from list_character_voices). Only liked, rendered voice takes can be attached. Omit `v` to take the track's first liked take. Pass `clear: true` (no trackId) to remove the character's voice. When more than one voice could fit, DON'T guess — list them (with their playable urls) and ask_question which one before calling this.",
  inputSchema: z.object({
    characterId: z.string().min(1).describe("Character id from get_world, e.g. char-abc123-0."),
    trackId: z
      .string()
      .optional()
      .describe("Sound Studio track id, e.g. trk_2 (from list_character_voices). Omit when clearing."),
    v: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Version number of the liked take. Omit to use the track's first liked take."),
    clear: z.boolean().optional().describe("Set true to unlink the character's current voice."),
  }),
  async execute({ characterId, trackId, v, clear }) {
    const path = `/api/world/character/${encodeURIComponent(characterId)}`;
    if (clear || !trackId) {
      return await api(path, { method: "PUT", body: { voiceRef: null } });
    }
    // Resolve + validate the take against the Sound Studio so we snapshot the real
    // playable url and never attach an unrendered or non-voice track.
    const sounds = await api<{ tracks?: any[] }>("/api/sounds");
    const track = (sounds?.tracks || []).find((t: any) => t.id === trackId);
    if (!track) {
      throw new Error(`No sound track "${trackId}". Call list_character_voices to see attachable voices.`);
    }
    if (!isVoiceTrack(track)) {
      throw new Error(`Track "${trackId}" is not a voice track (kind: ${track.kind || "unknown"}).`);
    }
    const versions = track.versions || [];
    const version =
      v != null ? versions.find((x: any) => x.v === v) : versions.find((x: any) => x.liked && x.url);
    if (!version) {
      throw new Error(v != null ? `No version v${v} on track "${trackId}".` : `Track "${trackId}" has no liked, rendered take.`);
    }
    if (!version.url) {
      throw new Error(`Voice take ${trackId} v${version.v} has no rendered audio yet — render it first.`);
    }
    if (!version.liked) {
      throw new Error(`Voice take ${trackId} v${version.v} isn't liked — like it first (like_sound_version) or pick a liked take.`);
    }
    return await api(path, {
      method: "PUT",
      body: {
        voiceRef: {
          trackId: track.id,
          v: version.v,
          name: track.name || version.name || "Voice",
          url: version.url,
        },
      },
    });
  },
});
