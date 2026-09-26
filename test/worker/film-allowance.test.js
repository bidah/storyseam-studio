import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { makeDocsDB } from "./_fakes.js";
import {
  checkAllowance,
  countFilm,
  periodOf,
  resetsAtOf,
  DEFAULT_MONTHLY_LIMIT,
} from "../../worker/src/lib/film-allowance.js";
import { registerFilmAllowance } from "../../worker/src/routes/film-allowance.js";

// The real migration DDL, so a column rename there fails here rather than in prod.
const SCHEMA = readFileSync(
  new URL("../../worker/migrations/003-film-allowance.sql", import.meta.url),
  "utf8",
);
const makeEnv = () => ({ DB: makeDocsDB(SCHEMA) });

const MID_SEPT = new Date("2026-09-15T12:00:00Z");

describe("month window", () => {
  it("is the UTC calendar month, resetting on the 1st", () => {
    expect(periodOf(new Date("2026-08-31T23:59:59Z"))).toBe("2026-08");
    expect(periodOf(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09");
    expect(resetsAtOf(MID_SEPT).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(resetsAtOf(new Date("2026-12-31T10:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("checkAllowance", () => {
  it("defaults to 10 with nothing used", async () => {
    const env = makeEnv();
    const a = await checkAllowance(env, "u1", MID_SEPT);
    expect(a).toMatchObject({
      ok: true,
      limit: DEFAULT_MONTHLY_LIMIT,
      used: 0,
      remaining: 10,
      resetsAt: "2026-10-01T00:00:00.000Z",
    });
    expect(DEFAULT_MONTHLY_LIMIT).toBe(10);
  });

  it("refuses the 11th Film with a message naming the number and the reset date", async () => {
    const env = makeEnv();
    for (let i = 1; i <= 10; i++) {
      expect((await checkAllowance(env, "u1", MID_SEPT)).ok).toBe(true);
      await countFilm(env, "u1", { filmId: `f${i}`, kind: "new" }, MID_SEPT);
    }
    const a = await checkAllowance(env, "u1", MID_SEPT);
    expect(a).toMatchObject({ ok: false, used: 10, remaining: 0, limit: 10 });
    expect(a.message).toContain("10");
    expect(a.message).toContain("1 October 2026");
  });

  it("honours a creator override row", async () => {
    const env = makeEnv();
    await env.DB.prepare(
      "INSERT INTO film_allowances (user_id, monthly_limit, updated_at) VALUES (?, ?, ?)",
    )
      .bind("u1", 2, "2026-09-01T00:00:00Z")
      .run();
    await countFilm(env, "u1", { filmId: "a", kind: "new" }, MID_SEPT);
    await countFilm(env, "u1", { filmId: "b", kind: "new" }, MID_SEPT);
    expect(await checkAllowance(env, "u1", MID_SEPT)).toMatchObject({ ok: false, limit: 2 });
    expect(await checkAllowance(env, "u2", MID_SEPT)).toMatchObject({ ok: true, limit: 10 });
  });

  it("is scoped per user", async () => {
    const env = makeEnv();
    await countFilm(env, "u1", { filmId: "a", kind: "new" }, MID_SEPT);
    expect((await checkAllowance(env, "u2", MID_SEPT)).used).toBe(0);
  });
});

describe("countFilm counting rules", () => {
  it("new +1, reshoot +1, rescore 0, failed 0", async () => {
    const env = makeEnv();
    const used = async () => (await checkAllowance(env, "u1", MID_SEPT)).used;

    expect(await countFilm(env, "u1", { filmId: "f1", kind: "new" }, MID_SEPT)).toMatchObject({ counted: true });
    expect(await used()).toBe(1);
    expect(await countFilm(env, "u1", { filmId: "f1@v2", kind: "reshoot" }, MID_SEPT)).toMatchObject({ counted: true });
    expect(await used()).toBe(2);
    expect(await countFilm(env, "u1", { filmId: "f1@v3", kind: "rescore" }, MID_SEPT)).toMatchObject({ counted: false });
    expect(await used()).toBe(2);
    expect(await countFilm(env, "u1", { filmId: "f2", kind: "failed" }, MID_SEPT)).toMatchObject({ counted: false });
    expect(await used()).toBe(2);
  });

  it("is idempotent per filmId", async () => {
    const env = makeEnv();
    await countFilm(env, "u1", { filmId: "f1", kind: "new" }, MID_SEPT);
    const again = await countFilm(env, "u1", { filmId: "f1", kind: "new" }, MID_SEPT);
    expect(again).toMatchObject({ counted: false, duplicate: true });
    expect((await checkAllowance(env, "u1", MID_SEPT)).used).toBe(1);
  });

  it("rejects an unknown kind and a missing filmId", async () => {
    const env = makeEnv();
    await expect(countFilm(env, "u1", { filmId: "f", kind: "bogus" })).rejects.toThrow(/kind/);
    await expect(countFilm(env, "u1", { kind: "new" })).rejects.toThrow(/filmId/);
  });

  it("counts a Film on the 31st and one on the 1st in separate months", async () => {
    const env = makeEnv();
    const aug31 = new Date("2026-08-31T23:59:00Z");
    const sep1 = new Date("2026-09-01T00:01:00Z");
    // Fill August to the limit on the 31st.
    for (let i = 0; i < 10; i++) await countFilm(env, "u1", { filmId: `aug${i}`, kind: "new" }, aug31);
    expect((await checkAllowance(env, "u1", aug31)).ok).toBe(false);
    // The 1st is a fresh month.
    const sept = await checkAllowance(env, "u1", sep1);
    expect(sept).toMatchObject({ ok: true, used: 0, remaining: 10 });
    await countFilm(env, "u1", { filmId: "sep0", kind: "new" }, sep1);
    expect((await checkAllowance(env, "u1", sep1)).used).toBe(1);
    expect((await checkAllowance(env, "u1", aug31)).used).toBe(10);
  });
});

describe("GET /api/auto/allowance", () => {
  const appFor = (env, userId) => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      if (userId) c.set("userId", userId);
      await next();
    });
    registerFilmAllowance(app);
    return (path) => app.request(path, {}, env);
  };

  it("returns the signed-in user's allowance", async () => {
    const env = makeEnv();
    await countFilm(env, "u1", { filmId: "f1", kind: "new" });
    const res = await appFor(env, "u1")("/api/auto/allowance");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, limit: 10, used: 1, remaining: 9 });
  });

  it("401s without an identity", async () => {
    const res = await appFor(makeEnv(), null)("/api/auto/allowance");
    expect(res.status).toBe(401);
  });
});
