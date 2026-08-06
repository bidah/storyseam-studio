import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";
import {
  docToElements,
  elementsToDoc,
  SCRIPT_ELEMENT_TYPES,
} from "../lib/script.js";
import type { ScriptElement } from "../lib/script.js";

// A targeted, positional edit to the screenplay. The model sends ONLY the lines
// it wants to add/change and WHERE — this tool reads the current doc server-side,
// splices, and re-stages the whole document as a proposal. That is the whole
// point: a change in the middle or at the front (prepend a cold open, rewrite
// scene 3) costs the model a handful of lines, not a full re-type of the script.
// Without this, any non-append edit forces save_script + a chain of append_script
// calls that re-emit the entire existing document — slow, and easy to get wrong.
export const editScript = (api: Api) =>
  defineTool({
    name: "edit_script",
    description:
      "Make a TARGETED, positional edit to the screenplay without re-typing the whole thing: insert lines at a position, replace a run of lines, or delete a run of lines. Reach for this — NOT save_script — for any change that isn't a plain append: prepend a cold open, insert a scene, rewrite a specific scene or line, cut a beat. You send ONLY the new/changed lines plus WHERE; the tool re-stages the full document as a reviewable proposal (before→after diff, same as save_script/append_script — nothing commits until the user accepts or you call apply_script_proposal). Call get_script first so you have current 0-based line indices. `op`: 'insert' puts `elements` BEFORE index `at` (at=0 prepends, at=lineCount appends); 'replace' swaps the `count` lines starting at `at` for `elements`; 'delete' removes the `count` lines starting at `at`. Indices refer to the flat `elements` list get_script returns. Stacks onto a pending proposal like append_script; when chaining several edits, use the returned line indices (or re-read) since positions shift after each edit.",
    input: v.object({
      op: d(
        v.picklist(["insert", "replace", "delete"]),
        "insert (add lines before `at`), replace (swap `count` lines at `at`), or delete (remove `count` lines at `at`).",
      ),
      at: d(
        v.pipe(v.number(), v.integer(), v.minValue(0)),
        "0-based line index (from get_script's `elements`). For insert: the position to insert before (0 = prepend, lineCount = append). For replace/delete: the first line acted on.",
      ),
      count: v.optional(
        d(
          v.pipe(v.number(), v.integer(), v.minValue(1)),
          "How many existing lines to replace/delete, starting at `at`. Ignored for insert. Defaults to 1.",
        ),
      ),
      elements: v.optional(
        d(
          v.array(
            v.object({
              type: v.picklist(SCRIPT_ELEMENT_TYPES),
              text: v.string(),
            }),
          ),
          "The new lines (required for insert/replace, omit for delete). Each is { type, text } where type is scene_heading, action, character, dialogue, parenthetical, or transition.",
        ),
      ),
      summary: v.optional(
        d(
          v.string(),
          "One short line describing the change, shown in the review header (e.g. 'Prepended the Soho cold open' or 'Rewrote scene 3').",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { op, at, count, elements, summary } = input as {
        op: "insert" | "replace" | "delete";
        at: number;
        count?: number;
        elements?: ScriptElement[];
        summary?: string;
      };

      if ((op === "insert" || op === "replace") && (!elements || elements.length === 0)) {
        return {
          output: {
            ok: false,
            error: `op "${op}" needs a non-empty \`elements\` list (the lines to ${op === "insert" ? "insert" : "put in place"}).`,
          } as unknown as Json,
        };
      }

      const cur = (await api.get("/api/script", signal)) as unknown as {
        title?: string;
        doc?: unknown;
        proposal?: { proposedDoc?: unknown } | null;
      };
      // Edit on top of any still-pending proposal so successive edits stack; the
      // diff the user sees is measured against the committed doc (the server
      // snapshots that as the proposal's baseDoc). Same base rule as append_script.
      const base = cur.proposal?.proposedDoc ?? cur.doc;
      const lines = docToElements(base);
      const n = lines.length;

      // Bounds — an out-of-range index means the model is working from a stale
      // read; say so plainly so it re-reads rather than silently mis-editing.
      const maxAt = op === "insert" ? n : Math.max(0, n - 1);
      if (at > maxAt) {
        return {
          output: {
            ok: false,
            error:
              op === "insert"
                ? `\`at\` ${at} is past the end — the script has ${n} lines, so insert accepts 0..${n} (call get_script for current indices).`
                : `\`at\` ${at} is out of range — the script has ${n} lines (indices 0..${Math.max(0, n - 1)}). Call get_script for current indices.`,
            lineCount: n,
          } as unknown as Json,
        };
      }

      let removed = 0;
      if (op === "insert") {
        lines.splice(at, 0, ...(elements as ScriptElement[]));
      } else {
        const del = Math.min(count ?? 1, n - at);
        removed = del;
        if (op === "replace") {
          lines.splice(at, del, ...(elements as ScriptElement[]));
        } else {
          lines.splice(at, del);
        }
      }

      const added = op === "delete" ? 0 : (elements as ScriptElement[]).length;
      const note =
        summary ||
        (op === "insert"
          ? `Inserted ${added} line${added === 1 ? "" : "s"} at line ${at}`
          : op === "replace"
            ? `Replaced ${removed} line${removed === 1 ? "" : "s"} at line ${at} with ${added}`
            : `Deleted ${removed} line${removed === 1 ? "" : "s"} at line ${at}`);

      await api.req(
        "/api/script/proposal",
        "PUT",
        {
          proposedDoc: elementsToDoc(lines),
          title: cur.title || "",
          note,
        },
        signal,
      );

      // A small window around the edit so the model can confirm placement and
      // re-index a follow-up edit without a full re-read.
      const from = Math.max(0, at - 1);
      const context = lines
        .slice(from, Math.min(lines.length, at + added + 1))
        .map((el, i) => ({ index: from + i, ...el }));

      return {
        output: {
          ok: true,
          proposed: true,
          op,
          at,
          added,
          removed,
          lineCount: lines.length,
          context,
          hint: "Staged as a proposal — tell the user what you changed and ask if they want it applied. If they confirm, call apply_script_proposal; otherwise they can Accept/Reject (per line) on the Script tab. Indices shifted by this edit — use `context` or re-read before another edit.",
        } as unknown as Json,
      };
    },
  });
