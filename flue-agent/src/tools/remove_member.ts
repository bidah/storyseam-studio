import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const removeMember = (api: Api) =>
  defineTool({
    name: "remove_member",
    description:
      "Remove someone from an organization — drops their membership and every per-project grant they had in it. The org owner cannot be removed. Get organizationId from list_orgs and userId from list_members.",
    input: v.object({
      organizationId: d(v.pipe(v.string(), v.minLength(1)), "Org id from list_orgs."),
      userId: d(v.pipe(v.string(), v.minLength(1)), "The member's user id (from list_members)."),
    }),
    async run({ data: input, signal }) {
      const org = encodeURIComponent(input.organizationId);
      const uid = encodeURIComponent(input.userId);
      return { output: await api.req(`/api/orgs/${org}/members/${uid}`, "DELETE", undefined, signal) };
    },
  });
