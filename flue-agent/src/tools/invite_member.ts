import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const inviteMember = (api: Api) =>
  defineTool({
    name: "invite_member",
    description:
      "Invite someone by email into an organization, choosing HOW MUCH of it they see. scopeMode 'all' → every current and future project in the org. scopeMode 'selection' → only the projectIds you pass (get them from list_orgs/the project list). role 'member' (default) or 'admin' (an admin manages the whole org and its members). projectRole 'editor' (default) or 'viewer' (read-only) applies to the selected projects. The invitee receives an email at their address with the accept link; the response also returns `inviteUrl` as a fallback you can share manually.",
    input: v.object({
      organizationId: d(v.pipe(v.string(), v.minLength(1)), "Org id from list_orgs."),
      email: d(v.pipe(v.string(), v.email()), "Invitee's email address."),
      scopeMode: v.optional(
        d(v.picklist(["all", "selection"]), "'all' = whole org; 'selection' = only projectIds. Default selection."),
        "selection",
      ),
      projectIds: v.optional(
        d(v.array(v.string()), "Project ids to grant when scopeMode is 'selection'."),
        [],
      ),
      role: v.optional(
        d(v.picklist(["member", "admin"]), "Org role. 'admin' can manage the org; default 'member'."),
        "member",
      ),
      projectRole: v.optional(
        d(v.picklist(["editor", "viewer"]), "Access on the selected projects. Default editor."),
        "editor",
      ),
    }),
    async run({ data: input, signal }) {
      const { organizationId, ...body } = input;
      const org = encodeURIComponent(organizationId);
      return { output: await api.post(`/api/orgs/${org}/invitations`, body, signal) };
    },
  });
