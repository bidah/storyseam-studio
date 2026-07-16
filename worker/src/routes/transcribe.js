import { Buffer } from "node:buffer";

// Speech-to-text via Cloudflare Workers AI (Whisper). The mobile chat composer
// records a short .m4a voice message and POSTs the raw audio bytes here; we run
// @cf/openai/whisper-large-v3-turbo and hand back { text } for the composer to
// drop into the input. Session-gated like the rest of /api/* (the project
// ownership middleware in index.js also runs, so a signed-in user with an
// active project is required).
export function registerTranscribe(app) {
  app.post("/api/transcribe", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);

    const buf = await c.req.arrayBuffer();
    // Guard against empty / truncated captures (see the reference app's <100B
    // check) — Whisper on an empty clip just wastes a neuron call.
    if (!buf || buf.byteLength < 100) {
      return c.json({ error: "Audio is empty or too short" }, 400);
    }

    try {
      const base64 = Buffer.from(buf).toString("base64");
      const res = await c.env.AI.run("@cf/openai/whisper-large-v3-turbo", {
        audio: base64,
      });
      return c.json({ text: (res?.text || "").trim() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: `Transcription failed: ${msg}` }, 500);
    }
  });
}
