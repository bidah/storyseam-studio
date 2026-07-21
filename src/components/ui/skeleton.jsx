import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}) {
  return (
    <div
      data-slot="skeleton"
      // shadcn ships this as `bg-accent`, but THIS theme's accent is the lime
      // brand hue (oklch(0.32 0.06 123) in dark) — a wall of skeletons in it
      // reads as loud olive blocks, not neutral placeholders. `muted` is the
      // near-achromatic surface token and is what a placeholder should use.
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props} />
  );
}

export { Skeleton }
