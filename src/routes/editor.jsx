import Editor from "@/components/Editor";
import { useShell } from "@/lib/shellContext";

// Editor tab (Remotion timeline). Manages heavy local state, so it stays
// effect-driven (no loader — see the migration plan §2). Phase 4 lazy-loads this
// module to keep the Remotion deps out of the main bundle.
export function Component() {
  const { reloadKey } = useShell();
  return <Editor reloadKey={reloadKey} />;
}
