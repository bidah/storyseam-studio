// The box a Sitting runs in (Auto, PRD #59 / #69, ADR 0001).
//
// The same pattern every Daytona job here uses (lib/jobs.js — the Deliver
// render, the Musical split, the Stills cut): a reused sandbox found by label,
// one DETACHED session command per sitting, its handles in the `jobs` table,
// polled on the Film job's alarm. On the platform Daytona key (ADR 0003).
//
// What differs is the image: a sitting needs a real browser, so this box is
// node + Playwright + GOOGLE CHROME (the `chrome` channel), not the ffmpeg box.
// Chrome rather than Playwright's bundled Chromium on purpose: the open-source
// Chromium build ships without the proprietary codecs, and the Director's
// WebRTC video is H.264 — negotiation (or decode) would fail headless, and
// MediaRecorder could only write VP8/VP9 WebM.
//
// The command the job runs is `node sit.mjs`: launch Chrome headless with the
// flags a receive-only WebRTC session needs unattended, open the runner page
// (`/sitting-runner.html#t=<token>` on WORKER_PUBLIC_URL), echo its console,
// and exit 0 when the page reports `done`, non-zero on `failed` or timeout.
// The page itself reports progress and uploads the film to the Worker; the
// exit code only tells the job the box is finished.
import { createJob, pollJob, startSandboxJob } from "./jobs.js";

export const SITTING_LABELS = { app: "shot-studio", role: "sitting" };
export const PLAYWRIGHT_VERSION = "1.61.1";

/** The Chrome flags a headless, unattended, receive-only sitting needs. */
export const CHROME_ARGS = [
  // No human to click "play" or "allow": autoplay and media prompts pass.
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  // A headless page must never be treated as hidden and throttled mid-sitting.
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  // Containers: tiny /dev/shm, no user namespaces.
  "--disable-dev-shm-usage",
  "--no-sandbox",
];

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
}

/** The Node driver the box runs. Plain ESM, no build step. */
export function driverSource() {
  return `import { chromium } from "playwright";
const url = process.env.RUNNER_URL;
const deadline = Date.now() + Number(process.env.DEADLINE_MS || 3600000);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ${JSON.stringify(CHROME_ARGS)} });
let code = 1;
try {
  const page = await browser.newPage();
  page.on("console", (m) => console.log(m.text()));
  page.on("pageerror", (e) => console.log("[sitting] pageerror " + (e && e.message)));
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => window.__sitting || null).catch(() => null);
    if (s && s.status === "done") { code = 0; break; }
    if (s && s.status === "failed") { console.log("[sitting] failed " + (s.error || "")); break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (code !== 0 && Date.now() >= deadline) console.log("[sitting] the runner never finished — timed out");
} finally {
  await browser.close().catch(() => {});
}
process.exit(code);
`;
}

/** The bash the detached job runs: write the driver, run it against the page. */
export function sittingScript({ runnerUrl, deadlineMs }) {
  // In /app, beside its node_modules, so `import "playwright"` resolves.
  const driver = `/app/sit-${crypto.randomUUID()}.mjs`;
  return [
    "set -e",
    "cd /app",
    `printf %s ${b64(driverSource())} | base64 -d > ${driver}`,
    `trap 'rm -f ${driver}' EXIT`,
    `RUNNER_URL=${shq(runnerUrl)} DEADLINE_MS=${Math.round(deadlineMs)} node ${driver}`,
  ].join("\n");
}

/** The reused sitting box: found by label, started if stopped, built once. */
export async function getSittingSandbox(env) {
  const { Daytona, Image } = await import("@daytona/sdk");
  const daytona = new Daytona({ apiKey: env.DAYTONA_API_KEY });
  try {
    for await (const s of daytona.list({ labels: SITTING_LABELS })) {
      const st = String(s.state || "").toLowerCase();
      if (st && st !== "started" && st !== "running") {
        try { await s.start(); await s.waitUntilStarted?.(); } catch { break; }
      }
      return s;
    }
  } catch { /* list failed — create a fresh one */ }

  const snapshot = env.DAYTONA_SITTING_SNAPSHOT;
  const base = snapshot
    ? { snapshot }
    : {
        // First run builds the image (slow once, then reused warm). Better:
        // bake it as DAYTONA_SITTING_SNAPSHOT.
        image: Image.base("node:20-bookworm-slim")
          .runCommands("mkdir -p /app")
          .workdir("/app")
          .runCommands(
            "npm init -y",
            `npm i playwright@${PLAYWRIGHT_VERSION}`,
            // Google Chrome stable + every system library it needs.
            "npx playwright install --with-deps chrome",
          ),
        resources: { cpu: 2, memory: 4, disk: 10 },
      };
  return daytona.create(
    { ...base, autoStopInterval: 30, labels: SITTING_LABELS },
    { timeout: 0, onSnapshotCreateLogs: () => {} },
  );
}

/**
 * The real runner.
 *   start(env, { runnerUrl, deadlineMs }) → jobId
 *   poll(env, jobId) → { status: 'running'|'done'|'error', error }
 */
export const daytonaSittingRunner = {
  async start(env, spec) {
    const jobId = await createJob(env, "sitting");
    const sandbox = await getSittingSandbox(env);
    await startSandboxJob(env, jobId, sandbox, sittingScript(spec), null);
    return jobId;
  },
  async poll(env, jobId) {
    const { Daytona } = await import("@daytona/sdk");
    const client = new Daytona({ apiKey: env.DAYTONA_API_KEY });
    const row = await pollJob(env, jobId, (id) => client.get(id));
    if (!row) return { status: "error", error: "the sitting job was lost" };
    if (row.status === "done") return { status: "done", error: null };
    if (row.status === "error") return { status: "error", error: row.error || "the sandbox failed" };
    return { status: "running", error: null };
  },
};
