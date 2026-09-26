// All the Whistlewood tools. Each is a factory closing over a project-scoped api
// client (a flue tool's `run` gets no ambient context — see lib/api.ts).
import type { ToolDefinition } from "@flue/runtime";
import type { Api } from "../lib/api.js";

// Interaction (no api — asks the user via an interactive chat card)
import { renderUi } from "./render_ui.js";
// Pipeline status (the whole-project digest)
import { getStatus } from "./get_status.js";
// Plugins — which surfaces this project's studio actually has
import { listPlugins } from "./list_plugins.js";
import { setPlugin } from "./set_plugin.js";
// Context awareness — what the author is looking at, and moving them
import { viewScreen } from "./view_screen.js";
import { navigate } from "./navigate.js";
// World / Script / Drafts / Shotlist / Episode
import { getWorld } from "./get_world.js";
import { saveWorld } from "./save_world.js";
import { addWorldCharacter } from "./add_world_character.js";
import { listEpisodes } from "./list_episodes.js";
import { createEpisode } from "./create_episode.js";
import { setFormat } from "./set_format.js";
import { addWorldLocation } from "./add_world_location.js";
import { getVisualWorld } from "./get_visual_world.js";
import { attachVisualGeneration } from "./attach_visual_generation.js";
import { saveGenerationToLibrary } from "./save_generation_to_library.js";
import { saveVisualPrompt } from "./save_visual_prompt.js";
// Director — the cue sheet, the sitting it plays as, the sheet its pins are
// drawn on, and the score laid under what it kept.
import {
  attachModelSheet, createSeries, deriveCueSheet, getDirector, openSeries,
  pinBeatFrame, saveCueSheet, setTargetAudio, updateSeries,
} from "./director.js";
import { forgetSitting, getStage, listSittings, preflightSitting } from "./stage.js";
import { getUpscale, listUpscales, upscaleVideo } from "./upscale.js";
import { getShotSheet, previewShotSheet, renderShotSheet } from "./shot_sheet.js";
import { getMusicalized, planScore, renderCue } from "./musicalized.js";
// Moodboard (the reference wall)
import { getMoodboard } from "./get_moodboard.js";
import { addMoodboardCard, removeMoodboardCard } from "./add_moodboard_card.js";
import { getScript } from "./get_script.js";
import { getScriptReviews } from "./get_script_reviews.js";
import { lintScript } from "./lint_script.js";
import { appendScript } from "./append_script.js";
import { editScript } from "./edit_script.js";
import { saveScript } from "./save_script.js";
import { applyScriptProposal } from "./apply_script_proposal.js";
import { listDrafts } from "./list_drafts.js";
import { newDraft } from "./new_draft.js";
import { pinDraft } from "./pin_draft.js";
import { recordScriptReview } from "./record_script_review.js";
import { shareScript } from "./share_script.js";
import { shareWorld } from "./share_world.js";
import { getShotlist } from "./get_shotlist.js";
import { getShotDirector } from "./get_shot_director.js";
import { saveShotDirector } from "./save_shot_director.js";
import { saveShotlist } from "./save_shotlist.js";
import { listShots } from "./list_shots.js";
import { getEpisode } from "./get_episode.js";
import { getMultishot } from "./get_multishot.js";
import { saveEpisodePrompt } from "./save_episode_prompt.js";
import { setEpisodeStyle } from "./set_episode_style.js";
import { saveSeedancePrompt } from "./save_seedance_prompt.js";
import { attachEpisodeVideo } from "./attach_episode_video.js";
import { attachStill } from "./attach_still.js";
import { trimVideo } from "./trim_video.js";
// References
import { selectReference } from "./select_reference.js";
import { linkReference } from "./link_reference.js";
import { autoAssignRefs } from "./auto_assign_refs.js";
import { rebuildEpisodePlan } from "./rebuild_episode_plan.js";
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
// Musical — song → audio shot bible
import { getMusical } from "./get_musical.js";
import { splitSong } from "./split_song.js";
import { saveMusicalSegments } from "./save_musical_segments.js";
// Teams / org access
import { listOrgs } from "./list_orgs.js";
import { listMembers } from "./list_members.js";
import { inviteMember } from "./invite_member.js";
import { setMemberScope } from "./set_member_scope.js";
import { removeMember } from "./remove_member.js";
import { attachSound } from "./attach_sound.js";
import { saveAudioPrompt } from "./save_audio_prompt.js";
// Radio
import { getRadio } from "./get_radio.js";
import { castingSamplePrompt } from "./casting_sample_prompt.js";
import { attachRadioTake } from "./attach_radio_take.js";
import { castRadioVoice } from "./cast_radio_voice.js";
import { commitPacing } from "./commit_pacing.js";
// Cuts / Editor timeline
import { getCuts } from "./get_cuts.js";
import { stitchCuts } from "./stitch_cuts.js";
import { scoreCut } from "./score_cut.js";
import { getTimeline } from "./get_timeline.js";
import { listMediaPool } from "./list_media_pool.js";
import { loadCutIntoEditor } from "./load_cut_into_editor.js";
import { newEditorProject } from "./new_editor_project.js";
import { editTimeline } from "./edit_timeline.js";
// Library / Characters / Signing
import { listLibrary } from "./list_library.js";
import { toggleLibrary } from "./toggle_library.js";
import { attachCharacterSheet } from "./attach_character_sheet.js";
import { attachCharacterMiniature } from "./attach_character_miniature.js";
import { attachLocationSheet } from "./attach_location_sheet.js";
import { attachCharacterVoice } from "./attach_character_voice.js";
import { listCharacterVoices } from "./list_character_voices.js";
import { signBundle } from "./sign_bundle.js";
import { listHistory, restoreVersion } from "./list_history.js";
// Chat attachments
import { readDocument } from "./read_document.js";

