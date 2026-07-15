import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useSession } from '@/lib/auth-client';
import { AgentProvider } from '@/lib/agent/provider';
import { useProjectStore } from '@/lib/project';
import { useProjects } from '@/lib/queries';
import { useDataEvents } from '@/lib/sse';

// Live-sync subscriber — mounted once the project is resolved.
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

  const ready = hydrated && !!projectId && !isPending;
  if (!ready && !isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  return <>{children}</>;
}

export default function TabsLayout() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <ProjectGate>
      <AgentProvider>
        <LiveSync />
        <NativeTabs
          backgroundColor="#0a0a0b"
          iconColor={{ selected: '#CBF74E' }}
          labelStyle={{ selected: { color: '#CBF74E' } }}
        >
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
