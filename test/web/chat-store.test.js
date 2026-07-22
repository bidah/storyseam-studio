import { describe, it, expect, vi, beforeEach } from "vitest";

// chat-store scopes itself to the "current project" via projectFetch.getProjectId.
// Drive that from the test so we control which project the store resolves to.
let PID = "p_alpha";
vi.mock("@/lib/projectFetch", () => ({ getProjectId: () => PID }));

import {
  makeChat,
  chatsForProject,
  activeChatId,
  withActiveForProject,
  trimStore,
  loadStore,
  persistStore,
  firstUserText,
  deriveTitle,
  CHATS_LIMIT,
} from "@/lib/chat-store";

const emptyStore = () => ({ activeByProject: {}, order: [], chats: {} });

// Add a chat to a store (most-recent-first, mirroring the app's insert order).
function withChat(store, chat) {
  return {
    ...store,
    order: [chat.id, ...store.order],
    chats: { ...store.chats, [chat.id]: chat },
  };
}

beforeEach(() => {
  PID = "p_alpha";
  localStorage.clear();
});

describe("makeChat", () => {
  it("mints a unique id and tags the project + default title", () => {
    const a = makeChat("p1");
    const b = makeChat("p1");
    expect(a.id).not.toBe(b.id);
    expect(a.projectId).toBe("p1");
    expect(a.title).toBe("New chat");
    expect(a.attachments).toEqual([]);
  });

  it("defaults projectId to null when omitted", () => {
    expect(makeChat().projectId).toBeNull();
  });
});

describe("chatsForProject", () => {
  it("returns only this project's chats in store order", () => {
    let s = emptyStore();
    const a = makeChat("p1");
    const b = makeChat("p2");
    const c = makeChat("p1");
    s = withChat(withChat(withChat(s, a), b), c); // order: [c, b, a]
    expect(chatsForProject(s, "p1").map((x) => x.id)).toEqual([c.id, a.id]);
    expect(chatsForProject(s, "p2").map((x) => x.id)).toEqual([b.id]);
  });
});

describe("activeChatId", () => {
  it("returns the stored pointer when it is valid for the project", () => {
    const a = makeChat("p1");
    const s = { ...withChat(emptyStore(), a), activeByProject: { p1: a.id } };
    expect(activeChatId(s, "p1")).toBe(a.id);
  });

  it("falls back to the newest chat when the pointer is stale", () => {
    const a = makeChat("p1");
    const s = { ...withChat(emptyStore(), a), activeByProject: { p1: "gone" } };
    expect(activeChatId(s, "p1")).toBe(a.id);
  });

  it("returns null when the project has no chats", () => {
    expect(activeChatId(emptyStore(), "p1")).toBeNull();
  });
});

describe("withActiveForProject", () => {
  it("keeps the store identity when the pointer is already valid", () => {
    const a = makeChat("p1");
    const s = { ...withChat(emptyStore(), a), activeByProject: { p1: a.id } };
    expect(withActiveForProject(s, "p1")).toBe(s);
  });

  it("adopts the most-recent existing chat when there is no valid pointer", () => {
    const a = makeChat("p1");
    const s = withChat(emptyStore(), a);
    const next = withActiveForProject(s, "p1");
    expect(next.activeByProject.p1).toBe(a.id);
  });

  it("mints a fresh chat when the project has none", () => {
    const next = withActiveForProject(emptyStore(), "p1");
    const id = next.activeByProject.p1;
    expect(next.chats[id]).toBeTruthy();
    expect(next.chats[id].projectId).toBe("p1");
    expect(next.order[0]).toBe(id);
  });
});

describe("trimStore", () => {
  it("is a no-op under the limit", () => {
    const a = makeChat("p1");
    const s = withChat(emptyStore(), a);
    expect(trimStore(s)).toBe(s);
  });

  it("caps to CHATS_LIMIT but never drops an active chat", () => {
    let s = emptyStore();
    const ids = [];
    for (let i = 0; i < CHATS_LIMIT + 5; i++) {
      const c = makeChat("p1");
      ids.push(c.id);
      s = withChat(s, c); // newest first
    }
    // Make the OLDEST chat (last in order) some project's active pointer.
    const oldest = ids[0];
    s = { ...s, activeByProject: { pX: oldest } };
    const trimmed = trimStore(s);
    expect(trimmed.order.length).toBeLessThanOrEqual(CHATS_LIMIT + 1);
    expect(trimmed.chats[oldest]).toBeTruthy(); // protected despite being oldest
  });
});

describe("loadStore / persistStore (localStorage v2)", () => {
  it("round-trips a persisted store and guarantees an active chat", () => {
    const seeded = withActiveForProject(emptyStore(), "p_alpha");
    persistStore(seeded);
    const loaded = loadStore();
    expect(activeChatId(loaded, "p_alpha")).toBeTruthy();
  });

  it("mints a fresh chat for a project with no history", () => {
    const loaded = loadStore(); // nothing in storage
    expect(chatsForProject(loaded, "p_alpha").length).toBeGreaterThanOrEqual(1);
  });

  it("migrates a legacy v1 store (single global list) onto the current project", () => {
    const c = { id: "old1", title: "legacy", createdAt: 1, updatedAt: 1 };
    localStorage.setItem(
      "shotStudio.chats.v1",
      JSON.stringify({ activeId: "old1", order: ["old1"], chats: { old1: c } }),
    );
    const loaded = loadStore();
    const mine = chatsForProject(loaded, "p_alpha");
    expect(mine.some((x) => x.id === "old1")).toBe(true);
    expect(loaded.chats.old1.projectId).toBe("p_alpha");
  });
});

describe("firstUserText / deriveTitle", () => {
  const msgs = [
    { role: "assistant", parts: [{ type: "text", text: "hello there" }] },
    { role: "user", parts: [{ type: "text", text: "  write   the\nshot list " }] },
  ];

  it("firstUserText returns the first user message, whitespace-collapsed, untrimmed length", () => {
    expect(firstUserText(msgs)).toBe("write the shot list");
  });

  it("returns null when there is no user text", () => {
    expect(firstUserText([{ role: "assistant", parts: [] }])).toBeNull();
    expect(firstUserText([])).toBeNull();
    expect(firstUserText(null)).toBeNull();
  });

  it("deriveTitle uses the first user line", () => {
    expect(deriveTitle(msgs)).toBe("write the shot list");
  });

  it("deriveTitle truncates long lines with an ellipsis to <= 48 chars", () => {
    const long = "x".repeat(80);
    const title = deriveTitle([{ role: "user", parts: [{ type: "text", text: long }] }]);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(48);
  });

  it("deriveTitle returns null with no user text", () => {
    expect(deriveTitle([])).toBeNull();
  });
});
