// BackendProvider / useBackend — the React context that injects an EditorBackend
// into the tree. Mirrors web-editor/src/providers/storage/index.js: modules NEVER
// import a transport directly; they call `useBackend()`. Swap the `backend` prop
// (or the default) to retarget storage without touching any feature module.
// Web reference: /docs/connectors/storage-client ↔ this: /docs/react-native/storage
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createLocalBackend } from "./local";
import { createCutsBackend } from "./cuts";
import type { EditorBackend } from "./types";

const BackendContext = createContext<EditorBackend | null>(null);

export function BackendProvider({
  backend,
  children,
}: {
  backend?: EditorBackend;
  children: ReactNode;
}) {
  const value = useMemo(() => backend ?? createLocalBackend(), [backend]);
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend(): EditorBackend {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error("useBackend must be used within a <BackendProvider>");
  return ctx;
}

export { createLocalBackend, createCutsBackend };
export type { EditorBackend, Pool, PoolItem, Still, RenderResult } from "./types";
