import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, useSegments } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSession } from '@/lib/auth-client';
import { useColors } from '@/lib/colors';
import { AgentProvider } from '@/lib/agent/provider';
import { useAgentAccessorySuppressed } from '@/lib/agent/accessory-suppress';
import { AgentAccessory } from '@/components/chat/agent-accessory';
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

// Which tab is showing, latched. `useSegments()` reports the CURRENT route
// globally, so a root-level modal or sheet (/model-picker, /viewer, …) reads as
// no tab at all; latching keeps the last real answer instead of letting the
// accessory pop back in behind a sheet that was opened from the chat tab.
function useFocusedTab(): string | undefined {
  const segments = useSegments();
  const tab = segments[0] === '(tabs)' ? (segments[1] as string | undefined) : undefined;
  // Adjusted during render (React's "derive state from props" escape hatch)
  // rather than in an effect: an effect would re-render every route change, and
  // the answer has to be right on the FIRST render after one — the accessory is
  // mounted from it.
  const [latched, setLatched] = useState(tab);
  if (tab && tab !== latched) setLatched(tab);
  return tab ?? latched;
}

export default function TabsLayout() {
  const { data: session, isPending } = useSession();
  const { key: falKey, hydrated: falHydrated } = useFalKeyStore();
  const { key: atlasKey, hydrated: atlasHydrated } = useAtlasKeyStore();
  const { active, hydrated: providersHydrated } = useProvidersStore();
  const colors = useColors();
  const focusedTab = useFocusedTab();
  // One message bar at the bottom of the screen is enough, so the accessory
  // stands down wherever a real <Composer> is already docked: the whole Chat
  // tab, plus any screen that says so itself (Story › Visual world, which has
  // its own image composer). Everywhere else it IS the way to reach the agent.
  const suppressed = useAgentAccessorySuppressed();
  const showAccessory = accessorySupported && focusedTab !== 'chat' && !suppressed;

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

          <NativeTabs.Trigger name="chat">
            <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="bubble.left.and.text.bubble.right" />
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
      </AgentProvider>
    </ProjectGate>
  );
}
