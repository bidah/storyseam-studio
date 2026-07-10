import ScriptEditor from "@/components/ScriptEditor";
import { useShell } from "@/lib/shellContext";

// Script tab. TipTap owns its own document lifecycle, so this stays effect-driven
// (no loader — see the migration plan §2): reloadKey/liveKey come from the shell.
export function Component() {
  const { reloadKey, scriptEdits } = useShell();
  return <ScriptEditor reloadKey={reloadKey} liveKey={scriptEdits} />;
}
