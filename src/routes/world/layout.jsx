import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, useNavigation } from "react-router";
import { BookOpenText, Images, Stethoscope, Workflow } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RouteSkeleton } from "@/components/skeletons";
import { useT } from "@/lib/i18n";

// The World tab's sub-menu: the written world bible, the writers' room (which
// script specialists have read the pinned draft), the visual explorer (chat
// image generator), and the reference-lineage canvas. Driven off the URL segment
// (`/world`, `/world/agents`, `/world/visual`, `/world/nodes`) so each surface is
// its own lazy route (keeps the React Flow canvas out of the main chunk) while
// the top-level tab bar in RootLayout keeps "World" highlighted for all four.
//
// "Script agents" sits next to "Written world" on purpose: both are the written
// side of the world, and the board is where you go straight after reading the
// bible to see who has actually read the script it produced.
//
// `skeleton` is the src/components/skeletons.jsx key shown while that sub-tab's
// loader + lazy chunk resolve (see the pending-Outlet handling below).
const SUBTABS = [
  { value: "written", to: "/world", label: "Written world", icon: BookOpenText, skeleton: "world" },
  { value: "agents", to: "/world/agents", label: "Script agents", icon: Stethoscope, skeleton: "world-agents" },
  { value: "visual", to: "/world/visual", label: "Visual", icon: Images, skeleton: "world-visual" },
  { value: "nodes", to: "/world/nodes", label: "Visual nodes", icon: Workflow, skeleton: "world-nodes" },
];

const SEGMENTS = new Set(SUBTABS.map((tab) => tab.value));

function subFromPath(pathname) {
  const seg = pathname.split("/")[2]; // /world/<seg>
  return seg && seg !== "written" && SEGMENTS.has(seg) ? seg : "written";
}

// True only once `on` has held for `ms` — guards the sub-tab skeleton against
// flashing on a WARM (instant) switch. Mirrors the same helper in RootLayout;
// turns OFF immediately so no skeleton trails once the payload lands.
function useSettled(on, ms = 150) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!on) {
      setSettled(false);
      return;
    }
    const t = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && settled;
}

export function Component() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const active = subFromPath(location.pathname);

  // A COLD sub-tab switch (agents/visual/nodes, on first visit) awaits its
  // loader + lazy chunk, and React Router keeps the CURRENT sub-tab painted the
  // whole time. RootLayout's tab skeleton can't cover it: every World sub-tab
  // shares the "world" top segment, so its `pendingTab !== view` test is always
  // false here. Without this the old panel just sits frozen for the fetch and
  // reads as broken. So mirror the RootLayout pattern locally — move the tab
  // highlight immediately and swap the Outlet for the target sub-tab's skeleton
  // the moment a DIFFERENT sub-tab starts loading.
  //
  // `navigation.location` is set for real navigations only (revalidations use
  // `revalidator.state`), so the SSE firehose / Refresh / agent-idle refetches
  // keep the current sub-tab painted. A navigation OUT of /world falls through
  // (its pathname doesn't start with /world) and RootLayout's top-tab skeleton
  // takes over instead.
  const pendingSub =
    navigation.state === "loading" &&
    navigation.location &&
    navigation.location.pathname.startsWith("/world")
      ? subFromPath(navigation.location.pathname)
      : null;
  const subPending = !!pendingSub && pendingSub !== active;
  const activeSub = subPending ? pendingSub : active; // highlight tracks the click
  const showSkeleton = useSettled(subPending); // but the skeleton waits out a warm load
  const skeletonTab = SUBTABS.find((tab) => tab.value === activeSub)?.skeleton || "world";

  return (
    <div className="space-y-5">
      <Tabs value={activeSub} onValueChange={(v) => navigate(SUBTABS.find((tab) => tab.value === v).to)}>
        <TabsList>
          {SUBTABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
              <tab.icon size={14} /> {t(tab.label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {showSkeleton ? <RouteSkeleton tab={skeletonTab} /> : <Outlet />}
    </div>
  );
}
