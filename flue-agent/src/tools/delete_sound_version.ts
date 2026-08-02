import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import { consumeApproval, gateAction } from "../lib/approval.js";

// Gated behind the author's go-ahead (lib/approval.ts). This is the only truly
// one-way tool in the set: the version row goes AND its media file is deleted
// from R2, so there is no doc-history restore that brings the audio back — a
// restored `sounds` doc would just point at bytes that no longer exist. The
// description has said "confirm with the user first" since day one, which is
// advice a model can decline to take; the token is the same rule with teeth.
//
// The nastiest case is the LAST version, because the tool's name doesn't hint at
// it: deleting it removes the whole track. So the card says so explicitly rather
// than letting the author read "delete version 1" and lose the track.
const OP = "delete_sound_version";

type Version = { v?: number; file?: string | null; name?: string };
type Track = { id?: string; name?: string; kind?: string; versions?: Version[] };

export const deleteSoundVersion = (api: Api) =>
  defineTool({
    name: "delete_sound_version",
    description:
      "Delete a single sound version and its media file. If it was the track's last version, the whole track is removed. IRREVERSIBLE — the audio bytes are deleted, so no history restore brings them back. GATED: the first call performs NOTHING — it returns `approved:false` with an `approvalToken` and the track/version facts, and you must draw the confirm card (see the **destructive-approval** skill) and wait for the author before calling again with that token.",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Track id, e.g. trk_2."),
      v: d(v.pipe(v.number(), v.integer(), v.minValue(1)), "Version number to delete."),
      approval_token: v.optional(
        d(
          v.string(),
          "ONLY for the confirming second call, and ONLY after the author has actually said yes: the `approvalToken` a previous gated call returned. The track and version are replayed from the approval, so they cannot drift from what was shown on the card. Never invent a token and never reuse a spent one.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { id, v: version, approval_token } = input;
      const del = (trackId: unknown, n: unknown) =>
        api.req(
          `/api/sounds/${encodeURIComponent(String(trackId))}/version/${Number(n)}`,
          "DELETE",
          undefined,
          signal,
        );

      if (approval_token) {
        const params = await consumeApproval<{ id?: string; v?: number }>(
          api,
          approval_token,
          OP,
          signal,
        );
        return { output: await del(params?.id, params?.v) };
      }

      // Read the track so the card carries its real name and version count. A
      // confirmation that says "delete version 2 of trk_7" is not a confirmation
      // the author can act on — they know that track by its name.
      const sounds = await api.get<{ tracks?: Track[] }>("/api/sounds", signal);
      const track = (sounds?.tracks ?? []).find((t) => t?.id === String(id));
      if (!track) {
        throw new Error(
          `No sound track "${id}". Call list_sounds to see the current tracks.`,
        );
      }
      const versions = track.versions ?? [];
      const target = versions.find((x) => Number(x?.v) === Number(version));
      if (!target) {
        throw new Error(
          `Track "${track.name ?? id}" has no version ${version} (it has ${versions.map((x) => x?.v).join(", ") || "none"}).`,
        );
      }
      const last = versions.length <= 1;

      return {
        output: await gateAction(
          api,
          {
            op: OP,
            summary: last
              ? `Delete version ${version} of "${track.name ?? id}" — it is the track's ONLY version, so the whole track goes with it. The audio file is deleted and cannot be restored.`
              : `Delete version ${version} of "${track.name ?? id}", leaving ${versions.length - 1} version(s). The audio file is deleted and cannot be restored.`,
            params: { id: String(id), v: Number(version) },
            facts: {
              Track: String(track.name ?? id),
              ...(track.kind ? { Kind: String(track.kind) } : {}),
              "Version to delete": String(version),
              "Versions after": String(versions.length - 1),
              Reversible: "No — the audio file is removed from storage",
            },
          },
          signal,
        ),
      };
    },
  });
