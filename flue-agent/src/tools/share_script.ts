import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";

// The GUI's Share dialog and the mobile Share button hit the same routes, so
// this tool is the parity half: enable returns the SAME link they would get
// (minting is idempotent server-side), revoke kills every copy of it.
export const shareScript = (api: Api) =>
  defineTool({
    name: "share_script",
    description:
      "Turn the script's public read-only share link on or off. Returns a URL anyone can open without signing in — it shows the PINNED draft with full screenplay formatting, no editing, and always reflects the latest saved version. Idempotent: calling again returns the same link. Pass revoke:true to stop sharing, which immediately kills every copy of the link (a later share mints a fresh one).",
    input: v.object({
      revoke: v.optional(
        d(v.boolean(), "true to stop sharing (revoke the current link) instead of enabling it."),
      ),
    }),
    async run({ input, signal }) {
      const { revoke } = (input ?? {}) as { revoke?: boolean };
      if (revoke) {
        await api.req("/api/script/share", "DELETE", undefined, signal);
        return { shared: false } as Json;
      }
      const res = (await api.post("/api/script/share", {}, signal)) as unknown as { url?: string };
      return { shared: true, url: res.url ?? null } as Json;
    },
  });
