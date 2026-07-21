import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- *
 * Route skeletons                                                  *
 * ---------------------------------------------------------------- */
//
// Cold-load placeholders for the loaderized tabs. `swr()` only paints instantly
// on a WARM cache; on a cold one the loader awaits the fetch, so React Router
// keeps the previous route on screen (or, on a hard page load, paints nothing at
// all) until the payload lands. These fill that gap.
//
// Two entry points, both resolving through `<RouteSkeleton tab="…" />`:
//   - `HydrateFallback` per route in src/router.jsx  → the hard-reload case
//   - `useNavigation()` in RootLayout               → the tab-to-tab case
//
// Each variant mirrors its route's ACTUAL top-level markup — same wrapper
// classes, same grid columns, same item shape — so the swap to real content
// doesn't reflow. They are deliberately structural copies: if you restructure a
// tab's header or grid, update its variant here too. Size crib: `h2.text-xl` ≈
// h-7, `Badge` ≈ h-5, `Eyebrow`/`text-xs` ≈ h-3, `Button size="sm"` ≈ h-8.

/* ----------------------------- primitives ----------------------------- */

// Two-tier header: title (+ right-aligned actions), then a row of badge pills.
// Shape of world.jsx:526-547, episode.jsx:1308-1322, cuts.jsx:399-421.
function StackedHeader({ titleWidth = "w-52", subtitle = false, actions = [], badges = [], trailingNote = false }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className={cn("h-7", titleWidth)} />
          {subtitle && <Skeleton className="h-4 w-80 max-w-full" />}
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((w, i) => (
              <Skeleton key={i} className={cn("h-9 rounded-md", w)} />
            ))}
          </div>
        )}
      </div>
      {badges.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {badges.map((w, i) => (
            <Skeleton key={i} className={cn("h-5 rounded-full", w)} />
          ))}
          {/* several tabs end the badge row with a plain hint <span> */}
          {trailingNote && <Skeleton className="h-3 w-72 max-w-full" />}
        </div>
      )}
    </div>
  );
}

// Single-row header: title with badges inline beside it (library.jsx:180-187).
function InlineHeader({ titleWidth = "w-44", badges = [], leading = false }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {leading && <Skeleton className="h-8 w-20 rounded-md" />}
      <Skeleton className={cn("h-7", titleWidth)} />
      {badges.map((w, i) => (
        <Skeleton key={i} className={cn("h-5 rounded-full", w)} />
      ))}
    </div>
  );
}

// A shadcn `TabsList` bar (library and sounds both open with one).
function TabsBar({ tabs = [2], className }) {
  return (
    <div className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted/50 p-1", className)}>
      {tabs.map((w, i) => (
        <Skeleton key={i} className={cn("h-7 rounded-md", w)} />
      ))}
    </div>
  );
}

