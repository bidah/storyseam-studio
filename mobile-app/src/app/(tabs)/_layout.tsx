import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSession } from '@/lib/auth-client';
import { useColors } from '@/lib/colors';
import { AgentProvider } from '@/lib/agent/provider';
import { useAgentAccessorySuppressed } from '@/lib/agent/accessory-suppress';
import { AgentAccessory } from '@/components/chat/agent-accessory';
import { QuickComposerOverlay, useQuickComposer } from '@/components/chat/quick-composer';
import { useFalKeyStore } from '@/lib/fal-key';
import { useAtlasKeyStore } from '@/lib/atlas-key';
import { useProvidersStore } from '@/lib/providers';
import { useProjectStore } from '@/lib/project';
import { useProjects } from '@/lib/queries';
import { useDataEvents } from '@/lib/sse';

// Live-sync subscriber — mounted once the project is resolved. Deliberately
// OUTSIDE <AgentProvider>, which renders null until the flue session publishes
// an agent: live-sync must not wait on the chat session to come up.
function LiveSync() {
  useDataEvents();
  return null;
}

// Resolves the active project after sign-in: keep the stored id if the server
// still lists it, otherwise fall back to the server's active project.
function ProjectGate({ children }: { children: React.ReactNode }) {
  const { projectId, hydrated, setProjectId } = useProjectStore();
  const { data, isPending, isError } = useProjects();

  useEffect(() => {
    if (!hydrated || !data) return;
    const ids = new Set((data.projects || []).map((p) => p.id));
    if (projectId && ids.has(projectId)) return;
    const next = data.activeId && ids.has(data.activeId) ? data.activeId : data.projects?.[0]?.id;
    if (next) setProjectId(next);
  }, [hydrated, data, projectId, setProjectId]);

  // Render as soon as we know WHICH project to use — a stored, hydrated id is
  // enough. `useProjects()` only VALIDATES that id (and picks a fallback when
  // it's stale), which the effect above does in the background; blocking the
  // whole tab tree on that round trip meant every cold start showed a spinner
  // for as long as the network took, with the chat's local transcript sitting
  // right there unable to paint. Only a device with no stored project yet has
  // to wait for the list to choose one — including the extra render it takes
  // the effect to store it, so nothing downstream ever sees a null project.
  const adopting = !projectId && !!(data?.activeId || data?.projects?.[0]?.id);
  const ready = hydrated && (!!projectId || (!isPending && !adopting));
  if (!ready && !isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  return <>{children}</>;
}

// A UITabAccessory only makes sense on iOS 26 — older iOS and Android have no
// such slot, and this is the same gate the liquid-glass surfaces already use.
const accessorySupported = isLiquidGlassAvailable();

export default function TabsLayout() {
  const { data: session, isPending } = useSession();
  const { key: falKey, hydrated: falHydrated } = useFalKeyStore();
  const { key: atlasKey, hydrated: atlasHydrated } = useAtlasKeyStore();
  const { active, hydrated: providersHydrated } = useProvidersStore();
  const colors = useColors();
  // One message bar at the bottom of the screen is enough, so the accessory
  // stands down wherever a real <Composer> is docked — a conversation screen
  // (chat/[id]), Story › Visual world's image composer — each of which says so
  // itself via useSuppressAgentAccessory. Everywhere else, INCLUDING the Home
  // tab's landing screen, the pill IS the way to reach the agent: tapping it
  // starts a chat and lands in its conversation with the caret up.
  const suppressed = useAgentAccessorySuppressed();
  // While the pill has "morphed" into the quick composer, the accessory itself
  // stands down — the overlay is its expanded form (see quick-composer.tsx).
  const quickOpen = useQuickComposer((s) => s.open);
  const showAccessory = accessorySupported && !suppressed && !quickOpen;

  if (isPending || !falHydrated || !atlasHydrated || !providersHydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;
  // BYOK step (mirrors the web LoginGate): exactly one provider is in use at
  // a time — Higgsfield's credential is the sign-in itself, so a key is only
  // demanded when the SELECTED provider is fal/Atlas and its key is missing.
  // Waits for SecureStore hydration so stored state never flashes this redirect.
  const needKey = (active === 'fal' && !falKey) || (active === 'atlas' && !atlasKey);
  if (needKey) return <Redirect href="/fal-key" />;

  return (
    <ProjectGate>
      <LiveSync />
      <AgentProvider>
        <View className="flex-1">
        <NativeTabs
          // Selected tab = the high-contrast foreground (near-white on dark,
          // near-black on light), unselected stays the native muted gray. The
          // old lime accent (#CBF74E) failed contrast on a light tab bar; a
          // bold-vs-muted neutral reads well in both schemes (like Apple's own
          // apps) and is accessible.
          iconColor={{ selected: colors.foreground }}
          labelStyle={{ selected: { color: colors.foreground } }}
          // Collapse the tab bar (and with it, re-lay the accessory into its
          // `inline` placement) as you scroll down. iOS 26+.
          //
          // DOES NOT FIRE YET, and not for anything we can fix here: UIKit picks
          // the scroll view to track via `contentScrollView(for:)`, and that
          // lookup can't see a UIScrollView nested inside a native stack — which
          // every tab here is. react-native-screens#4145, open upstream; the
          // `collapsable={false}` workaround from #3954 does not apply. Declared
          // anyway because the intent is right and it starts working the day
          // that lands. Verified dead on an iOS 26.4 simulator (2026-07-27).
          minimizeBehavior="onScrollDown"
        >
          {/* The studio agent, riding above the tab bar so it survives tab
              switches. Toggling the element in and out is what adds/removes the
              UITabAccessory (react-native-screens animates both). */}
          {showAccessory ? (
            <NativeTabs.BottomAccessory>
              <AgentAccessory />
            </NativeTabs.BottomAccessory>
          ) : null}

          {/* Still the `chat` ROUTE (the stack of landing + conversations), but
              presented as Home: it's the recaps-and-suggestions hub, and the
              typing surface is the accessory pill riding the tab bar above. */}
          <NativeTabs.Trigger name="chat">
            <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="house" />
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="story">
            <NativeTabs.Trigger.Label>Story</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="book.pages" />
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="episode">
            <NativeTabs.Trigger.Label>Episode</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="film.stack" />
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="cuts">
            <NativeTabs.Trigger.Label>Cuts</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="scissors" />
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="assets">
            <NativeTabs.Trigger.Label>Assets</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="photo.on.rectangle.angled" />
          </NativeTabs.Trigger>
        </NativeTabs>
        {/* The pill's expanded form, overlaid on the whole tab UI so it can
            morph in from ANY tab. Must live inside <AgentProvider> (it mints
            chats) — and after NativeTabs, so it draws on top. */}
        <QuickComposerOverlay />
        </View>
      </AgentProvider>
    </ProjectGate>
  );
}
