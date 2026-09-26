# A shot sheet run plans the reels and places the seams itself

A reel holds 16 pins, so a Film longer than about a minute needs reel changes; with no UI in Auto, nobody places them by hand. The run plans the reels first, writes the Series' reel changes on render (re-planning them from scratch each time), and draws one clip per reel. A seam costs pins — the beat a reel opens on loses its pin, and no pin may sit within 5s after it — so those frames are not drawn at all rather than paid for and refused at pin time.

## Consequences

- Films are capped at 4:30: at a pin every ~4s, 5 reels minus what 4 seams cost leaves ~72 usable pins.
- A reel change moves the film by up to one Director chunk (15s) at each seam; that drift is accepted as the price of density.