// A `Panel` (shared.jsx:47-58): rounded-xl border bg-card, a border-b px-4 py-3
// header, and a p-4 body.
function PanelSkeleton({ rows = 3, title = true, className, bodyClassName, children }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-16" />
        </div>
      )}
      <div className={cn("space-y-3 p-4", bodyClassName)}>
        {children ??
          Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${92 - i * 11}%` }} />
          ))}
      </div>
    </div>
  );
}

/* ------------------------------ variants ------------------------------ */

// world.jsx:524-663 — "The series" panel, a 2-up Story map / Story depth grid,
// then the Characters panel with its own 2-column card grid.
function WorldSkeleton() {
  const promptRows = (n) =>
    Array.from({ length: n }, (_, i) => (
      <div key={i} className="space-y-1.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 rounded-md" />
      </div>
    ));
  return (
    <div className="space-y-4">
      <StackedHeader
        titleWidth="w-44"
        subtitle // the only tab with a subtitle <p>
        actions={["w-52"]}
        badges={["w-32", "w-32", "w-28"]}
        trailingNote
      />
      <PanelSkeleton bodyClassName="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-9 rounded-md" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 rounded-md" />
        </div>
      </PanelSkeleton>
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelSkeleton className="self-start" bodyClassName="space-y-4">{promptRows(5)}</PanelSkeleton>
        <PanelSkeleton className="self-start" bodyClassName="space-y-4">{promptRows(5)}</PanelSkeleton>
      </div>
      <PanelSkeleton bodyClassName="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
            <Skeleton className="size-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          </div>
        ))}
      </PanelSkeleton>
    </div>
  );
}

// radio.jsx:249-336 — scene panels beside the casting rail.
function RadioSkeleton() {
  return (
    <div className="space-y-4">
      <StackedHeader titleWidth="w-40" actions={["w-44", "w-32"]} badges={["w-24", "w-36"]} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, s) => (
            <PanelSkeleton key={s} bodyClassName="space-y-3">
              {Array.from({ length: 4 }, (_, l) => (
                <div key={l} className="flex items-start gap-3">
                  <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3.5" style={{ width: `${90 - l * 9}%` }} />
                    <Skeleton className="h-3.5 w-1/3" />
                  </div>
                  <Skeleton className="size-8 shrink-0 rounded-md" />
                </div>
              ))}
            </PanelSkeleton>
          ))}
        </div>
        {/* `self-start` — a grid item stretches to the row height by default,
            which drew the casting rail as one column-tall empty box. */}
        <PanelSkeleton className="self-start" bodyClassName="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </PanelSkeleton>
      </div>
    </div>
  );
}

// shotlist.jsx:108-128 — pack rail beside the shot rows.
function ShotlistSkeleton() {
  return (
    <div className="space-y-4">
      <StackedHeader titleWidth="w-36" actions={["w-36", "w-24"]} badges={["w-24", "w-28"]} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <PanelSkeleton className="self-start" bodyClassName="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 rounded-md" />
          ))}
        </PanelSkeleton>
        <div className="space-y-3">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border bg-card p-4">
              <Skeleton className="h-14 w-24 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3.5" style={{ width: `${80 - i * 6}%` }} />
              </div>
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// library.jsx:576-206 — a Tabs bar, then the folder grid (2/3/4/5 columns,
// aspect-video thumbs with a two-line caption).
function LibrarySkeleton() {
  return (
    <div className="space-y-4">
      <TabsBar tabs={["w-16", "w-40"]} />
      <InlineHeader titleWidth="w-40" badges={["w-24", "w-44"]} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border bg-card">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// sounds.jsx:868-895 — header, a 3-way Tabs bar, a right-aligned "new" button,
// then a stack of track Panels (NOT media cards).
function SoundsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-7 w-44" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-32 rounded-full" />
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
      </div>
      <TabsBar tabs={["w-36", "w-28", "w-28"]} />
      <div className="mt-4 space-y-4">
        <div className="flex justify-end">
          <Skeleton className="h-9 w-48 rounded-md" />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <PanelSkeleton key={i} bodyClassName="space-y-3">
            {Array.from({ length: 2 }, (_, v) => (
              <div key={v} className="flex items-center gap-3 rounded-lg border p-3">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
                <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
              </div>
            ))}
          </PanelSkeleton>
        ))}
      </div>
    </div>
  );
}

// episode.jsx:1308-1325 — full-width bundle cards, each with a dense toolbar
// header (mono id badge + name on the left; badges, a segmented toggle and a
// couple of buttons on the right).
function EpisodeSkeleton() {
  return (
    <div className="space-y-4">
      <StackedHeader
        titleWidth="w-64"
        actions={["w-48"]}
        badges={["w-36", "w-28", "w-44"]}
        trailingNote
      />
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-44" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
                {/* the segmented storyboard/video toggle */}
                <Skeleton className="h-8 w-40 rounded-md" />
                <Skeleton className="h-7 w-24 rounded-md" />
                <Skeleton className="h-7 w-20 rounded-md" />
              </div>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, s) => (
                <div key={s} className="space-y-2">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// cuts.jsx:399-479 — hero player Panel, then the "Stitch order" Panel whose
// body is an <ol> of full-width rows.
function CutsSkeleton() {
  return (
    <div className="space-y-4">
      <StackedHeader
        titleWidth="w-72"
        actions={["w-24", "w-44", "w-48"]}
        badges={["w-24", "w-28", "w-32"]}
        trailingNote
      />
      <PanelSkeleton bodyClassName="space-y-3">
        <Skeleton className="aspect-video w-full rounded-lg" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </PanelSkeleton>
      <PanelSkeleton bodyClassName="space-y-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
            <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
            <Skeleton className="h-3.5" style={{ width: `${34 - i * 2}%` }} />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="ml-auto h-3 w-24" />
          </div>
        ))}
      </PanelSkeleton>
    </div>
  );
}

// shots.jsx:143-207 — NO page header; straight into a 5-column table whose
// rows are ~260px tall (two min-h-[220px] textareas per row).
function ShotsSkeleton() {
  // Mirrors the real <colgroup> (shots.jsx:147-150). A CSS grid, not flex:
  // percentage-width flex items plus a gap overflow their track and the body
  // columns drift out of line with the header.
  const grid = { gridTemplateColumns: "6% 30% 26% 20% 18%" };
  const cell = "min-w-0 px-3";
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border">
        <div className="grid border-b bg-muted/60 py-2.5" style={grid}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={cell}>
              <Skeleton className="h-4 w-full max-w-20" />
            </div>
          ))}
        </div>
        {Array.from({ length: 3 }, (_, r) => (
          <div key={r} className="grid border-b py-3 last:border-b-0 odd:bg-muted/20" style={grid}>
            <div className={cell}>
              <Skeleton className="h-4 w-full max-w-10" />
            </div>
            <div className={cell}>
              <Skeleton className="h-[220px] w-full rounded-md" />
            </div>
            <div className={cell}>
              <Skeleton className="h-[220px] w-full rounded-md" />
            </div>
            <div className={cn(cell, "space-y-3")}>
              <Skeleton className="h-3 w-full max-w-16" />
              <Skeleton className="h-9 w-full rounded-full" />
              <Skeleton className="h-3 w-full max-w-16" />
              <Skeleton className="h-9 w-full rounded-full" />
            </div>
            <div className={cell}>
              <Skeleton className="aspect-video w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// multishot.jsx:155-172 — header with right-aligned badges, a hero slideshow
// Panel split 1.4fr/1fr, then a 3-column Panel grid.
function MultishotSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-7 w-56" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <PanelSkeleton bodyClassName="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-3" />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-32 w-full rounded-md" />
          </div>
        </div>
      </PanelSkeleton>
      <div className="grid gap-4 lg:grid-cols-3">
        <PanelSkeleton className="self-start" bodyClassName="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <Skeleton className="h-4 w-24 rounded-full" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </PanelSkeleton>
        <PanelSkeleton className="self-start" bodyClassName="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="h-2.5 w-full" />
            </div>
          ))}
        </PanelSkeleton>
        <PanelSkeleton className="self-start" bodyClassName="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-28 rounded-full" />
              <Skeleton className="h-9 w-full rounded-full" />
            </div>
          ))}
        </PanelSkeleton>
      </div>
    </div>
  );
}

// Tab → skeleton. Keys match the route paths in src/router.jsx.
const SKELETONS = {
  world: WorldSkeleton,
  shotlist: ShotlistSkeleton,
  radio: RadioSkeleton,
  shots: ShotsSkeleton,
  multishot: MultishotSkeleton,
  episode: EpisodeSkeleton,
  cuts: CutsSkeleton,
  library: LibrarySkeleton,
  sounds: SoundsSkeleton,
};

// The only export the app renders. Unknown / unloaderized tabs (script, editor)
// fall back to a neutral panel stack rather than nothing.
export function RouteSkeleton({ tab }) {
  const Variant = SKELETONS[tab];
  return (
    <div aria-busy="true" aria-live="polite" className="animate-in fade-in duration-200">
      <span className="sr-only">Loading {tab}…</span>
      {Variant ? (
        <Variant />
      ) : (
        <div className="space-y-4">
          <StackedHeader badges={["w-24", "w-28"]} />
          <PanelSkeleton rows={5} />
          <PanelSkeleton rows={3} />
        </div>
      )}
    </div>
  );
}

export default RouteSkeleton;
