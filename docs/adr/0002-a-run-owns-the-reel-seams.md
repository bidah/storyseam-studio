# A shot sheet run plans the reels and places the seams itself

A reel holds 16 pins, so a Film longer than about a minute needs reel changes; with no UI in Auto, nobody places them by hand. The run plans the reels first, writes the Series' reel changes on render (re-planning them from scratch each time), and draws one clip per reel. A seam costs pins — the beat a reel opens on loses its pin, and no pin may sit within 5s after it — so those frames are not drawn at all rather than paid for and refused at pin time.

## Consequences

- Films are capped at 5:00: the 64-beat ceiling widens the grid to a pin every 5s past 4:16, so 5:00 is 60 beats and 56 pins in 4 reels (3 seams) — inside both the 64-beat and the 5-reel limits. (The cap was 4:30 before that was checked against the Reel planner.)
- A reel change moves the film by up to one Director chunk (15s) at each seam; that drift is accepted as the price of density.
