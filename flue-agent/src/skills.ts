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
import musical from "./skills/musical/SKILL.md";
import radioPacing from "./skills/radio-pacing/SKILL.md";
import scriptWriting from "./skills/script-writing/SKILL.md";
import scriptAgents from "./skills/script-agents/SKILL.md";
import seedAudio from "./skills/seed-audio/SKILL.md";
import shotList from "./skills/shot-list/SKILL.md";
import shotListLiveAction from "./skills/shot-list-live-action/SKILL.md";
import createNewShotsForShotlist from "./skills/create-new-shots-for-shotlist/SKILL.md";
import trimVideo from "./skills/trim-video/SKILL.md";
import videoFromAudioVfx from "./skills/video-from-audio-vfx/SKILL.md";
import worldCreation from "./skills/world-creation/SKILL.md";
import visualWorld from "./skills/visual-world/SKILL.md";
import moodboard from "./skills/moodboard/SKILL.md";
import sheetGeneration from "./skills/sheet-generation/SKILL.md";
import assignRefs from "./skills/assign-refs/SKILL.md";
import generativeUi from "./skills/generative-ui/SKILL.md";
import destructiveApproval from "./skills/destructive-approval/SKILL.md";
import pluginGate from "./skills/plugin-gate/SKILL.md";
import teamAccess from "./skills/team-access/SKILL.md";
import seriesEpisodes from "./skills/series-episodes/SKILL.md";
// The Director half of the studio — one recipe, one continuous take.
import directorSeries from "./skills/director-series/SKILL.md";
import cueSheet from "./skills/cue-sheet/SKILL.md";
import modelSheets from "./skills/model-sheets/SKILL.md";
import directorSitting from "./skills/director-sitting/SKILL.md";
import shotSheet from "./skills/shot-sheet/SKILL.md";
import scoreFilm from "./skills/score-film/SKILL.md";

export const skills = [
  generativeUi,
  destructiveApproval,
  // Which surfaces this project actually HAS. Always-relevant like the two
  // above: a plugin's tools succeed on a tab the author never installed, so the
  // check has to happen before the work, not after it.
  pluginGate,
  teamAccess,
  seriesEpisodes,
  worldCreation,
  visualWorld,
  moodboard,
  sheetGeneration,
  scriptWriting,
  scriptAgents,
  // Two shot-list skills, one per PROMPT FORM — the project's active shot
  // director (`get_shot_director` → `promptForm`) picks between them, NOT the
  // phrasing of the request (both answer to "generate the shot list"). Each
  // skill's preconditions make it bail out to the other when the form doesn't
  // match. The director is author-editable (Settings › Shot list director), so
  // the prompt SYSTEM lives there and these two keep the pipeline.
  shotList,
  shotListLiveAction,
  // Add a shot INTO an existing list (the "+" node between shot cards, or a
  // chat request) — the surgical insert counterpart of the two build skills.
  createNewShotsForShotlist,
  generateStoryboard,
  assignRefs,
  generateMultishot,
  continueVideo,
  videoFromAudioVfx,
  seedAudio,
  radio,
  radioPacing,
  musical,
  // The Director: one recipe, generated as one continuous take, instead of a
  // shot at a time cut together. Ordered the way the work is — write the
  // Series, write its beats, make the art they reference, play it, draw its
  // pins, score what came back.
  directorSeries,
  cueSheet,
  modelSheets,
  directorSitting,
  shotSheet,
  scoreFilm,
  trimVideo,
  completeCut,
  editVideo,
];
