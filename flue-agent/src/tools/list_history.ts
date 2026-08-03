import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";
import { consumeApproval, gateAction } from "../lib/approval.js";

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
    async run({ data: input, signal }) {
      return { output: await api.get(`/api/history/${input.name}`, signal) };
    },
  });

// Gated behind the author's go-ahead (lib/approval.ts). A restore is reversible
// — the document it lands on is parked to history first — but it is still a
// whole-document swap of the author's own writing, and the two ways it goes
// wrong are both invisible from here: the wrong `ts` (the snapshots are minutes
// apart and look alike), and a restore over edits the author made since, which
// they only discover by noticing their sentence is gone. Showing the version's
// timestamp, source and size on a card first is the cheapest way to catch both,
// and it is also the moment the tool description already demanded ("never
// restore without saying so first") — now the flow enforces it instead of asking.
const RESTORE_OP = "restore_version";

type Snapshot = {
  ts?: string;
  at?: string;
  size?: number;
  source?: string;
  generatedAt?: string;
};

export const restoreVersion = (api: Api) =>
  defineTool({
    name: "restore_version",
    description:
      "Put a saved earlier version of a project document back (get `ts` from list_history). This is safe and reversible: restoring saves the CURRENT version to history first, so you can always restore back to it. Use it to undo a bad overwrite rather than retyping content from memory — a restore returns the author's real words, a rewrite only approximates them. GATED: the first call performs NOTHING — it returns `approved:false` with an `approvalToken` and the version's timestamp, source and size, and you must draw the confirm card (see the **destructive-approval** skill) and wait for the author before calling again with that token. ALWAYS tell them which version you restored once it lands.",
    input: v.object({
      name: DOC,
      ts: d(v.string(), "The version id from list_history, e.g. \"2026-07-22T21-56-31-995Z\"."),
      approval_token: v.optional(
        d(
          v.string(),
          "ONLY for the confirming second call, and ONLY after the author has actually said yes: the `approvalToken` a previous gated call returned. The document and version are replayed from the approval, so they cannot drift from what was shown on the card. Never invent a token and never reuse a spent one.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { name, ts, approval_token } = input;

      if (approval_token) {
        const params = await consumeApproval<{ name?: string; ts?: string }>(
          api,
          approval_token,
          RESTORE_OP,
          signal,
        );
        return {
          output: await api.post(
            `/api/history/${params?.name}/${encodeURIComponent(String(params?.ts))}/restore`,
            undefined,
            signal,
          ),
        };
      }

      // Resolve the snapshot before gating: asking the author to approve a
      // version id that doesn't exist wastes their attention and then 404s on
      // the confirming call, which reads as the gate itself being broken.
      const hist = await api.get<{ snapshots?: Snapshot[] }>(
        `/api/history/${name}`,
        signal,
      );
      const snaps = hist?.snapshots ?? [];
      const snap = snaps.find((s) => s?.ts === ts);
      if (!snap) {
        throw new Error(
          `No stored version "${ts}" of the ${name} document. Call list_history to get a real \`ts\`.`,
        );
      }
      return {
        output: await gateAction(
          api,
          {
            op: RESTORE_OP,
            summary: `Restore the ${name} document to the version saved ${snap.at ?? snap.ts}${snap.source ? ` by "${snap.source}"` : ""}. The current ${name} is parked to history first, so this stays undoable.`,
            params: { name: String(name), ts: String(ts) },
            facts: {
              Document: String(name),
              Version: String(snap.at ?? snap.ts),
              ...(snap.source ? { "Written by": String(snap.source) } : {}),
              ...(snap.size ? { "Version size": `${snap.size} bytes` } : {}),
              "Newer versions it skips back past": String(
                snaps.findIndex((s) => s?.ts === ts),
              ),
            },
          },
          signal,
        ),
      };
    },
  });
