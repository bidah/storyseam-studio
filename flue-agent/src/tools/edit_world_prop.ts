import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

const image = v.object({
  rel: v.optional(v.string()),
  url: v.optional(v.string()),
  thumb: v.optional(v.string()),
  name: v.optional(v.string()),
});

export const editWorldProp = (api: Api) =>
  defineTool({
    name: "edit_world_prop",
    description:
      "Add, edit or remove ONE prop on the World roster (the World tab's Props). A PROP is an object the story turns on — a weapon, bag, tool, phone, lantern, instrument — designed APART from the characters: a character's appearance and sheet are the person only, EMPTY-HANDED, and a prop is drawn as its own sheet and handed to a shot as its own reference image. So when a character carries something that matters, register it here instead of writing it into their appearance. `action: \"add\"` mints and returns the prop's id (call get_world first and skip a name already on the roster); `\"update\"` and `\"remove\"` need the `id` from get_world. Removing a prop deletes only the roster entry, never its sheet image.",
    input: v.object({
      action: d(v.picklist(["add", "update", "remove"]), "What to do."),
      id: v.optional(d(v.string(), "The prop's id (from get_world). Required for update and remove.")),
      name: v.optional(d(v.string(), "The prop's name, e.g. \"Brass Lantern\".")),
      description: v.optional(d(v.string(), "What the object looks like alone — shape, size, material, colours, wear.")),
      owner: v.optional(d(v.string(), "The character who usually carries it, by World name exactly, or empty.")),
      sheetImage: v.optional(v.nullable(d(image, "Linked prop-sheet image from the project library ({ rel, url }), or null to unlink."))),
    }),
    async run({ data: input, signal }) {
      const { action, id, ...fields } = input;
      if (action === "add") return { output: await api.post("/api/world/prop", fields, signal) };
      if (!id) throw new Error(`edit_world_prop: '${action}' needs the prop's id (from get_world).`);
      const propId = encodeURIComponent(String(id));
      const path = `/api/world/prop/${propId}`;
      if (action === "remove") return { output: await api.req(path, "DELETE", undefined, signal) };
      return { output: await api.req(path, "PUT", fields, signal) };
    },
  });
