import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const listMembers = (api: Api) =>
  defineTool({
    name: "list_members",
    description:
      "List the members of an organization and each one's access scope: `role` (owner/admin/member), `allProjects` (sees every project in the org), and `grants` (the specific projects a scoped member can reach, each with its editor/viewer role). Use the `organizationId` from list_orgs.",
    input: v.object({
      organizationId: d(v.pipe(v.string(), v.minLength(1)), "Org id from list_orgs."),
    }),
    async run({ data: input, signal }) {
      const org = encodeURIComponent(input.organizationId);
      return { output: await api.get(`/api/orgs/${org}/members`, signal) };
    },
  });
