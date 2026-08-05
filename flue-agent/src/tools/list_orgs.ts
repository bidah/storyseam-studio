import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listOrgs = (api: Api) =>
  defineTool({
    name: "list_orgs",
    description:
      "List the organizations (teams/workspaces) the current user belongs to. Each has an `id`, `name`, `personal` flag (their auto-created solo workspace), `role` (owner/admin/member) and `isOwner`. Call this FIRST to get the `organizationId` that invite_member / list_members / set_member_scope need — the user's own projects live in their `personal: true` org.",
    async run({ signal }) {
      return { output: await api.get("/api/orgs", signal) };
    },
  });
