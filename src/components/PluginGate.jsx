import { useState } from "react";
import { Link } from "react-router";
import { Blocks, Check, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel, Eyebrow, ErrorNote } from "@/components/shared";
import { usePlugins } from "@/components/PluginsProvider";
import { useT } from "@/lib/i18n";

// What you see when you open a plugin's tab and don't have the plugin.
//
// Deliberately NOT an error screen. Landing here is ordinary — an agent
// `navigate`, a bookmark, a teammate's link — and the honest reading is "this
// exists, you just haven't added it", so the panel is the marketplace card for
// that plugin with the Install button attached. Installing re-runs the gate in
// RootLayout, which then renders the real route: no reload, no second click.
export function PluginGate({ plugin }) {
  const t = useT();
  const { install } = usePlugins();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!plugin) return null;

  const onInstall = async () => {
    setBusy(true);
    setError(null);
    try {
      await install(plugin.id);
      // No navigation: the gate above us re-evaluates and this panel unmounts.
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl py-10">
      <Panel>
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex size-11 items-center justify-center rounded-none bg-primary/10 text-primary">
            <Blocks size={20} />
          </div>

          <div className="space-y-2">
            <Eyebrow className="flex items-center justify-center gap-2">
              {t("Plugin")}
              <Badge variant="muted">{t(plugin.category)}</Badge>
            </Eyebrow>
            <h1 className="text-xl font-semibold">{t(plugin.name)}</h1>
            <p className="text-sm text-muted-foreground">{t(plugin.tagline)}</p>
          </div>

          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {t(plugin.blurb)}
          </p>

          {plugin.highlights?.length > 0 && (
            <ul className="w-full max-w-sm space-y-2 text-left">
              {plugin.highlights.map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                  <span>{t(line)}</span>
                </li>
              ))}
            </ul>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="flex flex-col items-center gap-3 pt-1">
            <Button onClick={onInstall} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {busy ? t("Installing…") : t("Install {name}", { name: t(plugin.name) })}
            </Button>
            <Button variant="link" size="sm" asChild>
              <Link to="/plugins">{t("Browse all plugins")}</Link>
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export default PluginGate;
