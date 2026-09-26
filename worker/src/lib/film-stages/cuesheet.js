// The Film job's "Cue sheet" stage (Auto, PRD #59 / #66).
//
// The shot list becomes the Film's cue sheet through the derive step
// (lib/cue-derive.js — the same mapping `derive_cue_sheet` writes), laid on the
// Film plan's EVEN grid rather than on the shots' own durations: one beat every
// `plan.spacing` seconds (~4s; wider only where 4s would pass the Series'
// 64-beat ceiling) across exactly the plan's length. So the beat count the
// author was quoted is the beat count the Series gets.
//
// No pins yet — the frames a beat closes on are drawn by a later stage. Saved
// on the Film's Series (made by the sheets stage) through the same validated
// write the derive route uses, so a sheet the endpoint would refuse never lands.
import { beatsOnGrid } from "../cue-derive.js";
import { replaceCueSheet } from "../director.js";
import { readDoc } from "../docs.js";
import { normalizeShot } from "../shots.js";
import { formatLength } from "../film-plan.ts";
import { MAX_DIRECTIONS } from "../series.ts";
import { filmPlanFor } from "./shotlist.js";
import { readWorld } from "../../routes/world.js";
import { filmSoundLock } from "../film-sound.js";

const readShots = async (env, pid) =>
  ((await readDoc(env, pid, "shotlist", { shots: [] })).shots || []).map(normalizeShot);

/** deps (optional): { readShots, readWorld }. */
export async function runCueSheetStage({ job, results, env }, deps = {}) {
  const pid = job.projectId;
  const seriesId = results?.sheets?.seriesId;
  if (!seriesId) throw new Error("The Film has no Series yet — the reference sheets step did not finish.");

  const shots = await (deps.readShots || readShots)(env, pid);
  if (!shots.length) throw new Error("There is no shot list to derive the cue sheet from.");

  // Location slug → the name its model sheet is filed under (sheets.js names a
  // place's sheet after the World's `name`), so a beat names the place the way
  // the shot sheet's reference tagging can find it.
  const world = await (deps.readWorld || readWorld)(env, pid);
  const places = Object.fromEntries(
    (world?.locations || []).filter((l) => l?.slug && l?.name).map((l) => [l.slug, l.name]),
  );

  const plan = filmPlanFor(job);
  const { beats, shotsByOffset } = beatsOnGrid(shots, {
    seconds: plan.seconds,
    spacing: plan.spacing,
    sound: filmSoundLock(job.language),
    places,
  });
  if (beats.length > MAX_DIRECTIONS) {
    // beatSpacing guarantees this never happens; say so loudly if it ever does.
    throw new Error(`${beats.length} beats — a Series takes ${MAX_DIRECTIONS}`);
  }

  const res = await replaceCueSheet(env, pid, seriesId, beats);
  if (res.missing) throw new Error(`The Film's Series ${seriesId} is gone.`);
  if (res.issues) throw new Error(`The cue sheet would be refused: ${Object.values(res.issues).join("; ")}`);

  return {
    summary: `${beats.length} beats every ${plan.spacing}s over ${plan.length} · ${plan.pins} pins planned`,
    result: {
      seriesId,
      beats: beats.length,
      spacing: plan.spacing,
      seconds: plan.seconds,
      length: formatLength(plan.seconds),
      pins: plan.pins,
      reels: plan.reels,
      shotsByOffset,
    },
  };
}
