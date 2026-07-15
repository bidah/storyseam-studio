// Editor design tokens — a dark, high-contrast NLE palette (CapCut/Premiere
// mobile feel). Kept separate from the app's scaffold theme so the editor reads
// as an immersive tool surface regardless of the OS light/dark setting.
export const EditorTheme = {
  bg: "#0B0B0F",
  panel: "#15151C",
  panelRaised: "#1E1E28",
  border: "#2A2A36",
  track: "#101018",
  laneVideo: "#243B53",
  laneAudio: "#1E3A34",
  clipVideo: "#3B6FB0",
  clipVideoSelected: "#5B9BE0",
  clipAudio: "#2E8B70",
  clipAudioSelected: "#43C39B",
  link: "#E0A93B",
  playhead: "#FF4D5E",
  text: "#F4F4F8",
  textDim: "#9A9AA8",
  textFaint: "#5A5A68",
  accent: "#5B9BE0",
  danger: "#FF4D5E",
  ruler: "#2A2A36",
  rulerText: "#7A7A88",
} as const;

export type EditorThemeT = typeof EditorTheme;
