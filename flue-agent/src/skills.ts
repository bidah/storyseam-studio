// The Whistlewood production agent's skills — the render/production playbooks the
// model loads for specialized work. (The better-colors/better-typography/better-ui
// skills that lived in the eve agent are LOCAL code-dev reference skills, not agent
// skills, so they are intentionally NOT included here.)
import completeCut from "./skills/complete-cut/SKILL.md";
import continueVideo from "./skills/continue-video/SKILL.md";
import editVideo from "./skills/edit-video/SKILL.md";
import generateMultishot from "./skills/generate-multishot/SKILL.md";
import generateStoryboard from "./skills/generate-storyboard/SKILL.md";
import radio from "./skills/radio/SKILL.md";
import radioPacing from "./skills/radio-pacing/SKILL.md";
import scriptWriting from "./skills/script-writing/SKILL.md";
import seedAudio from "./skills/seed-audio/SKILL.md";
import shotList from "./skills/shot-list/SKILL.md";
import trimVideo from "./skills/trim-video/SKILL.md";
import videoFromAudioVfx from "./skills/video-from-audio-vfx/SKILL.md";
import worldCreation from "./skills/world-creation/SKILL.md";
import visualWorld from "./skills/visual-world/SKILL.md";
import sheetGeneration from "./skills/sheet-generation/SKILL.md";
import assignRefs from "./skills/assign-refs/SKILL.md";
import generativeUi from "./skills/generative-ui/SKILL.md";
import destructiveApproval from "./skills/destructive-approval/SKILL.md";

export const skills = [
  generativeUi,
  destructiveApproval,
  worldCreation,
  visualWorld,
  sheetGeneration,
  scriptWriting,
  shotList,
  generateStoryboard,
  assignRefs,
  generateMultishot,
  continueVideo,
  videoFromAudioVfx,
  seedAudio,
  radio,
  radioPacing,
  trimVideo,
  completeCut,
  editVideo,
];
