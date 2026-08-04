// Async job system for long-running Daytona work (Remotion render, full-episode
// stitch) that can't finish inside one Worker request. The Worker starts a
// DETACHED Daytona session command and stores {sandbox_id, session_id, cmd_id}
// in D1; the client polls GET /api/jobs/:id, which checks the command's status
// on demand (poll-driven — no background worker) and records the result URL.

const newJobId = () => `j_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const nowIso = () => new Date().toISOString();

function shq(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// Daytona returns command logs as either a string or a { stdout, stderr } object
// depending on SDK version. A bare String() on the object yields "[object
// Object]" — which is what a failed render used to record as its only
// diagnostic, destroying the stack trace at the exact moment it mattered.
function logText(logs) {
  if (!logs) return "";
  if (typeof logs === "string") return logs;
  const parts = [logs.stdout, logs.stderr, logs.output, logs.logs].filter((p) => typeof p === "string" && p);
  if (parts.length) return parts.join("\n");
  try {
    return JSON.stringify(logs);
  } catch {
    return "";
  }
}

export async function createJob(env, kind) {
  const id = newJobId();
  const ts = nowIso();
  await env.DB.prepare(
    "INSERT INTO jobs (id, kind, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)",
  ).bind(id, kind, ts, ts).run();
  return id;
}

async function patchJob(env, id, fields) {
  const cols = Object.keys(fields);
  const sets = cols.map((c) => `${c} = ?`).concat("updated_at = ?").join(", ");
  await env.DB.prepare(`UPDATE jobs SET ${sets} WHERE id = ?`)
    .bind(...cols.map((c) => fields[c]), nowIso(), id)
    .run();
}

export async function getJob(env, id) {
  return env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
}

// Start `command` (a bash script) detached in `sandbox`, recording its handles
// on the job. `resultUrl` is what GET /api/jobs/:id returns when it finishes 0.
export async function startSandboxJob(env, jobId, sandbox, command, resultUrl) {
  const sessionId = `sess_${jobId}`;
  await sandbox.process.createSession(sessionId);
  const res = await sandbox.process.executeSessionCommand(sessionId, {
    command: `bash -c ${shq(command)}`,
    runAsync: true,
  });
  const cmdId = res.cmdId || res.commandId || res.id;
  await patchJob(env, jobId, {
    status: "running",
    sandbox_id: sandbox.id,
    session_id: sessionId,
    cmd_id: cmdId,
    result: resultUrl || null,
  });
}

// Poll a job: if still running, ask Daytona for the command's exit status; on
// completion resolve to done (exit 0) or error (with tail logs). `getSandboxById`
// reconstructs the sandbox handle (e.g. daytona.get(id)).
export async function pollJob(env, jobId, getSandboxById) {
  const row = await getJob(env, jobId);
  if (!row || row.status !== "running") return row;
  let sandbox;
  try {
    sandbox = await getSandboxById(row.sandbox_id);
  } catch {
    await patchJob(env, jobId, { status: "error", error: "sandbox gone" });
    return getJob(env, jobId);
  }
  let cmd;
  try {
    cmd = await sandbox.process.getSessionCommand(row.session_id, row.cmd_id);
  } catch {
    return row; // transient; keep running
  }
  const exit = cmd?.exitCode;
  if (exit === null || exit === undefined) return row; // still running

  if (exit === 0) {
    await patchJob(env, jobId, { status: "done" });
  } else {
    let logs = "";
    try { logs = logText(await sandbox.process.getSessionCommandLogs(row.session_id, row.cmd_id)); } catch { /* ignore */ }
    await patchJob(env, jobId, { status: "error", error: `exit ${exit}${logs ? `\n${logs}` : ""}`.slice(-1200) });
  }
  try { await sandbox.process.deleteSession(row.session_id); } catch { /* ignore */ }
  return getJob(env, jobId);
}

// Serialize a job row for the API.
export function jobView(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    ...(row.status === "done" ? { url: row.result } : {}),
    ...(row.status === "error" ? { error: row.error } : {}),
  };
}
