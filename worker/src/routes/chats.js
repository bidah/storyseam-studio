// GET /api/chats + PUT/DELETE /api/chats/:id — WHICH CONVERSATIONS EXIST.
//
// The conversation transcripts live server-side already (flue's Durable
// Object, keyed `userId~projectId~chatId`), but the REGISTRY of chats — ids,
// titles, recency — used to live only in each device's local storage. So a
// chat started on the phone was invisible in the web app's history sheet (and
// vice versa): the transcript sat in Cloudflare waiting to be reopened, and no
// other device knew its id. This route is the shared registry both clients
// sync against.
//
// It stores METADATA only: `{ id, title, titled, createdAt, updatedAt }` per
// chat. Never the transcript (flue owns it) and never the composer's image
// attachments (client-only by design — flue's file parts don't serve
// historical bytes).
//
// PER-USER KEYING, same reasoning as appstate.js: a chat belongs to a person
// working in a project, not to the project — collaborators must not see each
// other's conversations. The doc name carries the user (`chats:<userId>`), so
// each collaborator gets their own row inside the existing `(project_id,
// name)` schema. Every request here is authenticated (the ownership middleware
// fails closed), so `userId` is always the signed-in user.
//
// Timestamps are client clocks (Date.now() ms) on purpose: they only order the
// history list, and the newer-wins merge on both ends is tolerant of skew.
import { readDoc, updateDoc } from "../lib/docs.js";

const DOC_PREFIX = "chats:";
const docNameFor = (userId) => `${DOC_PREFIX}${userId || "anon"}`;

// `source` is the provenance field every doc store carries (history.js
// throttles snapshots per writer). A chat-title bump is bookkeeping, not
// project state — its version history is worth nothing.
const FALLBACK = { source: "chats", chats: {} };

// Mirror the clients' cap so the registry can't grow unbounded — the oldest
// entries fall off, exactly as they do from the local stores.
const MAX_CHATS = 50;
const MAX_TITLE = 200;

const clipTitle = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t;
};

const publicChat = (c) => ({
  id: c.id,
  title: c.title,
  titled: !!c.titled,
  createdAt: c.createdAt ?? null,
  updatedAt: c.updatedAt ?? null,
});

const byRecency = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);

export function registerChats(app) {
  // The user's chats in this project, most recent first.
  app.get("/api/chats", async (c) => {
    const doc = await readDoc(c.env, c.get("projectId"), docNameFor(c.get("userId")), FALLBACK);
    const chats = Object.values(doc?.chats || {}).sort(byRecency).map(publicChat);
    return c.json({ chats });
  });

  // Upsert one chat's metadata. Clients push on real activity only (a blank
  // "New chat" placeholder never syncs), so an entry here is a conversation
  // someone actually had.
  app.put("/api/chats/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const title = clipTitle(body?.title);
    if (!body || !title) return c.json({ error: "Missing title" }, 400);

    const result = await updateDoc(
      c.env,
      c.get("projectId"),
      docNameFor(c.get("userId")),
      FALLBACK,
      (doc) => {
        if (!doc.chats || typeof doc.chats !== "object") doc.chats = {};
        const prev = doc.chats[id] || null;
        const entry = {
          id,
          title,
          titled: !!(body.titled ?? prev?.titled),
          createdAt: Number(body.createdAt ?? prev?.createdAt) || Date.now(),
          updatedAt: Number(body.updatedAt) || Date.now(),
        };
        // Two devices can race: recency never goes backwards, and an AI-locked
        // title (`titled`) is never overwritten by a derived first-line one.
        if (prev) {
          if ((prev.updatedAt || 0) > entry.updatedAt) entry.updatedAt = prev.updatedAt;
          if (prev.titled && !entry.titled) {
            entry.title = prev.title;
            entry.titled = true;
          }
        }
        doc.chats[id] = entry;
        // Cap: shed the oldest entries past MAX_CHATS (the clients trim the
        // same way, so nothing they still list should ever fall off first).
        const all = Object.values(doc.chats).sort(byRecency);
        for (const drop of all.slice(MAX_CHATS)) delete doc.chats[drop.id];
        doc.source = "chats";
        return { chat: publicChat(entry) };
      },
    );
    return c.json(result.chat);
  });

  // Forget a chat everywhere. Deleting an id the registry doesn't have is a
  // no-op success — the client fires this without caring whether the chat ever
  // synced.
  app.delete("/api/chats/:id", async (c) => {
    const id = c.req.param("id");
    await updateDoc(c.env, c.get("projectId"), docNameFor(c.get("userId")), FALLBACK, (doc) => {
      if (!doc.chats?.[id]) return { abort: true };
      delete doc.chats[id];
      doc.source = "chats";
      return {};
    });
    return c.json({ ok: true });
  });
}
