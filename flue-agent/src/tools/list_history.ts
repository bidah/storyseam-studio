import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";

const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));

const DOC = d(
  v.picklist([
    "world",
    "shotlist",
    "sounds",
    "cuts",
    "episode",
    "visual-world",
    "radio",
    "stills",
    "multishot",
    "timeline",
    "library",
  ]),
  "Which document's history to read — e.g. \"world\" for the World bible, \"shotlist\" for the shot list.",
);

export const listHistory = (api: Api) =>
  defineTool({
    name: "list_history",
    description:
      "List the saved earlier versions of a project document (the World bible, shot list, sounds, cuts, …). Every save parks the version it replaced, so this is the way back when something was overwritten or blanked. Returns { name, snapshots: [{ ts, at, size, source, generatedAt }] }, newest first — `ts` is the id you pass to restore_version, `source` says who wrote that version (\"agent\", \"app\", …), and a sudden drop in `size` is the fingerprint of a bad partial save. Use this whenever the author says content went missing, was lost, disappeared, or looks wrong — check here BEFORE offering to rewrite it from scratch.",
    input: v.object({ name: DOC }),
    async run({ input, signal }) {
      return await api.get(`/api/history/${input.name}`, signal);
    },
  });

export const restoreVersion = (api: Api) =>
  defineTool({
    name: "restore_version",
    description:
      "Put a saved earlier version of a project document back (get `ts` from list_history). This is safe and reversible: restoring saves the CURRENT version to history first, so you can always restore back to it. Use it to undo a bad overwrite rather than retyping content from memory — a restore returns the author's real words, a rewrite only approximates them. ALWAYS tell the author which version (its timestamp and source) you restored, and never restore without saying so first.",
    input: v.object({
      name: DOC,
      ts: d(v.string(), "The version id from list_history, e.g. \"2026-07-22T21-56-31-995Z\"."),
    }),
    async run({ input, signal }) {
      return await api.post(
        `/api/history/${input.name}/${encodeURIComponent(input.ts)}/restore`,
        undefined,
        signal,
      );
    },
  });
