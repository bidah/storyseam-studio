# Auto films run entirely server-side, the sitting in headless Chromium on Daytona

In Auto the author types a prompt and gets a Film back, so no step may depend on their tab: a reload would kill a paid sitting halfway. Cutting stills, the sitting and scoring — all browser-only before this (see `baselines/agent-parity.txt`) — run in Daytona boxes, orchestrated by a durable job on the Worker that the agent only starts. The sitting runs the existing `session.ts` + transport + recorder in headless Chromium rather than a Node WebRTC rewrite, so the kept film is made by the same code Stage records with.

## Considered Options

- The author's tab, triggered over the `nav` channel — rejected: a refresh loses a sitting billed from `configure`.
- A Node WebRTC client (`werift`) with ffmpeg recording — rejected for now: a rewrite of the transport and recorder, and fal's realtime client may not support Node.
- One long agent turn — rejected: a film takes 20–40 minutes and a flue turn cannot suspend.
