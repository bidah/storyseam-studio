// /billing — the author's plan and agent-usage credit, reachable from the
// account menu everywhere (the homepage's HudHeader and the studio's
// UserMenu). A SIBLING of RootLayout like /waitlist: billing belongs to the
// USER, not to a project, so it must open without one. The same panel also
// sits in a project's Settings.
import { Link, Navigate } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { Splash } from "@/components/Login";
import { HudHeader } from "@/components/HudHeader";
import { SubscriptionPanel } from "@/components/SubscriptionPanel";
import { HUD, BODY } from "@/lib/hudTheme";
import { useT } from "@/lib/i18n";

export function Component() {
  const t = useT();
  const { data: session, isPending } = useSession();
  if (isPending) return <Splash />;
  if (!session) return <Navigate to="/login?next=/billing" replace />;

  return (
    <div
      className="flex min-h-dvh flex-col bg-[var(--br-neutral)] px-4 pb-12 text-[var(--br-primary)] sm:px-8"
      style={{ ...HUD, fontFamily: BODY, fontSize: "0.92rem", lineHeight: 1.5 }}
    >
      <div className="mx-auto w-full max-w-7xl">
        <HudHeader />
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> {t("Back")}
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("Plan & billing")}</h1>
          <p className="text-sm text-muted-foreground">{t("Your plan, the agent credit it buys, and what you've used this month.")}</p>
        </div>
        <SubscriptionPanel />
      </div>
    </div>
  );
}
