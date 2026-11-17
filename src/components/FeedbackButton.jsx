// The "Feedback" button. PostHog's "Feedback" survey (type widget, selector
// `#storyseam-feedback`, in the storyseam project) opens its form from any
// element with this id — so there is no form here, only the trigger. The
// click is tracked too, so we see how often it's reached for. Without a
// PostHog token (local builds) the survey can't load, so the button hides.
//
// One per screen: the home page and a Film's page draw the floating pill, the
// studio puts it in its header beside "Use MCP".
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyticsEnabled, track } from "@/lib/analytics";
import { MONO } from "@/lib/hudTheme";
import { useT } from "@/lib/i18n";

export const FEEDBACK_ID = "storyseam-feedback";

const onClick = () => track("feedback_clicked", { path: window.location.pathname });

export function FeedbackButton({ variant = "pill" }) {
  const t = useT();
  if (!analyticsEnabled) return null;
  if (variant === "header") {
    return (
      <Button id={FEEDBACK_ID} variant="outline" size="sm" onClick={onClick}>
        <MessageSquareText size={13} /> {t("Feedback")}
      </Button>
    );
  }
  return (
    <button
      id={FEEDBACK_ID}
      type="button"
      onClick={onClick}
      className="fixed bottom-4 left-4 z-40 flex items-center gap-1.5 border border-muted-foreground/40 bg-background/85 px-3 py-1.5 text-[0.72rem] uppercase text-muted-foreground backdrop-blur transition-colors hover:border-foreground hover:text-foreground"
      style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
    >
      <MessageSquareText size={12} aria-hidden /> {t("Feedback")}
    </button>
  );
}
