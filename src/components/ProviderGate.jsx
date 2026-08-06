// Point-of-use provider gate. Setup is skippable at login now (see
// components/Login.jsx), so a user can land in the app with no render provider
// connected. The nudge to connect one moves HERE: when a GUI surface tries to
// generate (an image in the Visual world, a render in the Sound studio / Radio)
// and the selected provider has no credential, we pop one shared modal that
// explains it and links to Settings — instead of firing a request that 401s.
//
// One provider is mounted high in the tree (RootLayout) so any surface can call
// `useProviderGate().ensure()` without threading state or duplicating dialogs.
import { createContext, useContext, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { KeyRound, ArrowRight, Settings } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useProviderReady } from "@/lib/providerReady";
import { useT } from "@/lib/i18n";

const GateContext = createContext(null);

// Copy tuned per generation kind; falls back to the generic line.
const KIND_COPY = {
  image: "Generating images renders with your own account. Connect a provider to start — link Higgsfield, or add a fal.ai / Atlas Cloud API key.",
  audio: "Rendering audio runs on your own account. Connect a provider to start — link Higgsfield, or add a fal.ai / Atlas Cloud API key.",
  video: "Rendering video runs on your own account. Connect a provider to start — link Higgsfield, or add a fal.ai / Atlas Cloud API key.",
  default: "Generation renders with your own account. Connect a provider to start — link Higgsfield, or add a fal.ai / Atlas Cloud API key.",
};

export function ProviderGateProvider({ children }) {
  const t = useT();
  const navigate = useNavigate();
  const { ready, loading } = useProviderReady();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("default");
  // Keep the latest ready/loading readable inside the stable `ensure` callback
  // without re-creating it (call sites capture it once).
  const st = useRef({ ready, loading });
  st.current = { ready, loading };

  // Returns true if generation may proceed. When the provider isn't configured,
  // opens the modal and returns false so the caller aborts. While the Higgsfield
  // link state is still loading we let it through (optimistic) rather than
  // flashing the modal at someone who is actually connected.
  const ensure = useCallback((k = "default") => {
    const { ready: r, loading: l } = st.current;
    if (r || l) return true;
    setKind(k in KIND_COPY ? k : "default");
    setOpen(true);
    return false;
  }, []);

  return (
    <GateContext.Provider value={{ ready, ensure }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound size={20} />
            </div>
            <DialogTitle>{t("Connect a render provider")}</DialogTitle>
            <DialogDescription>{t(KIND_COPY[kind] || KIND_COPY.default)}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("Not now")}</Button>
            <Button
              className="gap-2"
              onClick={() => { setOpen(false); navigate("/settings"); }}
            >
              <Settings size={15} /> {t("Open settings")} <ArrowRight size={15} />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GateContext.Provider>
  );
}

// `ready` for surfaces that want to reflect state (e.g. disable a button);
// `ensure(kind)` for the imperative check at the top of a generate handler.
// Safe outside the provider (ensure() becomes a no-op that allows through).
export function useProviderGate() {
  return useContext(GateContext) ?? { ready: true, ensure: () => true };
}
