// The camera vocabulary the shot-list generator writes with — a shot's `camera`
// is "framing + move" (e.g. "Medium close-up, slow push-in"), so the
// autocomplete offers both halves. Moves stay 2D-friendly on purpose: the
// project's Seedance style tail forbids hand-held / 3D camera work.
export const CAMERA_FRAMINGS = [
  "Extreme wide shot",
  "Wide shot",
  "Establishing wide",
  "Full shot",
  "Medium wide shot",
  "Medium shot",
  "Medium close-up",
  "Close-up",
  "Extreme close-up",
  "Insert",
  "Two-shot",
  "Over-the-shoulder",
  "POV",
  "Profile shot",
  "Low angle",
  "High angle",
  "Bird's-eye view",
  "Worm's-eye view",
  "Dutch angle",
];

export const CAMERA_MOVES = [
  "static",
  "slow push-in",
  "push-in",
  "slow pull-back",
  "pull-back",
  "pan left",
  "pan right",
  "slow pan",
  "whip pan",
  "tilt up",
  "tilt down",
  "lateral tracking left",
  "lateral tracking right",
  "slow drift",
  "hold, then push-in",
];
