---
status: accepted
---
# The continuity anchor is the first reference image, declared in prose

Seedance 2.5 declares a `start_image` media role, accepts it, and records it on the job, but treats it as one reference among many: a whole film was rendered with every block's anchor in `start_image` and not one block opened on that frame (job `a330b8bc-24a7-43e4-808f-92ae3373fb57`, see `docs/seedance-2.5-research.md`). So on 2.5 the previous block's last frame is passed as the **first `image_references` entry** and the prompt says `@Image 1 is the first frame`, with `Shot 1` restating that composition. Do not "fix" this back to `start_image`; that role is real only on Seedance 2.0, whose director skill uses it. Frame-exact splices use `video_extension` instead, which is an alternate director, not the default, because an extension inherits identity from the previous clip rather than the character sheets and drift compounds.
