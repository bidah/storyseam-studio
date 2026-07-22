// Test stub for @flue/runtime.
//
// The flue runtime package isn't a normal npm install — the flue CLI provides it
// at build time — so it isn't resolvable under Vitest. But the tool modules only
// use it for `defineTool` / `defineAgentProfile`, which are thin identity
// factories: they return the definition object the framework later registers.
// Returning the definition verbatim is exactly what a unit test wants — it lets
// us inspect a tool's `name` / `description` / `input` schema and invoke its
// `run` directly against a fake api. We are testing OUR tool definitions, not
// flue's registration internals.

export function defineTool<T>(def: T): T {
  return def;
}

export function defineAgentProfile<T>(def: T): T {
  return def;
}

// Present so a stray value import doesn't explode; tools don't use these.
export function registerProvider(): void {}
export function observe(): void {}
