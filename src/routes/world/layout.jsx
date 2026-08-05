import { Outlet, useLocation, useNavigate } from "react-router";
import { BookOpenText, Images, Stethoscope, Workflow } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
const SUBTABS = [
  { value: "written", to: "/world", label: "Written world", icon: BookOpenText },
  { value: "agents", to: "/world/agents", label: "Script agents", icon: Stethoscope },
  { value: "visual", to: "/world/visual", label: "Visual", icon: Images },
  { value: "nodes", to: "/world/nodes", label: "Visual nodes", icon: Workflow },
];

const SEGMENTS = new Set(SUBTABS.map((tab) => tab.value));

function subFromPath(pathname) {
  const seg = pathname.split("/")[2]; // /world/<seg>
  return seg && seg !== "written" && SEGMENTS.has(seg) ? seg : "written";
}

export function Component() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const active = subFromPath(location.pathname);

  return (
    <div className="space-y-5">
      <Tabs value={active} onValueChange={(v) => navigate(SUBTABS.find((tab) => tab.value === v).to)}>
        <TabsList>
          {SUBTABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
              <tab.icon size={14} /> {t(tab.label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Outlet />
    </div>
  );
}
