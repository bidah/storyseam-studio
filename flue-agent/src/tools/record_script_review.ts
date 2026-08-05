import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import { SPECIALIST_IDS } from "../lib/specialists.js";
import type { Api, Json } from "../lib/api.js";

// The specialists' own log book. Each script doctor calls this as its LAST act,
// so the app and the root agent can tell "plot-doctor has never read this
// script" from "plot-doctor cleared it an hour ago" — the state the chat's
// suggestion cards use to offer the doctor that hasn't looked yet. The draft and
// revision are snapshotted worker-side from the pinned draft, so a pass can only
// ever be stamped onto what the doctor actually read.
//
// The whitelist is the SHARED roster (lib/specialists.ts, vendored from the web
// copy) rather than a list of ids retyped here — adding a specialist used to
// mean editing this picklist too, and forgetting it made the new doctor's pass
// bounce with a 400 it had no way to interpret. The worker validates against the
// same roster authoritatively, so a runtime-derived picklist is enough here.
const specialistIds = SPECIALIST_IDS as [string, ...string[]];

export const recordScriptReview = (api: Api) =>
  defineTool({
    name: "record_script_review",
    description:
      "Log that you finished a pass over the script. Call this ONCE as the LAST thing you do, after you have delivered your findings — including when you found nothing to fix (a clean pass is a real result and must be recorded too). It writes no script content and changes nothing the user sees in the editor; it only records that this specialist read this revision, which is what stops the app from suggesting the same review over and over. The pass is invalidated automatically when the script is next edited, so never worry about 'is it still valid' — just record what you did. Repeat passes are KEPT as history (with a lifetime pass count), not overwritten, so running the same specialist again is a first-class action — a second swing at the same text, or a re-check after the author revised by hand — and every pass shows up on the Script Agents board.",
    input: v.object({
      specialist: d(
        v.picklist(specialistIds),
        "Your own name — the specialist that just ran.",
      ),
      summary: d(
        v.string(),
        "One line, in plain language, on what this pass concluded — shown to the user as the review's headline (e.g. \"Act 2 sags: the midpoint reversal lands 8 pages late\"). Max 600 chars.",
      ),
      findings: d(
        v.optional(v.number()),
        "How many distinct issues you raised (0 for a clean pass).",
      ),
      notes: d(
        v.optional(
          v.pipe(
            v.array(
              v.object({
                severity: d(
                  v.picklist(["high", "medium", "low"]),
                  "How much this one matters: \"high\" breaks the story or the shoot, \"medium\" is worth fixing before the next stage, \"low\" is a polish note.",
                ),
                where: d(
                  v.string(),
                  "Where in the script this lands, so the author can find it without searching: a scene slug (\"INT. SCHOOLHOUSE - DAY\"), a character name, or the line cue itself. Max 160 chars.",
                ),
                issue: d(
                  v.string(),
                  "The defect, in ONE sentence — what is actually wrong, not what you would do about it. Max 400 chars.",
                ),
                fix: d(
                  v.string(),
                  "The concrete change that resolves it — specific enough to act on (\"cut the last two lines and let her walk out on the question\"), never \"consider revising\". Max 400 chars.",
                ),
              }),
            ),
            v.maxLength(24),
          ),
        ),
        "Your findings as STRUCTURE, in the order you would fix them (most story-breaking first), max 24. This is IN ADDITION to the prose report you write in your final message — never instead of it. The app renders these as an accept/reject checklist the author works through; the prose is what they actually read to understand the pass. A pass with `findings: 4` and no notes shows a badge with nothing behind it, so send the notes whenever you raised anything at all. Omit it entirely for a clean pass.",
      ),
    }),
    async run({ data: input, signal }) {
      const { specialist, summary, findings, notes } = input as {
        specialist: string;
        summary: string;
        findings?: number;
        notes?: Array<{
          severity: string;
          where: string;
          issue: string;
          fix: string;
        }>;
      };
      const res = (await api.post(
        "/api/script/reviews",
        { specialist, summary, findings, notes },
        signal,
      )) as unknown as { entry?: { draftName?: string; passes?: number } };
      return {
        output: {
          ok: true,
          recorded: specialist,
          draft: res?.entry?.draftName ?? null,
          passes: res?.entry?.passes ?? null,
        } as Json,
      };
    },
  });
