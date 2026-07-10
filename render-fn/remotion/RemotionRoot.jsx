// VENDORED from shot-studio/src/editor/RemotionRoot.jsx — keep in sync via `npm run sync` (scripts/sync-composition.mjs). Do not edit by hand.

// Remotion entry point used ONLY for server-side rendering (npm bundler +
// @remotion/renderer, driven by /api/render). The interactive editor uses the
// same <EditorComposition> directly via @remotion/player, so this file just
// wraps it in a registered <Composition> whose size/fps/length are derived from
// the timeline passed as inputProps (calculateMetadata).
import React from "react";
import { Composition, registerRoot } from "remotion";
import { EditorComposition } from "./Composition";
import { timelineDuration, FPS, WIDTH, HEIGHT } from "./timeline";

const RemotionRoot = () => (
  <Composition
    id="Editor"
    component={EditorComposition}
    durationInFrames={1}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={{ tracks: [] }}
    calculateMetadata={({ props }) => {
      const fps = props.fps || FPS;
      const { durationInFrames } = timelineDuration({ tracks: props.tracks, fps });
      return {
        durationInFrames: Math.max(1, durationInFrames),
        fps,
        width: props.width || WIDTH,
        height: props.height || HEIGHT,
      };
    }}
  />
);

registerRoot(RemotionRoot);
