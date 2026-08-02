import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const viewScreen = (api: Api) =>
  defineTool({
    name: "view_screen",
    description:
      "What the author is looking at RIGHT NOW — the tab they have open and the rows they have selected, with the LIVE records hydrated. Call this BEFORE acting on any vague on-screen reference — \"this shot\", \"that cut\", \"the one I'm looking at\", \"make it wider\", \"rename this\", \"the selected ones\" — instead of asking \"which one?\". They are staring at MS-014; asking is a round trip the app can already answer. Also call it when a request names no target at all (\"add a close-up after this\") or when you are about to guess between candidates. Returns { navigation, selection, screen, reportedAt }: `navigation` is the reported pointer ({ view, path, plus ids like shotId / cutV }); `screen` is that view hydrated — shotlist → the shot list plus `openShot` (the full record of the shot they have open); world → the character + location roster with sheet/voice coverage; script → the pinned draft's title, draftId, line count; cuts / editor → the cut history and `openCut`; sounds → the tracks with version counts; radio / animatic / episode → coverage counts; `selection` resolves { kind, ids } into the real records (kind \"shot\" | \"character\" | \"location\" | \"sound\" | \"cut\" | \"bundle\" | \"draft\"). Everything under `screen` is read fresh from the database on this call, never a stored copy, so it is still correct after your own edits. Cheap — a couple of document reads; prefer calling it over asking. get_status and this answer DIFFERENT questions: get_status is the whole-pipeline digest (how far along the episode is); view_screen is the current screen (what they mean by \"this\"). If nothing has been reported the response says so in `screen.message` — then ask.",
    async run({ signal }) {
      return { output: await api.get("/api/appstate/screen", signal) };
    },
  });
