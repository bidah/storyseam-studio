// Test stub for @flue/runtime.
//
// The flue runtime is a Worker-target package (it imports `cloudflare:workers`
// and is bundled by the flue Vite plugin), so it isn't resolvable under Vitest.
// But the tool modules only use it for `defineTool` / `defineSubagent`, which
// are thin identity factories: they return the definition object the framework
// later registers. Returning the definition verbatim is exactly what a unit test
// wants — it lets us inspect a tool's `name` / `description` / `input` schema
// and invoke its `run` directly against a fake api. We are testing OUR
// definitions, not flue's registration internals.

export function defineTool<T>(def: T): T {
  return def;
}

export function defineSubagent<T>(def: T): T {
  return def;
}

// Hooks. `createSubagents` calls useTool/useSubagent inside each delegate's own
// agent function, so they have to exist — but a bare test render has no frame to
// record onto and the tests only read the returned definitions, so they no-op.
export function useTool(): void {}
export function useSubagent(): void {}
export function useSkill(): void {}
export function useModel(): void {}
export function useSandbox(): void {}
export function useMcpConnection(): void {}

// Present so a stray value import doesn't explode; tools don't use these.
export function setProvider(): void {}
export function observe(): void {}

// `@flue/runtime/cloudflare` resolves here too (one regex alias covers the
// subpaths), so its exports live alongside. `getCloudflareContext` throws
// outside a Worker for real; throwing here keeps the callers' try/catch
// fallbacks — stored model, keys, prefs, sandbox mode — on their default paths.
export function getCloudflareContext(): never {
  throw new Error("[stub] getCloudflareContext() is only valid inside a Worker");
}
export function extend<T>(extension: T): T {
  return extension;
}
export function createSandboxSessionEnv<T>(api: T): T {
  return api;
}
export class SandboxOperationUnsupportedError extends Error {}

// The just-bash wrapper. The real one adapts a Bash instance into a SessionEnv;
// the stub only has to produce something with the right SHAPE, since no test
// executes a command through it.
export function bash(factory: () => unknown) {
  return {
    async createSessionEnv() {
      const instance = (await factory()) as { getCwd?: () => string };
      return {
        exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        readFile: async () => "",
        readFileBuffer: async () => new Uint8Array(),
        writeFile: async () => {},
        stat: async () => ({}),
        readdir: async () => [],
        exists: async () => false,
        mkdir: async () => {},
        rm: async () => {},
        cwd: instance?.getCwd?.() ?? "/home/user",
        resolvePath: (p: string) => p,
      };
    },
  };
}
