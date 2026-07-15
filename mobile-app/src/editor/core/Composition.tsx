// EditorComposition — the native preview surface. React Native port of
// web-editor/src/core/Composition.jsx (Remotion <EditorComposition tracks>).
//
// The web composition renders a Remotion <Sequence>/<Video>/<Audio> tree per
// item. On native there is no Remotion runtime, so the actual clip switching /
// seeking / mixing lives in `useEditorPlayback`; this component just renders the
// single video surface it drives, matching the composition's VISUAL contract:
//   • letterboxed on black (object-fit: contain)
//   • flipH / flipV transforms on the active clip
//   • an empty (black) frame when no clip covers the playhead
//
// API parity: the web component takes `tracks`; here the resolved playback state
// is passed in as `video` (so the timeline model stays the single source of
// truth). Web reference: /docs/modules/playback ↔ this: /docs/react-native/playback
import { StyleSheet, View } from "react-native";
import { VideoView } from "expo-video";
import type { ActiveVideo } from "@/editor/modules/playback/useEditorPlayback";

export interface EditorCompositionProps {
  video: ActiveVideo;
  /** Composition aspect (width / height). Defaults to the model's 16:9. */
  aspect?: number;
}

export function EditorComposition({ video }: EditorCompositionProps) {
  const item = video.item;
  const flip = {
    transform: [{ scaleX: item?.flipH ? -1 : 1 }, { scaleY: item?.flipV ? -1 : 1 }],
  };
  return (
    <View style={styles.stage} pointerEvents="none">
      <VideoView
        player={video.player}
        style={[styles.surface, flip]}
        contentFit="contain"
        nativeControls={false}
      />
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
});

export default EditorComposition;
