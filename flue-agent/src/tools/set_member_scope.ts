import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const setMemberScope = (api: Api) =>
  defineTool({
    name: "set_member_scope",
    description:
      "Change an existing member's access to an org's projects (the 'change the scope later' path). Set allProjects true/false to toggle whole-org reach. Pass grants [{projectId, role}] to add or re-role specific projects (role editor|viewer), and revokeProjectIds to remove specific grants. The org owner's access can't be changed. Returns the updated member roster.",
    input: v.object({
      organizationId: d(v.pipe(v.string(), v.minLength(1)), "Org id from list_orgs."),
      userId: d(v.pipe(v.string(), v.minLength(1)), "The member's user id (from list_members)."),
      allProjects: v.optional(d(v.boolean(), "Toggle whole-org access on/off.")),
      grants: v.optional(
        d(
          v.array(
            v.object({
              projectId: v.pipe(v.string(), v.minLength(1)),
              role: v.optional(v.picklist(["editor", "viewer"]), "editor"),
            }),
          ),
          "Projects to grant or re-role for this member.",
        ),
        [],
      ),
      revokeProjectIds: v.optional(d(v.array(v.string()), "Project grants to remove."), []),
    }),
    async run({ data: input, signal }) {
      const { organizationId, userId, ...body } = input;
      const org = encodeURIComponent(organizationId);
      const uid = encodeURIComponent(userId);
      return { output: await api.post(`/api/orgs/${org}/members/${uid}/scope`, body, signal) };
    },
  });
