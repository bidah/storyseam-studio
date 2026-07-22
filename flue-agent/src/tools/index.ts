// All the Whistlewood tools. Each is a factory closing over a project-scoped api
// client (a flue tool's `run` gets no ambient context — see lib/api.ts).
import type { ToolDefinition } from "@flue/runtime";
import type { Api } from "../lib/api.js";

// Interaction (no api — asks the user via an interactive chat card)
import { askQuestion } from "./ask_question.js";
// World / Script / Drafts / Shotlist / Episode
import { getWorld } from "./get_world.js";
import { saveWorld } from "./save_world.js";
import { addWorldCharacter } from "./add_world_character.js";
import { addWorldLocation } from "./add_world_location.js";
import { getVisualWorld } from "./get_visual_world.js";
import { attachVisualGeneration } from "./attach_visual_generation.js";
import { saveVisualPrompt } from "./save_visual_prompt.js";
import { getScript } from "./get_script.js";
import { appendScript } from "./append_script.js";
import { saveScript } from "./save_script.js";
import { applyScriptProposal } from "./apply_script_proposal.js";
import { listDrafts } from "./list_drafts.js";
import { newDraft } from "./new_draft.js";
import { pinDraft } from "./pin_draft.js";
import { getShotlist } from "./get_shotlist.js";
import { saveShotlist } from "./save_shotlist.js";
import { listShots } from "./list_shots.js";
import { getEpisode } from "./get_episode.js";
import { getMultishot } from "./get_multishot.js";
import { saveEpisodePrompt } from "./save_episode_prompt.js";
import { saveSeedancePrompt } from "./save_seedance_prompt.js";
import { attachEpisodeVideo } from "./attach_episode_video.js";
import { attachStill } from "./attach_still.js";
import { trimVideo } from "./trim_video.js";
// References
import { selectReference } from "./select_reference.js";
import { autoAssignRefs } from "./auto_assign_refs.js";
import { selectVideo } from "./select_video.js";
import { listAudioRefs } from "./list_audio_refs.js";
import { selectAudioRef } from "./select_audio_ref.js";
// Sound studio
import { createSound } from "./create_sound.js";
import { listSounds } from "./list_sounds.js";
import { addSoundVersion } from "./add_sound_version.js";
import { editSoundVersion } from "./edit_sound_version.js";
import { deleteSoundVersion } from "./delete_sound_version.js";
import { likeSoundVersion } from "./like_sound_version.js";
import { renameSound } from "./rename_sound.js";
import { attachSound } from "./attach_sound.js";
import { saveAudioPrompt } from "./save_audio_prompt.js";
// Radio
import { getRadio } from "./get_radio.js";
import { attachRadioTake } from "./attach_radio_take.js";
import { castRadioVoice } from "./cast_radio_voice.js";
import { commitPacing } from "./commit_pacing.js";
// Cuts / Editor timeline
import { getCuts } from "./get_cuts.js";
import { stitchCuts } from "./stitch_cuts.js";
import { scoreCut } from "./score_cut.js";
import { getTimeline } from "./get_timeline.js";
import { loadCutIntoEditor } from "./load_cut_into_editor.js";
import { editTimeline } from "./edit_timeline.js";
// Library / Characters / Signing
import { listLibrary } from "./list_library.js";
import { toggleLibrary } from "./toggle_library.js";
import { attachCharacterSheet } from "./attach_character_sheet.js";
import { attachLocationSheet } from "./attach_location_sheet.js";
import { attachCharacterVoice } from "./attach_character_voice.js";
import { listCharacterVoices } from "./list_character_voices.js";
import { signBundle } from "./sign_bundle.js";

export function createTools(api: Api): ToolDefinition[] {
  return [
    // Interaction
    askQuestion(),
    // World / Script / Drafts
    getWorld(api),
    saveWorld(api),
    addWorldCharacter(api),
    addWorldLocation(api),
    getVisualWorld(api),
    attachVisualGeneration(api),
    saveVisualPrompt(api),
    getScript(api),
    appendScript(api),
    saveScript(api),
    applyScriptProposal(api),
    listDrafts(api),
    newDraft(api),
    pinDraft(api),
    // Shotlist / Episode
    getShotlist(api),
    saveShotlist(api),
    listShots(api),
    getEpisode(api),
    getMultishot(api),
    saveEpisodePrompt(api),
    saveSeedancePrompt(api),
    attachEpisodeVideo(api),
    attachStill(api),
    trimVideo(api),
    // References
    selectReference(api),
    autoAssignRefs(api),
    selectVideo(api),
    listAudioRefs(api),
    selectAudioRef(api),
    // Sound
    createSound(api),
    listSounds(api),
    addSoundVersion(api),
    editSoundVersion(api),
    deleteSoundVersion(api),
    likeSoundVersion(api),
    renameSound(api),
    attachSound(api),
    saveAudioPrompt(api),
    // Radio
    getRadio(api),
    attachRadioTake(api),
    castRadioVoice(api),
    commitPacing(api),
    // Cuts / Editor
    getCuts(api),
    stitchCuts(api),
    scoreCut(api),
    getTimeline(api),
    loadCutIntoEditor(api),
    editTimeline(api),
    // Library / Characters / Signing
    listLibrary(api),
    toggleLibrary(api),
    attachCharacterSheet(api),
    attachLocationSheet(api),
    attachCharacterVoice(api),
    listCharacterVoices(api),
    signBundle(api),
  ];
}

// Read-only "ingestion" tools — one or more per app section — that let ANY
// delegated subagent (or a skill/action running inside one) pull the current
// content of any section itself, instead of relying on the parent to paste it
// into the prompt (long pastes get truncated by the model). These never mutate;
// the parent still applies any recommended changes with the write tools above.
export function createReadTools(api: Api): ToolDefinition[] {
  return [
    // World / Script / Drafts
    getWorld(api),
    getVisualWorld(api),
    getScript(api),
    listDrafts(api),
    // Shotlist / Episode
    getShotlist(api),
    listShots(api),
    getEpisode(api),
    getMultishot(api),
    // References / Sound / Radio
    listAudioRefs(api),
    listSounds(api),
    getRadio(api),
    // Cuts / Editor timeline
    getCuts(api),
    getTimeline(api),
    // Library / Characters
    listLibrary(api),
    listCharacterVoices(api),
  ];
}
