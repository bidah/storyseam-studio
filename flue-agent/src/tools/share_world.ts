import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";

// The parity half of the World tab's Share toggle (same /api/share-config route
// the GUI's Share dialog PUTs). The world and the script share ONE project link —
// enabling either mints it, so the URL this returns is the same canonical link,
// deep-linked to the World tab (?tab=world).
export const shareWorld = (api: Api) =>
  defineTool({
    name: "share_world",
    description:
      "Turn the written world's public read-only share link on or off. Returns a URL anyone can open without signing in — it shows the world bible (story map, story depth, characters and locations) with images, no editing, always reflecting the latest saved version. Idempotent: calling again returns the same link. Pass revoke:true to stop sharing the world (the shared script, if any, stays live).",
    input: v.object({
      revoke: v.optional(
        d(v.boolean(), "true to stop sharing the world instead of enabling it."),
      ),
    }),
    async run({ input, signal }) {
      const { revoke } = (input ?? {}) as { revoke?: boolean };
      const res = (await api.req(
        "/api/share-config",
        "PUT",
        { world: !revoke },
        signal,
      )) as unknown as { worldUrl?: string | null };
      return { shared: !revoke, url: revoke ? null : res.worldUrl ?? null } as Json;
    },
  });