export function createTools(api: Api): ToolDefinition[] {
  return [
    // Interaction
    renderUi(),
    // Chat attachments (a truncated document block → read the rest)
    readDocument(api),
    // Where the episode stands (counts + flags for the whole pipeline)
    getStatus(api),
    // Which surfaces this project has installed (the plugin-gate safeguard)
    listPlugins(api),
    setPlugin(api),
    // What the author is looking at RIGHT NOW, and how to move them
    viewScreen(api),
    navigate(api),
    // World / Script / Drafts
    getWorld(api),
    saveWorld(api),
    listHistory(api),
    restoreVersion(api),
    addWorldCharacter(api),
    addWorldLocation(api),
    // Series / episodes
    listEpisodes(api),
    createEpisode(api),
    setFormat(api),
    getVisualWorld(api),
    attachVisualGeneration(api),
    saveGenerationToLibrary(api),
    saveVisualPrompt(api),
    getMoodboard(api),
    addMoodboardCard(api),
    removeMoodboardCard(api),
    getScript(api),
    getScriptReviews(api),
    lintScript(api),
    appendScript(api),
    editScript(api),
    saveScript(api),
    applyScriptProposal(api),
    listDrafts(api),
    newDraft(api),
    pinDraft(api),
    recordScriptReview(api),
    shareScript(api),
    shareWorld(api),
    // Shotlist / Episode
    getShotlist(api),
    saveShotlist(api),
    // The prompt system shots are written with (author-editable, Settings tab)
    getShotDirector(api),
    saveShotDirector(api),
    listShots(api),
    getEpisode(api),
    getMultishot(api),
    saveEpisodePrompt(api),
    setEpisodeStyle(api),
    saveSeedancePrompt(api),
    attachEpisodeVideo(api),
    attachStill(api),
    trimVideo(api),
    // References
    selectReference(api),
    linkReference(api),
    autoAssignRefs(api),
    rebuildEpisodePlan(api),
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
    // Musical — song → audio shot bible
    getMusical(api),
    splitSong(api),
    saveMusicalSegments(api),
    // Radio
    getRadio(api),
    castingSamplePrompt(),
    attachRadioTake(api),
    castRadioVoice(api),
    commitPacing(api),
    // Cuts / Editor
    getCuts(api),
    stitchCuts(api),
    scoreCut(api),
    getTimeline(api),
    listMediaPool(api),
    loadCutIntoEditor(api),
    newEditorProject(api),
    editTimeline(api),
    // Library / Characters / Signing
    listLibrary(api),
    toggleLibrary(api),
    attachCharacterSheet(api),
    attachCharacterMiniature(api),
    attachLocationSheet(api),
    attachCharacterVoice(api),
    listCharacterVoices(api),
    signBundle(api),
    // Director / Stage / Shot sheet / Musicalized
    getDirector(api),
    openSeries(api),
    createSeries(api),
    updateSeries(api),
    saveCueSheet(api),
    deriveCueSheet(api),
    attachModelSheet(api),
    setTargetAudio(api),
    pinBeatFrame(api),
    getStage(api),
    preflightSitting(api),
    listSittings(api),
    forgetSitting(api),
    getShotSheet(api),
    previewShotSheet(api),
    renderShotSheet(api),
    getMusicalized(api),
    planScore(api),
    renderCue(api),
    // Upscale
    listUpscales(api),
    upscaleVideo(api),
    getUpscale(api),
    // Teams / org access
    listOrgs(api),
    listMembers(api),
    inviteMember(api),
    setMemberScope(api),
    removeMember(api),
  ];
}

// Read-only "ingestion" tools — one or more per app section — that let ANY
// delegated subagent (or a skill/action running inside one) pull the current
// content of any section itself, instead of relying on the parent to paste it
// into the prompt (long pastes get truncated by the model). These never mutate;
// the parent still applies any recommended changes with the write tools above.
export function createReadTools(api: Api): ToolDefinition[] {
  return [
    // Chat attachments
    readDocument(api),
    // Where the episode stands
    getStatus(api),
    // …which plugins this project has, and what the author is looking at
    listPlugins(api),
    viewScreen(api),
    // World / Script / Drafts
    getWorld(api),
    listEpisodes(api),
    listHistory(api),
    getVisualWorld(api),
    getMoodboard(api),
    getScript(api),
    getScriptReviews(api),
    lintScript(api),
    listDrafts(api),
    // Shotlist / Episode
    getShotlist(api),
    getShotDirector(api),
    listShots(api),
    getEpisode(api),
    getMultishot(api),
    // References / Sound / Radio
    listAudioRefs(api),
    listSounds(api),
    getMusical(api),
    getRadio(api),
    castingSamplePrompt(),
    // Cuts / Editor timeline
    getCuts(api),
    getTimeline(api),
    listMediaPool(api),
    // Library / Characters
    listLibrary(api),
    listCharacterVoices(api),
    // Director — reading a cue sheet, and whether a sitting is worth paying for
    getDirector(api),
    getStage(api),
    preflightSitting(api),
    listSittings(api),
    getShotSheet(api),
    previewShotSheet(api),
    getMusicalized(api),
    planScore(api),
    // Upscale — what can be upscaled and how the jobs are going
    listUpscales(api),
    getUpscale(api),
    // Teams / org access (read)
    listOrgs(api),
    listMembers(api),
  ];
}
