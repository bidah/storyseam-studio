import { describe, expect, it } from "vitest";
import { renderUi } from "../../flue-agent/src/tools/render_ui.js";

const run = async (lang: string) => {
  const tool: any = renderUi();
  const out = await tool.run({ data: { lang } });
  return out.output as { presented: boolean; errors?: string[] };
};

describe("render_ui dead-end guard", () => {
  it("rejects the params card with no button (the reported bug)", async () => {
    const r = await run(`root = Card([sec])
sec = Section("Confirm render", [params])
params = KeyValue([{label: "Model", value: "seedance_2_0 (std)"}, {label: "Duration", value: "15s"}])`);
    expect(r.presented).toBe(false);
    expect(r.errors?.[0]).toContain("nothing the author can tap");
  });

  it("accepts the same card once Actions is added", async () => {
    const r = await run(`root = Card([params, go])
params = KeyValue([{label: "Model", value: "seedance_2_0 (std)"}], "Confirm render")
go = Actions([yes, edit])
yes = Action("Confirm — render it", "Go ahead and render MS-01", "primary")
edit = Action("Change something first", "Wait — let me change the params first")`);
    expect(r.presented).toBe(true);
  });

  it("still accepts a tap-free result showcase", async () => {
    const r = await run(`root = Card([intro, grid])
intro = Text("Here's the still.", "body")
grid = MediaGrid([m1])
m1 = MediaItem("/storyboard-media/ms-01.png")`);
    expect(r.presented).toBe(true);
  });

  it("accepts params shown next to the finished result", async () => {
    const r = await run(`root = Card([grid, params])
grid = MediaGrid([m1])
m1 = MediaItem("/storyboard-media/ms-01.png")
params = KeyValue([{label: "Model", value: "nano_banana_pro"}], "Rendered with")`);
    expect(r.presented).toBe(true);
  });

  it("accepts params answered by an OptionList", async () => {
    const r = await run(`root = Card([params, pick])
params = KeyValue([{label: "Duration", value: "15s"}], "Confirm render")
pick = OptionList([a, b], "Which model?")
a = Option("Seedance 2.0", "Render it with Seedance 2.0")
b = Option("Veo 3.1", "Render it with Veo 3.1")`);
    expect(r.presented).toBe(true);
  });

  it("accepts a Compare whose columns carry a send", async () => {
    const r = await run(`root = Card([cmp])
cmp = Compare([c1, c2], "Two ways to cut it")
c1 = Column("Tight", [{label: "Runtime", value: "12s"}], null, "Go with the tight cut")
c2 = Column("Loose", [{label: "Runtime", value: "15s"}], null, "Go with the loose cut")`);
    expect(r.presented).toBe(true);
  });

  it("accepts a params card answered by Chips", async () => {
    const r = await run(`root = Card([params, chips])
params = KeyValue([{label: "Model", value: "seedance_2_0"}], "Confirm render")
chips = Chips(["Render it", "Change the model"])`);
    expect(r.presented).toBe(true);
  });
});
