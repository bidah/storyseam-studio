"use agent";
// One specialist's pass in a Deep Film's writers' room.
//
// The room is the chat's own specialists, not a summary of them: an instance of
// this agent IS one of the fifteen subagents in subagents.ts — the same profile
// (subagents/<id>.md), the same read tools (get_script, get_world, …), the
// same nested experts (the story architect's arc experts, the table read's
// actors) — run as a root agent so a workflow can address it, on the writer
// the author picked for the Film (`model` in its data — Claude or the studio's
// default), like every other writing step of that Film.
//
// It is driven by WritersRoomWorkflow (../cloudflare.ts), one instance per
// (Film, round, specialist): the workflow dispatches the pass, reads the
// settled reply, and reports it to the worker. Nobody is in the loop, so the
// specialist is told to decide rather than ask, and to end on a JSON block the
// workflow can file (summary + findings) beneath its full notes, which go to
// the screenwriter's rewrite whole.
import { useInitialData, useModel } from "@flue/runtime";
import * as v from "valibot";
import { createApi } from "../lib/api.js";
import { roomModel } from "../lib/models.js";
import { createSubagents } from "../subagents.js";

export const RoomPassData = v.object({
  projectId: v.string(),
  userId: v.string(),
  filmId: v.string(),
  specialist: v.string(),
  round: v.number(),
  stage: v.string(),
  episodeId: v.optional(v.nullable(v.string())),
  /** The Film's writer as a flue specifier (lib/models.ts ROOM_MODELS); absent = Claude, as before. */
  model: v.optional(v.nullable(v.string())),
});
export type RoomPassData = v.InferOutput<typeof RoomPassData>;

const ROOM_CONTRACT = `

## You are in a Film's writers' room, not the chat

This pass is part of StorySeam's Auto pipeline: a short Film is being written
from one prompt, with NO author in the loop. That changes three things in your
profile above, and these rules win wherever the profile says otherwise:

- **Nobody will answer a question.** Where your profile says to ask the author
  (which arc, which scene to focus on, what they intended), decide yourself and
  say what you chose in one line.
- **You do not edit anything.** Read the pinned draft with get_script (and the
  world bible with get_world, unless your profile says not to). A screenwriter
  applies this round's notes after every specialist in it has reported, so
  every note must carry the concrete change that fixes it — quote the exact
  line to change, and write the replacement.
- **The Film's constraints bind every note.** Its length, scene count,
  dialogue budget and language, and any lines the author wrote themselves, are
  in the message. A note that breaks them will be overruled.

The characters here are this Film's own — whatever your profile says about
Whistlewood's cast does not apply.

## How your final message must end

Write your whole pass as your profile describes. Then end the SAME final
message with one fenced JSON block, and nothing after it:

\`\`\`json
{ "summary": "one-line verdict", "findings": [{ "severity": "high" | "medium" | "low", "where": "scene or line", "issue": "what is wrong", "fix": "the concrete change" }] }
\`\`\`

Three to eight findings that matter, most story-breaking first. Zero findings
is a real answer when the draft passes your lane.`;

export function WritersRoom(): string {
  const data = useInitialData<RoomPassData>();
  // A pass on a Workers AI writer (Qwen, Kimi) reasons at "low". Left at
  // flue's "medium", or at Qwen's own xhigh when no effort was sent at all, a
  // single turn thought for up to five minutes, and story_architect's pass —
  // its own turns plus the arc expert it delegates to, which inherits this
  // level — took 50. The notes are in the answer, not the thinking. Claude
  // keeps the default.
  const model = roomModel(data?.model);
  useModel(model, model.startsWith("cloudflare/@cf/") ? { thinkingLevel: "low" } : undefined);
  if (!data) return "Say that this writers' room pass was started without its Film, and stop.";
  const api = createApi(data.projectId, data.userId, `room-${data.filmId}`, data.episodeId ?? null);
  const specialist = createSubagents(api, [], { recordReviews: false }).find((s) => s.name === data.specialist);
  if (!specialist) return `Say that "${data.specialist}" is not one of the room's specialists, and stop.`;
  // The subagent's own agent function is a plain function that mounts its
  // tools (and nested experts) with hooks and returns its profile, so calling
  // it here makes this render exactly that specialist.
  const profile = specialist.agent() ?? "";
  return `${profile}${ROOM_CONTRACT}`;
}
WritersRoom.agentName = "writers-room";
WritersRoom.initialData = RoomPassData;
// flue owns a pass's retries — the ONLY retry budget a pass has
// (WritersRoomWorkflow no longer re-dispatches). Three attempts, where an
// attempt is a run cut off by an eviction, a deploy or a stalled model stream
// (lib/output-cap.ts STREAM_IDLE_TIMEOUT_MS); a transient provider error is
// retried inside the attempt. Past the deadline the submission settles failed
// and the workflow's read() rejects, so a pass can never hold the Film for
// longer than this. flue's defaults (10 attempts, 1 hour) are what let one
// silent pass stand for most of an hour.
export const ROOM_PASS_ATTEMPTS = 3;
export const ROOM_PASS_TIMEOUT_MS = 15 * 60_000;
WritersRoom.durability = { maxAttempts: ROOM_PASS_ATTEMPTS, timeoutMs: ROOM_PASS_TIMEOUT_MS };
