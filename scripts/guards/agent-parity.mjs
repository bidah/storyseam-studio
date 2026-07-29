// GUARD: a capability the GUI can reach, the agent can reach too.
//
// CLAUDE.md: "Every feature must work both ways: through the GUI and through the
// flue agent, which must be able to run the whole pipeline by itself… a GUI
// button calling a route no tool exposes = a parity gap — close it."
//
// That rule is the one most likely to rot, because breaking it costs nothing at
// the time: the feature works, ships, and demos fine. It only shows up later,
// when the agent is asked to do something the app can obviously do and can't.
//
// How this works: collect every `/api/…` path literal referenced from the web
// client (src/), do the same for the flue tools (flue-agent/src/), and report
// client paths with no tool behind them. Paths are normalised — `${id}` and
// `:param` both become `*` — so a template and a route pattern compare equal.
//
// The gaps that existed when this guard was written live in
// `baselines/agent-parity.txt`. That file is the parity-gap ledger: entries come
// off it as tools get written, and the guard reports any entry that no longer
// fires so stale debt gets deleted instead of accumulating.
//
// The reverse direction is NOT a violation. An agent-only route (the script
// proposal flow, per-shot scoring) is a legitimate design, not a missing button.

import { walk, read, applyBaseline } from "./lib.mjs";

// A quoted /api path. Template literals are included so `\`/api/sounds/${id}\``
// is caught alongside plain strings.
const API_PATH = /["'`](\/api\/[A-Za-z0-9_\-/${}.:]*)["'`]/g;

export const name = "agent-parity";
export const describe = "every GUI-reachable /api route has a flue tool";

// `/api/sounds/${id}/version` → `/api/sounds/*/version`
function normalise(p) {
  return p
    .replace(/\$\{[^}]*\}/g, "*")
    .replace(/\/:[A-Za-z0-9_]+/g, "/*")
    .replace(/\/+$/, "");
}

function collect(dir, exts) {
  const paths = new Set();
  for (const file of walk(dir, exts)) {
    for (const match of read(file).matchAll(API_PATH)) paths.add(normalise(match[1]));
  }
  return paths;
}

export function run() {
  const gui = collect("src", [".js", ".jsx", ".ts", ".tsx"]);
  const agent = collect("flue-agent/src", [".ts"]);

  const gaps = [...gui].filter((p) => !agent.has(p)).sort();
  const { violations, stale } = applyBaseline("agent-parity", gaps);

  const out = violations.map(
    (p) =>
      `${p} is called from the web client but no flue tool reaches it — a parity gap. ` +
      `Add a tool in flue-agent/src/tools/ (and register it in tools/index.ts), or, if ` +
      `it is genuinely GUI-only plumbing, add it to scripts/guards/baselines/agent-parity.txt ` +
      `with a comment saying why.`,
  );
  for (const p of stale) {
    out.push(
      `${p} is listed in baselines/agent-parity.txt but is no longer a gap — delete that line.`,
    );
  }
  return out;
}
