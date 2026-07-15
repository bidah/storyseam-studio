// Edit Studio — React Native editor. Public surface mirrors the web package:
// the mountable <Editor/> root + <BackendProvider>, the core model, and the
// feature-module barrels. Web reference: /docs/architecture ↔ this: /docs/react-native
export { Editor } from "./Editor";
export { EditorComposition } from "./core/Composition";
export { BackendProvider, useBackend, createLocalBackend, createCutsBackend } from "./providers/backend";
export type { EditorBackend, Pool, PoolItem, Still } from "./providers/backend/types";
export * from "./core/timeline";
export { EditorTheme } from "./theme";
export * as timeline from "./modules/timeline";
export * as media from "./modules/media";
export * as playback from "./modules/playback";
