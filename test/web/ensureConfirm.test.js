import { describe, it, expect } from "vitest";
import { ensureConfirm } from "@/genui/ensure-confirm";

// A program is a dead end when it states the terms of a decision (KeyValue /
// Compare) with nothing to tap — the exact card `render_ui`'s worker guard warns
// about but the client would otherwise render straight from the tool input.
const hasConfirm = (out) =>
  /__confirmActions = Actions\(/.test(out) && /Action\("Confirm", "Yes — go ahead", "primary"\)/.test(out);

describe("ensureConfirm", () => {
  it("appends a go-ahead to a Section+KeyValue card that has no button", () => {
    const out = ensureConfirm(
      `root = Card([sec])
sec = Section("RENDER STORYBOARD STILL (TAKE 2)", [params])
params = KeyValue([{label: "Model", value: "GPT Image 2"}])`,
    );
    expect(out).toContain("root = Card([sec, __confirmActions])");
    expect(hasConfirm(out)).toBe(true);
  });

  it("appends to a bare KeyValue card", () => {
    const out = ensureConfirm(
      `root = Card([params])
params = KeyValue([{label: "Model", value: "seedance_2_0"}], "Confirm render")`,
    );
    expect(out).toContain("root = Card([params, __confirmActions])");
  });

  it("follows a root that points at the Card by name", () => {
    const out = ensureConfirm(
      `root = wrap
wrap = Card([params])
params = KeyValue([{label: "A", value: "b"}])`,
    );
    expect(out).toContain("wrap = Card([params, __confirmActions])");
    expect(hasConfirm(out)).toBe(true);
  });

  it("wraps a root that is a KeyValue directly (no Card to append to)", () => {
    const out = ensureConfirm(`root = KeyValue([{label: "A", value: "b"}], "About to submit")`);
    expect(out).toContain("root = Card([__confirmBody, __confirmActions])");
    expect(out).toContain('__confirmBody = KeyValue([{label: "A", value: "b"}], "About to submit")');
  });

  it("rescues a Compare card with no button", () => {
    const out = ensureConfirm(
      `root = Card([c])
c = Compare([{label: "A", value: "1"}], [{label: "A", value: "2"}])`,
    );
    expect(hasConfirm(out)).toBe(true);
  });

  it("leaves a card that already has an Actions block untouched", () => {
    const prog = `root = Card([params, go])
params = KeyValue([{label: "Model", value: "x"}])
go = Actions([yes])
yes = Action("Confirm", "Go ahead", "primary")`;
    expect(ensureConfirm(prog)).toBe(prog);
  });

  it("leaves a card with an OptionList untouched", () => {
    const prog = `root = Card([opts])
opts = OptionList([o1])
o1 = Option("Seedance", "Render it")`;
    expect(ensureConfirm(prog)).toBe(prog);
  });

  it("leaves a finished MediaGrid result untouched (it is legitimately tap-free)", () => {
    const prog = `root = Card([g])
g = MediaGrid([m1], "Result", 1)
m1 = MediaItem("/x.png", null, "Done")`;
    expect(ensureConfirm(prog)).toBe(prog);
  });

  it("is not fooled by a component name that appears inside a string value", () => {
    const out = ensureConfirm(
      `root = Card([params])
params = KeyValue([{label: "Note", value: "Call to Action (CTA)"}])`,
    );
    expect(hasConfirm(out)).toBe(true);
  });

  it("bails rather than clobber a program that already uses a splice name", () => {
    // A dead-end card (no tappable block) that happens to have defined one of
    // our reserved names: leave it whole instead of colliding on it.
    const prog = `root = Card([params])
params = KeyValue([{label: "A", value: "b"}])
__confirmYes = Text("unrelated", "muted")`;
    expect(ensureConfirm(prog)).toBe(prog);
  });

  it("returns empty input unchanged", () => {
    expect(ensureConfirm("")).toBe("");
    expect(ensureConfirm(null)).toBe("");
  });
});
