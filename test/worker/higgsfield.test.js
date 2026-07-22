import { describe, it, expect } from "vitest";
import { isAllowedMediaUrl, HiggsfieldAuthError } from "../../worker/src/lib/higgsfield.js";

describe("isAllowedMediaUrl (SSRF guard for media pulls)", () => {
  it("allows Higgsfield's own https delivery hosts", () => {
    expect(isAllowedMediaUrl("https://higgsfield.ai/x.mp4")).toBe(true);
    expect(isAllowedMediaUrl("https://cdn.higgsfield.ai/x.mp4")).toBe(true);
    expect(isAllowedMediaUrl("https://d123.cloudfront.net/x.mp4")).toBe(true);
  });

  it("rejects non-https schemes", () => {
    expect(isAllowedMediaUrl("http://higgsfield.ai/x.mp4")).toBe(false);
    expect(isAllowedMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedMediaUrl("ftp://higgsfield.ai/x")).toBe(false);
  });

  it("rejects other hosts, including look-alikes", () => {
    expect(isAllowedMediaUrl("https://evil.com/x.mp4")).toBe(false);
    expect(isAllowedMediaUrl("https://higgsfield.ai.evil.com/x")).toBe(false);
    expect(isAllowedMediaUrl("https://notcloudfront.net/x")).toBe(false);
  });

  it("rejects garbage / empty input without throwing", () => {
    expect(isAllowedMediaUrl("")).toBe(false);
    expect(isAllowedMediaUrl(null)).toBe(false);
    expect(isAllowedMediaUrl("not a url")).toBe(false);
  });

  it("exports a distinct auth-error type", () => {
    expect(new HiggsfieldAuthError("x")).toBeInstanceOf(Error);
  });
});
