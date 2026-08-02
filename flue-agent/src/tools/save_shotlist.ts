import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";
import { consumeApproval, gateAction } from "../lib/approval.js";
import { inputSchema } from "../lib/schema-to-valibot.js";
import shotlistSchema from "../schemas/shotlist.json";

const OP = "save_shotlist";

// Appended to the contract description: the gate is this tool's behaviour, not
// part of what the capability accepts.
const GATE_NOTE =
  " GATED IN ONE CASE ONLY: a \"replace\" that would leave FEWER shots than the list already has needs the author's go-ahead — that call returns `approved:false` with an `approvalToken` and performs nothing, and you must draw the confirm card (see the **destructive-approval** skill) before calling again with that token. A first list, an append, and a same-or-larger replace all just save.";

export const saveShotlist = (api: Api) =>
  defineTool({
    name: "save_shotlist",
    // Description and input both come from the SHARED contract
    // (shared/schemas/shotlist.json, vendored into src/schemas/) — the same file
    // POST /api/shotlist validates against. They used to be two hand-written
    // descriptions of one capability with nothing linking them, so a field this
    // tool promised could quietly stop matching what the route accepted.
    //
    // Only the approval gate is tool-local, and it is layered on rather than
    // folded into the contract: the route neither sends nor understands
    // `approval_token`, and `shots` is optional HERE (not there) purely because
    // the confirming second call replays the stored payload instead of re-sending it.
    description: shotlistSchema.description + GATE_NOTE,
    input: inputSchema(shotlistSchema, {
      makeOptional: ["shots"],
      extend: {
        approval_token: v.optional(
          d(
            v.string(),
            "ONLY for the confirming second call, and ONLY after the author has actually said yes: the `approvalToken` a previous gated call returned. Never invent one, never reuse a spent one, and never send one on a first call. When you pass it, OMIT `shots` — the shots you already sent are replayed from the approval, so the author gets exactly what they approved.",
          ),
        ),
      },
    }),
    async run({ data: input, signal }) {
      const { shots, source, mode, approval_token } = input;
      const writeMode = mode === "append" ? "append" : "replace";

      // Phase two of the gate: the author confirmed. Burn the token and replay
      // the arguments THEY approved — not what the model re-typed on this call,
      // which is how a card reading "42 → 12" could otherwise execute as "42 →
      // 0". (It also means the confirming call carries no shots at all, so the
      // giant payload never has to survive a second trip through the model.)
      if (approval_token) {
        const params = await consumeApproval(api, approval_token, OP, signal);
        return { output: await api.post("/api/shotlist", params, signal) };
      }

      // `shots` is optional in the schema only so the CONFIRMING call can omit
      // it. Without a token it is required, and a silent empty array here would
      // read to the server as "replace the list with nothing".
      if (!Array.isArray(shots)) {
        throw new Error(
          "save_shotlist needs `shots` unless you are passing an `approval_token`. Send the shots you want written.",
        );
      }
      const incoming = shots as Json[];
      const body = {
        shots: incoming,
        source: (source as string) || "agent",
        mode: writeMode,
      };

      // Exactly ONE shape of this call destroys work: a "replace" that lands a
      // SHORTER list over an existing one. Everything else is the normal way the
      // shot list gets built — a first list, a same-size edit, an append of the
      // next beat — and gating those would put a confirmation card in front of
      // every step of the beat-by-beat build, which trains the author to tap
      // through gates without reading them. A gate that fires constantly stops
      // being a gate.
      //
      // Shrinkage is the fingerprint of the real accident: the model regenerates
      // the list from a partial view (one beat, a truncated read) and silently
      // deletes the shots it didn't know about — along with every storyboard
      // still keyed to their ids.
      if (writeMode === "replace") {
        const current = await api.get<{ shots?: Json[] }>(
          "/api/shotlist",
          signal,
        );
        const had = current?.shots?.length ?? 0;
        if (had > 0 && incoming.length < had) {
          return {
            output: await gateAction(
              api,
              {
                op: OP,
                summary: `Replace the whole shot list: ${had} shots become ${incoming.length}, so ${had - incoming.length} are deleted along with any storyboard stills keyed to them.`,
                params: body,
                facts: {
                  "Shots now": String(had),
                  "Shots after": String(incoming.length),
                  "Shots deleted": String(had - incoming.length),
                },
              },
              signal,
            ),
          };
        }
      }

      return { output: await api.post("/api/shotlist", body, signal) };
    },
  });
