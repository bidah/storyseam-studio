import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";

const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));

export const readDocument = (api: Api) =>
  defineTool({
    name: "read_document",
    description:
      "Read the text of a file the user attached to the chat (a PDF, .txt, .md, .csv, .docx, .html …). Pass the attachment's absolute `/files/…` URL exactly as it appears in the message. Returns { name, mimetype, chars, offset, text, truncated, nextOffset }. USE THIS when a message carries an `Attached document(s)` block marked `<<<TRUNCATED …>>>` — the block inlines only the first slice of a long file, and this is how you read the rest: call again with `offset` set to `nextOffset` until `truncated` is false. You do NOT need it for a document that arrived complete (no TRUNCATED marker) — the text is already in front of you. It does not work on images: an attached image is something you SEE via its reference URL, not something you read.",
    input: v.object({
      url: d(
        v.string(),
        "The attachment's absolute URL from the message's document/reference block, e.g. \"https://…/files/chat-uploads/<id>-notes.pdf\".",
      ),
      offset: v.optional(
        d(
          v.number(),
          "Character offset to start reading from — pass the previous call's `nextOffset` to continue a long document. Defaults to 0 (the beginning).",
        ),
      ),
      limit: v.optional(
        d(
          v.number(),
          "How many characters to return in this call. Defaults to 100000, capped at 400000.",
        ),
      ),
    }),
    async run({ input, signal }) {
      return await api.post(
        "/api/extract",
        { url: input.url, offset: input.offset, limit: input.limit },
        signal,
      );
    },
  });
