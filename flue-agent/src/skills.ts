// The Whistlewood production agent's skills — the render/production playbooks the
// model loads for specialized work. (The better-colors/better-typography/better-ui
// skills that lived in the eve agent are LOCAL code-dev reference skills, not agent
// skills, so they are intentionally NOT included here.)
import completeCut from "./skills/complete-cut/SKILL.md" with { type: "skill" };
import continueVideo from "./skills/continue-video/SKILL.md" with { type: "skill" };
import editVideo from "./skills/edit-video/SKILL.md" with { type: "skill" };
import generateMultishot from "./skills/generate-multishot/SKILL.md" with { type: "skill" };
import generateStoryboard from "./skills/generate-storyboard/SKILL.md" with { type: "skill" };
import radio from "./skills/radio/SKILL.md" with { type: "skill" };
import radioPacing from "./skills/radio-pacing/SKILL.md" with { type: "skill" };
import scriptWriting from "./skills/script-writing/SKILL.md" with { type: "skill" };
import seedAudio from "./skills/seed-audio/SKILL.md" with { type: "skill" };
import shotList from "./skills/shot-list/SKILL.md" with { type: "skill" };
import trimVideo from "./skills/trim-video/SKILL.md" with { type: "skill" };
import videoFromAudioVfx from "./skills/video-from-audio-vfx/SKILL.md" with { type: "skill" };
import worldCreation from "./skills/world-creation/SKILL.md" with { type: "skill" };
import visualWorld from "./skills/visual-world/SKILL.md" with { type: "skill" };
import sheetGeneration from "./skills/sheet-generation/SKILL.md" with { type: "skill" };
import assignRefs from "./skills/assign-refs/SKILL.md" with { type: "skill" };
import generativeUi from "./skills/generative-ui/SKILL.md" with { type: "skill" };
import destructiveApproval from "./skills/destructive-approval/SKILL.md" with { type: "skill" };

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
