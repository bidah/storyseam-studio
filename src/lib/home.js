// Where a signed-in author lands, and whether the studio shell is reachable.
//
// For now the product IS the text-to-story page: a prompt in, a Film back
// (`/`, with the fal H3 Director / Seedance 2.5 Gen mode). The studio (header, tabs, agent panel — RootLayout) is
// hidden: every route under it redirects home. Flip STUDIO_HIDDEN to bring it
// back; nothing under it was removed.
export const HOME_PATH = "/";
export const STUDIO_HIDDEN = true;

/** The default landing after sign-in, when no `?next=` names one. */
export const AFTER_SIGN_IN = STUDIO_HIDDEN ? HOME_PATH : "/world";
