// The one theme control: a square icon button, top right of both headers (the
// public HudHeader and the studio's). Light is the default; this flips to the
// dark (Battle Royale) palette and back. See lib/theme.js.
import { Moon, Sun } from "lucide-react";
import { toggleTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }) {
  const dark = useTheme() === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground",
        className,
      )}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
