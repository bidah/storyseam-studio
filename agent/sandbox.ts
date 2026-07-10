import { defineSandbox, defaultBackend } from "eve/sandbox";

// `defaultBackend()` picks the sandbox by host at runtime: on Vercel it uses the
// **Vercel Sandbox** (real microVMs, auto-authenticated via the deployment's
// VERCEL_OIDC_TOKEN), and locally it falls back to the dependency-free pure-JS
// `just-bash` interpreter so `eve dev` starts instantly.
//
// We previously pinned `justbash()`, but that backend provisions its template on
// disk under `.eve/sandbox-cache/`, which is NOT shipped into the Vercel
// serverless function bundle — so on the deployed agent every sandbox tool
// (`bash`, `load_skill`, and skill execution) failed with
// `SandboxTemplateNotProvisionedError`. The Vercel Sandbox needs no bundled
// template, so it works in the serverless runtime.
export default defineSandbox({
  backend: defaultBackend(),
});
