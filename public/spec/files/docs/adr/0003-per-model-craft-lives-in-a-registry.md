---
status: accepted
---
# Per-model directing craft is installed from a registry, not kept in the pipeline skills

The pipeline (scaffold, script, shot list, cast, render, assemble) does not change when the video or image model changes, but the prompting craft does: Seedance 2.0 honours `start_image`, 2.5 ignores it, and a single skill covering both was wrong for whichever model was in use, which is how a film lost its continuity chain. So the pipeline skills stay in `.claude/skills/` while each model's **director** and each backend's **provider adapter** are built from `registry/sources/` into a static JSON registry and installed into the project by `bin/registry-add.py`, resolved from the model ids in `config.json`. The cost is an extra fetch-and-install step and a publish step that can leave the served registry behind the sources; the alternatives were one monolithic director (proven wrong) or a director per model checked into every project with no way to correct it after a bad render teaches something. Installed copies are build output and git-ignored; edits go in `registry/sources/`.
