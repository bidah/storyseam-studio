import { Outlet, useLocation, useNavigate } from "react-router";
import { BookOpenText, Images, Workflow } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// The World tab's sub-menu: the written world bible, the visual explorer (chat
// image generator), and the reference-lineage canvas. Driven off the URL segment
// (`/world`, `/world/visual`, `/world/nodes`) so each surface is its own lazy
// route (keeps the React Flow canvas out of the main chunk) while the top-level
// tab bar in RootLayout keeps "World" highlighted for all three.
const SUBTABS = [
  { value: "written", to: "/world", label: "Written world", icon: BookOpenText },
  { value: "visual", to: "/world/visual", label: "Visual", icon: Images },
  { value: "nodes", to: "/world/nodes", label: "Visual nodes", icon: Workflow },
];

function subFromPath(pathname) {
  const seg = pathname.split("/")[2]; // /world/<seg>
  return seg === "visual" || seg === "nodes" ? seg : "written";
}

export function Component() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = subFromPath(location.pathname);

  return (
    <div className="space-y-5">
      <Tabs value={active} onValueChange={(v) => navigate(SUBTABS.find((t) => t.value === v).to)}>
        <TabsList>
          {SUBTABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs">
              <t.icon size={14} /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Outlet />
    </div>
  );
}
