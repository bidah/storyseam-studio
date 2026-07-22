import { describe, it, expect } from "vitest";
import { encodeInstanceId, decodeInstanceId } from "../../flue-agent/src/lib/instance-id";

describe("instance id codec (userId~projectId~chatId)", () => {
  it("round-trips a full triple", () => {
    const id = encodeInstanceId({ userId: "u1", projectId: "p1", chatId: "c1" });
    expect(id).toBe("u1~p1~c1");
    expect(decodeInstanceId(id)).toEqual({ userId: "u1", projectId: "p1", chatId: "c1" });
  });

  it("encodes a null project as an empty middle segment and decodes it back to null", () => {
    const id = encodeInstanceId({ userId: "u1", projectId: null, chatId: "c1" });
    expect(id).toBe("u1~~c1");
    expect(decodeInstanceId(id)).toEqual({ userId: "u1", projectId: null, chatId: "c1" });
  });

  it("rejects malformed ids (wrong arity or missing required parts)", () => {
    expect(decodeInstanceId(null)).toBeNull();
    expect(decodeInstanceId("")).toBeNull();
    expect(decodeInstanceId("u1~p1")).toBeNull(); // only two segments
    expect(decodeInstanceId("u1~p1~c1~extra")).toBeNull(); // four segments
    expect(decodeInstanceId("~p1~c1")).toBeNull(); // missing userId
    expect(decodeInstanceId("u1~p1~")).toBeNull(); // missing chatId
  });
});
