// The project's production type, as the author sees it: a badge that labels any
// card belonging to the production, and the picker that sets it on the World tab.
//
// The badge exists because the type silently changes what a shot IS — a
// live-action shot's Seedance prompt is a block document, a 2D one is a
// paragraph — so a card showing shots or bundles without saying which kind of
// production it belongs to is a card you can misread.
import { Clapperboard, Boxes, PenTool } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { PRODUCTION_TYPES, productionTypeMeta } from "@/lib/productionType";

const ICONS = {
  "2d": PenTool,
  "3d-pixar": Boxes,
  "live-action": Clapperboard,
};

// Top-right-of-header pill. `long` spells the full label out (page headers);
// the default is the short form that fits beside a row of other badges.
export function ProductionTypeBadge({ value, long, className }) {
  const t = useT();
  const meta = productionTypeMeta(value);
  const Icon = ICONS[meta.id];
  return (
    <Badge
      variant={meta.id === "live-action" ? "info" : "muted"}
      className={cn("shrink-0 gap-1", className)}
      title={t("Production type — set it on the World tab")}
    >
      <Icon size={11} /> {t(long ? meta.label : meta.short)}
    </Badge>
  );
}

// The World tab's selector. Three buttons rather than a <select>: the choice is
// consequential (it decides which shot-list skill runs), and a closed dropdown
// hides the two options the author didn't pick.
export function ProductionTypePicker({ value, onChange, disabled }) {
  const t = useT();
  const active = productionTypeMeta(value).id;
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRODUCTION_TYPES.map((p) => {
        const Icon = ICONS[p.id];
        const on = p.id === active;
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => !on && onChange(p.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50",
              on ? "border-primary bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted",
            )}
          >
            <Icon size={13} className={on ? "text-primary" : "text-muted-foreground"} />
            {t(p.label)}
          </button>
        );
      })}
    </div>
  );
}
