// EditorComposition — the native preview surface. React Native port of
// web-editor/src/core/Composition.jsx (Remotion <EditorComposition tracks>).
//
// The web composition renders a Remotion <Sequence>/<Video>/<Img>/<Audio> tree
// per item. On native there is no Remotion runtime, so the actual clip
// switching / seeking / mixing lives in `useEditorPlayback`; this component
// just renders the single picture surface it drives, matching the composition's
// VISUAL contract:
//   • letterboxed on black (object-fit: contain)
//   • flipH / flipV transforms on the active clip
//   • an empty (black) frame when no clip covers the playhead
//
// The picture lane carries VIDEO and IMAGE items as peers (see the media-kind
// note in core/timeline.ts), so this surface has three states, matching the
// web's <Video> / <Img> / slate-placeholder branches:
//   • video item → the expo-video surface the playback engine drives
//   • image item with a src → the storyboard still, held on screen
//   • image item with src: null (a SLATE) → a labelled placeholder card, so a
//     half-built animatic shows its holes instead of going black
//
// API parity: the web component takes `tracks`; here the resolved playback state
// is passed in as `video` (so the timeline model stays the single source of
// truth). Web reference: /docs/modules/playback ↔ this: /docs/react-native/playback
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { VideoView } from "expo-video";
import { isImageItem, isSlateItem } from "@/editor/core/timeline";
import { EditorTheme } from "@/editor/theme";
import type { ActiveVideo } from "@/editor/modules/playback/useEditorPlayback";

export interface EditorCompositionProps {
  video: ActiveVideo;
  /** Composition aspect (width / height). Defaults to the model's 16:9. */
  aspect?: number;
  /** Resolves a model `src` to a displayable URL (the backend's `mediaUrl`). */
  imageUrl?: (src: string) => string;
}

// A shot whose still isn't generated yet. Named so the user can see WHICH shot
// is missing its picture without leaving the preview.
function Slate({ label }: { label: string }) {
  return (
    <View style={styles.slate}>
      <Text style={styles.slateLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.slateHint}>no still yet</Text>
    </View>
  );
}

export function EditorComposition({ video, imageUrl }: EditorCompositionProps) {
  const item = video.item;
  const flip = {
    transform: [{ scaleX: item?.flipH ? -1 : 1 }, { scaleY: item?.flipV ? -1 : 1 }],
  };

  let surface: React.ReactNode;
  if (!item) {
    // No item under the playhead (a gap): black frame, exactly like the web
    // composition. The playback engine parks the video player on gaps, so
    // rendering the VideoView here would show its frozen last frame instead.
    surface = <View style={styles.surface} />;
  } else if (isSlateItem(item)) {
    surface = <Slate label={item.name || item.shot || "Slate"} />;
  } else if (isImageItem(item)) {
    const uri = imageUrl && item.src ? imageUrl(item.src) : item.src;
    surface = (
      <Image
        source={uri ? { uri } : null}
        style={[styles.surface, flip]}
        contentFit="contain"
        transition={0}
      />
    );
  } else {
    surface = (
      <VideoView
        player={video.player}
        style={[styles.surface, flip]}
        contentFit="contain"
        nativeControls={false}
      />
    );
  }

  return (
    <View style={styles.stage} pointerEvents="none">
      {surface}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  surface: {
    width: "100%",
    height: "100%",
  },
  slate: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 24,
    backgroundColor: EditorTheme.panel,
    borderColor: EditorTheme.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  slateLabel: {
    color: EditorTheme.text,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  slateHint: {
    color: EditorTheme.textFaint,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
});

export default EditorComposition;
