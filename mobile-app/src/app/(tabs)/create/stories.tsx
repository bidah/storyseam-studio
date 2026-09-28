import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clapperboard, X } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { formatLength, myFilms, STATUS_LABEL, type MyFilm } from '@/lib/film';
import { useAdoptProject } from '@/lib/use-adopt-project';
import { useManualRefresh } from '@/lib/use-manual-refresh';

// Latest stories — the author's Films, newest first, as a formSheet over the
// Create tab (the web's Latest stories modal). Tapping one closes the sheet and
// opens that Film's steps in the Create stack.

function StoryRow({ film, onPress }: { film: MyFilm; onPress: () => void }) {
  const colors = useColors();
  const title = film.title || film.prompt || 'Untitled story';
  const meta = [
    STATUS_LABEL[film.status] ?? film.status,
    film.seconds ? formatLength(film.seconds) : null,
    film.createdAt ? new Date(film.createdAt).toLocaleDateString() : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.story, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.storyIcon}>
        <Clapperboard size={16} color={film.status === 'done' ? colors.primary : colors.mutedForeground} />
      </View>
      <View style={styles.storyText}>
        <Text style={styles.storyTitle} numberOfLines={1}>
          {title}
        </Text>
        {film.title && film.prompt ? (
          <Text style={styles.storyPrompt} numberOfLines={2}>
            {film.prompt.slice(0, 240)}
          </Text>
        ) : null}
        <Text style={styles.storyMeta}>{meta}</Text>
      </View>
      <ChevronRight size={16} color={colors.subtleForeground} />
    </Pressable>
  );
}

export default function LatestStoriesSheet() {
  const colors = useColors();
  const adopt = useAdoptProject();
  const films = useQuery({ queryKey: ['account', 'films'], queryFn: myFilms, staleTime: 15_000 });
  const list = films.data?.films ?? [];
  // Only a pull shows the spinner — not the background refetch on open.
  const { refreshing, onRefresh } = useManualRefresh(films.refetch);

  const open = (f: MyFilm) => {
    adopt(f.projectId);
    // Close the sheet first, then push the Film onto the Create stack under it —
    // pushing from inside the sheet would present the Film within the sheet.
    router.back();
    setTimeout(() => router.push({ pathname: '/create/[filmId]', params: { filmId: f.filmId } }), 350);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Latest stories',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              onPress={() => router.back()}
            >
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {films.isPending ? (
          <ActivityIndicator style={styles.spinner} />
        ) : films.isError ? (
          <Text style={styles.muted}>Couldn't load your stories.</Text>
        ) : list.length === 0 ? (
          <Text style={styles.muted}>No stories created yet.</Text>
        ) : (
          list.map((f) => <StoryRow key={f.filmId} film={f} onPress={() => open(f)} />)
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
  },
  pressed: { opacity: 0.6 },
  spinner: { marginVertical: 24 },
  muted: { fontSize: 14, color: theme.colors.mutedForeground, textAlign: 'center', marginTop: 24 },
  story: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  storyIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.muted,
  },
  storyText: { flex: 1, gap: 2 },
  storyTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  storyPrompt: { fontSize: 13, lineHeight: 17, color: theme.colors.mutedForeground },
  storyMeta: { fontSize: 12, color: theme.colors.subtleForeground },
}));
