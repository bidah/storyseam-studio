import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import { isVoiceTrack } from "../lib/voices.js";

export const attachCharacterVoice = (api: Api) =>
  defineTool({
    name: "attach_character_voice",
    description:
      "Attach a liked Sound Studio voice take to a World character as their voice (shown and playable on the World tab). Pass the character's `id` (from get_world) and the voice's `trackId` + version `v` (from list_character_voices). Only liked, rendered voice takes can be attached. Omit `v` to take the track's first liked take. Pass `clear: true` (no trackId) to remove the character's voice. When more than one voice could fit, DON'T guess — list them (with their playable urls) and ask_question which one before calling this.",
    input: v.object({
      characterId: d(
        v.pipe(v.string(), v.minLength(1)),
        "Character id from get_world, e.g. char-abc123-0.",
      ),
      trackId: v.optional(
        d(
          v.string(),
          "Sound Studio track id, e.g. trk_2 (from list_character_voices). Omit when clearing.",
        ),
      ),
      v: v.optional(
        d(
          v.pipe(v.number(), v.integer(), v.minValue(0), v.notValue(0)),
          "Version number of the liked take. Omit to use the track's first liked take.",
        ),
      ),
      clear: v.optional(
        d(v.boolean(), "Set true to unlink the character's current voice."),
      ),
    }),
    async run({ input, signal }) {
      const { characterId, trackId, v: version_, clear } = input;
      const path = `/api/world/character/${encodeURIComponent(String(characterId))}`;
      if (clear || !trackId) {
        return await api.req(path, "PUT", { voiceRef: null }, signal);
      }
      // Resolve + validate the take against the Sound Studio so we snapshot the
      // real playable url and never attach an unrendered or non-voice track.
      const sounds = await api.get<{ tracks?: any[] }>("/api/sounds", signal);
      const track = (sounds?.tracks || []).find((t: any) => t.id === trackId);
      if (!track) {
        throw new Error(
          `No sound track "${trackId}". Call list_character_voices to see attachable voices.`,
        );
      }
      if (!isVoiceTrack(track)) {
        throw new Error(
          `Track "${trackId}" is not a voice track (kind: ${track.kind || "unknown"}).`,
        );
      }
      const versions = track.versions || [];
      const version =
        version_ != null
          ? versions.find((x: any) => x.v === version_)
          : versions.find((x: any) => x.liked && x.url);
      if (!version) {
        throw new Error(
          version_ != null
            ? `No version v${version_} on track "${trackId}".`
            : `Track "${trackId}" has no liked, rendered take.`,
        );
      }
      if (!version.url) {
        throw new Error(
          `Voice take ${trackId} v${version.v} has no rendered audio yet — render it first.`,
        );
      }
      if (!version.liked) {
        throw new Error(
          `Voice take ${trackId} v${version.v} isn't liked — like it first (like_sound_version) or pick a liked take.`,
        );
      }
      return await api.req(
        path,
        "PUT",
        {
          voiceRef: {
            trackId: track.id,
            v: version.v,
            name: track.name || version.name || "Voice",
            url: version.url,
          },
        },
        signal,
      );
    },
  });
