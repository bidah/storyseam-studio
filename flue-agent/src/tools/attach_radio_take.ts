import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const attachRadioTake = (api: Api) =>
  defineTool({
    name: "attach_radio_take",
    description:
      "Link a rendered voice take to a Radio-version dialogue line so it shows under that line on the Radio tab (and gets laid into the timeline when the user sends it to the Editor). Call this after create_sound → seed-audio render → attach_sound, passing the same track id + version you just attached. Get line ids from get_radio (scene.lines[].id, e.g. 'sh3'). This APPENDS the take as a new version under the line and auto-selects it — it does not overwrite a prior take, so re-voicing a line keeps the earlier take as a selectable alternative.",
    input: v.object({
      lineId: d(v.pipe(v.string(), v.minLength(1)), "The radio line id from get_radio, e.g. 'sh3'."),
      trackId: d(v.pipe(v.string(), v.minLength(1)), "The Sound Studio track id of the rendered voice take, e.g. 'trk_7'."),
      v: d(v.pipe(v.number(), v.integer(), v.minValue(1)), "The version number of that track that was rendered + attached."),
    }),
    async run({ data: input, signal }) {
      const { lineId, trackId, v } = input;
      return {
        output: await api.req(
          `/api/radio/take/${encodeURIComponent(String(lineId))}`,
          "PUT",
          { trackId, v },
          signal,
        ),
      };
    },
  });
