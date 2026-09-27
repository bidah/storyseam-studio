"use agent";
// One specialist's pass in a Deep Film's writers' room.
//
// The room is the chat's own specialists, not a summary of them: an instance of
// this agent IS one of the fifteen subagents in subagents.ts — the same profile
// (subagents/<id>.md), the same read tools (get_script, get_world, …), the
// same nested experts (the story architect's arc experts, the table read's
// actors) — run as a root agent so a workflow can address it, on Claude Fable.
// The Film's FAST writer (Kimi / Qwen) never reaches the room: Deep is the
// slow, strong path.
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
import { ROOM_MODEL } from "../lib/models.js";
import { createSubagents } from "../subagents.js";

export const RoomPassData = v.object({
  projectId: v.string(),
  userId: v.string(),
  filmId: v.string(),
  specialist: v.string(),
  round: v.number(),
  stage: v.string(),
  episodeId: v.optional(v.nullable(v.string())),
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
  useModel(ROOM_MODEL);
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
