// "Is the selected render provider actually usable?" — one place that answers
// it, shared by the point-of-use gates (the GUI generation modals) and the
// agent send path (projectFetch stamps it as x-flue-render-ready so the agent
// can draw a "connect a provider" card instead of a failed render).
//
// Exactly one provider is active at a time (lib/providers.js). "Ready" means
// that provider has its credential: Higgsfield linked, or the BYOK provider's
// key present. It mirrors the old LoginGate wall — but now the wall is
// skippable and this check runs at the moment of generation instead.

import { getProviderPrefs, useProviderPrefs } from "@/lib/providers";
import { getFalKey, useFalKey } from "@/lib/falKey";
import { getAtlasKey, useAtlasKey } from "@/lib/atlasKey";
import { higgsfieldLinkedNow, useHiggsfieldLinked } from "@/lib/higgsfieldAccount";

// Non-hook read for the fetch shim. Optimistic on the unknown case (Higgsfield
// account list still loading) so we never falsely tell the agent "not ready".
export function getRenderReady() {
  const { active } = getProviderPrefs();
  if (active === "fal") return !!getFalKey();
  if (active === "atlas") return !!getAtlasKey();
  // higgsfield (the default): ready unless the account list has loaded and shows
  // no linked Higgsfield account.
  return higgsfieldLinkedNow() !== false;
}

// Reactive read for components. `loading` is true only while the Higgsfield
// account list is in flight — callers should hold off popping the setup modal
// until it resolves rather than flashing it at a connected user.
export function useProviderReady() {
  const { active } = useProviderPrefs();
  const falKey = useFalKey();
  const atlasKey = useAtlasKey();
  const hfLinked = useHiggsfieldLinked(); // true | false | null | "error"
  if (active === "fal") return { active, ready: !!falKey, loading: false };
  if (active === "atlas") return { active, ready: !!atlasKey, loading: false };
  // higgsfield: null = loading; "error" = couldn't fetch the list, so let renders
  // through and surface their own 401 rather than blocking here.
  return {
    active,
    ready: hfLinked === true || hfLinked === "error",
    loading: hfLinked === null,
  };
}
