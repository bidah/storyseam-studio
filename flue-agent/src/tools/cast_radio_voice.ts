import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import { isVoiceTrack } from "../lib/voices.js";

export const castRadioVoice = (api: Api) =>
  defineTool({
    name: "cast_radio_voice",
    description:
      'Cast a liked Sound Studio voice take onto a Radio-tab speaker BY NAME (the Casting rail). Use this for a BACKGROUND / one-off speaker that appears in the shot list but has no World character record (e.g. "Store Owner", "Teacher", "Kid") — attach_character_voice can\'t reach them because it needs a World character id. Pass the exact speaker `character` name (from get_radio → casting[].character) plus the voice\'s `trackId` + version `v` (from list_character_voices). If the name DOES match a World character the voice is written THROUGH to that World record (shared with the World tab) — but for a real roster character prefer attach_character_voice by id; use this for the orphan speakers only. Omit `v` to take the track\'s first liked take. Pass `clear: true` (no trackId) to remove the speaker\'s cast voice. Only liked, rendered voice takes can be cast.',
    input: v.object({
      character: d(
        v.pipe(v.string(), v.minLength(1)),
        'Exact speaker name from the Radio casting rail (get_radio → casting[].character), e.g. "Store Owner".',
      ),
      trackId: v.optional(
        d(
          v.string(),
          "Sound Studio track id, e.g. trk_7 (from list_character_voices). Omit when clearing.",
        ),
      ),
      v: v.optional(
        d(
          v.pipe(v.number(), v.integer(), v.minValue(1)),
          "Version number of the liked take. Omit to use the track's first liked take.",
        ),
      ),
      clear: v.optional(
        d(v.boolean(), "Set true to clear this speaker's cast voice."),
      ),
    }),
    async run({ data: input, signal }) {
      const { character, trackId, v: version_, clear } = input;
      if (clear || !trackId) {
        return {
          output: await api.req(
            "/api/radio/casting",
            "PUT",
            { character, voiceRef: null },
            signal,
          ),
        };
      }
      // Resolve + validate the take against the Sound Studio so we snapshot the
      // real playable url and never cast an unrendered or non-voice track.
      const sounds = await api.get<{ tracks?: any[] }>("/api/sounds", signal);
      const track = (sounds?.tracks || []).find((t: any) => t.id === trackId);
      if (!track) {
        throw new Error(
          `No sound track "${trackId}". Call list_character_voices to see castable voices.`,
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
      return {
        output: await api.req(
          "/api/radio/casting",
          "PUT",
          {
            character,
            voiceRef: {
              trackId: track.id,
              v: version.v,
              name: track.name || version.name || "Voice",
              url: version.url,
            },
          },
          signal,
        ),
      };
    },
  });
