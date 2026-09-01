// The seeded mesh-gradient band — the app's card artwork when there is no
// picture to show.
//
// `card-art.ts` owns the nine colours and the nine vertex positions and is
// VENDORED to the phone (which paints them as a real 3×3 mesh with
// expo-mesh-gradient). This file is the WEB half of that: CSS has no mesh, so
// nine soft radial gradients at the same nine vertices, with radii generous
// enough that neighbours bleed into each other rather than reading as nine
// dots. It lives outside card-art.ts precisely so the vendored copy doesn't
// carry a CSS-only helper the phone can never use.
//
// Two surfaces draw it: the chat's landing posters (AgentChat) and the plugin
// marketplace cards. Both key it off the card's own stable id, never its
// position — the decks reorder, and artwork that shuffled underneath the author
// would read as a different card.
import { meshPalette, meshShape } from "./card-art";

export function meshBackground(seed) {
  const palette = meshPalette(seed);
  const stops = meshShape(seed)
    .map(([x, y], i) => {
      const c = palette[i % palette.length];
      return `radial-gradient(circle at ${(x * 100).toFixed(0)}% ${(y * 100).toFixed(0)}%, ${c} 0%, transparent 62%)`;
    })
    .reverse()
    .join(", ");
  // The flat base shows through where the radials have faded out, so a corner is
  // never the page's background peeking through the picture slot.
  return { backgroundImage: stops, backgroundColor: palette[4] };
}
