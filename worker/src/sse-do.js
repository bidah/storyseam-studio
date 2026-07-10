// ProjectEvents — a Durable Object that holds the live-sync SSE connections for
// ONE project (the Worker addresses it with idFromName(projectId), so there is
// exactly one instance per project, and all of a project's isolates route to it).
//
// It replaces the Express server's in-memory Sets (`scriptClients` /
// `timelineClients` in server/index.js) + `broadcastScript` / `broadcastTimeline`.
// A Cloudflare Worker can't hold a cross-isolate connection set the way a single
// long-lived Node process can, so the connections live here instead.
//
// Two logical channels share the instance, filtered by a `channel` query param:
//   - "script"   → GET /api/script/events   (was scriptClients / broadcastScript)
//   - "timeline" → GET /api/timeline/events  (was timelineClients / broadcastTimeline)
//
// Wire format matches Express exactly: `: connected`, a `: ping` heartbeat
// (~25s), and `data: <json>` frames. Payload shape is unchanged, e.g.
// { at, clientId } — browsers ignore the echo of their own clientId.
//
// Internal HTTP contract (spoken only by worker/src/index.js, never the browser):
//   GET  /subscribe?channel=script|timeline   → text/event-stream (one client)
//   POST /broadcast?channel=script|timeline    → body is the JSON payload; fans
//                                                out to every open writer on that
//                                                channel. Returns { ok, sent }.

import { DurableObject } from "cloudflare:workers";

const HEARTBEAT_MS = 25000;
const encoder = new TextEncoder();

export class ProjectEvents extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // channel -> Set<WritableStreamDefaultWriter>. In-memory only; a DO instance
    // is single-threaded, so no locking is needed. If the instance is evicted the
    // sockets drop and browsers (EventSource) reconnect on their own.
    this.channels = new Map();
    // A single shared heartbeat timer, live only while at least one writer is
    // open, so an idle project keeps no timers.
    this.heartbeat = null;
  }

  fetch(request) {
    const url = new URL(request.url);
    const channel = url.searchParams.get("channel") || "script";
    if (url.pathname === "/subscribe") return this.subscribe(channel);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.broadcast(channel, request);
    }
    return new Response("Not found", { status: 404 });
  }

  // Open one SSE client on `channel`. Returns a streaming text/event-stream
  // Response whose body stays open until the client disconnects.
  subscribe(channel) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(writer);

    // Opening greeting (matches Express `res.write(": connected\n\n")`).
    this.write(channel, writer, ": connected\n\n");

    this.ensureHeartbeat();

    // Detect disconnect: when the client goes away the readable side is cancelled
    // and `writer.closed` rejects. Either way we drop the dead writer.
    writer.closed
      .catch(() => {})
      .finally(() => this.drop(channel, writer));

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Fan a JSON payload out to every open writer on `channel`.
  async broadcast(channel, request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    const set = this.channels.get(channel);
    let sent = 0;
    if (set) {
      for (const writer of set) {
        if (await this.write(channel, writer, frame)) sent++;
      }
    }
    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Best-effort write; a failed write means a dead socket, so drop it. Returns
  // true on success. Never throws (no unhandled rejections).
  async write(channel, writer, text) {
    try {
      await writer.write(encoder.encode(text));
      return true;
    } catch {
      this.drop(channel, writer);
      return false;
    }
  }

  drop(channel, writer) {
    const set = this.channels.get(channel);
    if (set) {
      set.delete(writer);
      if (set.size === 0) this.channels.delete(channel);
    }
    try {
      // May already be closed/errored; ignore.
      writer.close().catch(() => {});
    } catch {
      /* ignore */
    }
    if (this.totalWriters() === 0) this.stopHeartbeat();
  }

  totalWriters() {
    let n = 0;
    for (const set of this.channels.values()) n += set.size;
    return n;
  }

  ensureHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const [channel, set] of this.channels) {
        for (const writer of set) this.write(channel, writer, ": ping\n\n");
      }
    }, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
