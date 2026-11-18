---
description: Audit, generate and register every reference the shot list needs (sheets, plates, voices)
---
Load the `asset-check` skill and follow it.

Run the free audit first (`bin/asset-audit.sh`) and show its table. Then generate what is
missing: stills through the director for `config.image.model`, voices through
`seedance-voice-casting`, and register everything through the provider adapter for each
`config.providers.<capability>.id` so `/render` never blocks on it. End with a single
go/no-go verdict and the total render cost from `config.costs`.
