import { describe, it, expect } from "vitest";
import { makeD1, makeSandbox } from "./_fakes.js";
import {
  createJob,
  getJob,
  startSandboxJob,
  pollJob,
  jobView,
} from "../../worker/src/lib/jobs.js";

const envWith = (d1) => ({ DB: d1 });

describe("jobView", () => {
  it("is null for a missing row", () => {
    expect(jobView(null)).toBeNull();
  });

  it("surfaces the result url only when done", () => {
    expect(jobView({ id: "j1", kind: "render", status: "done", result: "/gen/out.mp4" })).toEqual({
      id: "j1",
      kind: "render",
      status: "done",
      url: "/gen/out.mp4",
    });
  });

  it("surfaces the error only when errored", () => {
    const v = jobView({ id: "j1", kind: "stitch", status: "error", error: "boom", result: "x" });
    expect(v).toEqual({ id: "j1", kind: "stitch", status: "error", error: "boom" });
    expect(v).not.toHaveProperty("url");
  });

  it("exposes neither url nor error while running", () => {
    const v = jobView({ id: "j1", kind: "render", status: "running", result: "x", error: "y" });
    expect(v).toEqual({ id: "j1", kind: "render", status: "running" });
  });
});

describe("createJob / getJob", () => {
  it("inserts a pending job with a j_ id and reads it back", async () => {
    const env = envWith(makeD1());
    const id = await createJob(env, "render");
    expect(id).toMatch(/^j_[a-f0-9]+$/);
    const row = await getJob(env, id);
    expect(row).toMatchObject({ id, kind: "render", status: "pending" });
  });

  it("getJob returns null for an unknown id", async () => {
    expect(await getJob(envWith(makeD1()), "nope")).toBeNull();
  });
});

describe("startSandboxJob", () => {
  it("opens a session, runs the command detached, and records the handles", async () => {
    const env = envWith(makeD1());
    const id = await createJob(env, "render");
    const sandbox = makeSandbox({ id: "sbx_9", cmdId: "cmd_42" });

    await startSandboxJob(env, id, sandbox, "remotion render", "/gen/out.mp4");

    const row = await getJob(env, id);
    expect(row).toMatchObject({
      status: "running",
      sandbox_id: "sbx_9",
      session_id: `sess_${id}`,
      cmd_id: "cmd_42",
      result: "/gen/out.mp4",
    });
    expect(sandbox._seen.commands[0]).toMatchObject({ runAsync: true });
    expect(sandbox._seen.commands[0].command).toContain("bash -c");
  });
});

describe("pollJob", () => {
  async function running(env, kind = "render") {
    const id = await createJob(env, kind);
    await startSandboxJob(env, id, makeSandbox(), "cmd", "/gen/out.mp4");
    return id;
  }

  it("returns the row unchanged when the job is not running", async () => {
    const env = envWith(makeD1());
    const id = await createJob(env, "render"); // still pending
    const row = await pollJob(env, id, async () => makeSandbox());
    expect(row.status).toBe("pending");
  });

  it("marks the job done on exit 0 and cleans up the session", async () => {
    const env = envWith(makeD1());
    const id = await running(env);
    const sandbox = makeSandbox({ exitCode: 0 });
    const row = await pollJob(env, id, async () => sandbox);
    expect(row.status).toBe("done");
    expect(sandbox._seen.deleted).toContain(`sess_${id}`);
  });

  it("marks the job error on a non-zero exit, keeping tail logs", async () => {
    const env = envWith(makeD1());
    const id = await running(env);
    const sandbox = makeSandbox({ exitCode: 1, logs: "ffmpeg exploded" });
    const row = await pollJob(env, id, async () => sandbox);
    expect(row.status).toBe("error");
    expect(row.error).toContain("ffmpeg exploded");
  });

  it("errors the job when the sandbox is gone", async () => {
    const env = envWith(makeD1());
    const id = await running(env);
    const row = await pollJob(env, id, async () => {
      throw new Error("404 sandbox");
    });
    expect(row.status).toBe("error");
    expect(row.error).toBe("sandbox gone");
  });

  it("keeps running (returns the row) on a transient status-check failure", async () => {
    const env = envWith(makeD1());
    const id = await running(env);
    const sandbox = makeSandbox({ throwOn: { getSessionCommand: true } });
    const row = await pollJob(env, id, async () => sandbox);
    expect(row.status).toBe("running");
  });

  it("keeps running while the command has no exit code yet", async () => {
    const env = envWith(makeD1());
    const id = await running(env);
    const sandbox = makeSandbox({ exitCode: undefined }); // null/undefined ⇒ still running
    const row = await pollJob(env, id, async () => sandbox);
    expect(row.status).toBe("running");
  });
});
