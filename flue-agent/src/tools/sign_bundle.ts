import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const signBundle = (api: Api) =>
  defineTool({
    name: "sign_bundle",
    description:
      "Sign off (or clear) one section of an episode bundle: 'images', 'prompt', or 'audio'. Signing records who signed and when; clearing removes the signature. Ask the user for their name (signedBy) if not known.",
    input: v.object({
      bundle: d(v.pipe(v.string(), v.minLength(1)), "Bundle id, e.g. MS-01."),
      section: v.picklist(["images", "prompt", "audio"]),
      signed: d(v.boolean(), "true to sign, false to clear the signature."),
      signedBy: v.optional(
        d(v.string(), "Name of the signer (required when signed=true)."),
      ),
    }),
    async run({ input, signal }) {
      const { bundle, section, signed, signedBy } = input;
      return await api.post(
        "/api/episode/sign",
        { bundle, section, signed, signedBy },
        signal,
      );
    },
  });
