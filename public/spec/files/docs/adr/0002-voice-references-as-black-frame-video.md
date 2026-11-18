---
status: accepted
---
# A character voice reaches a Higgsfield render as a black-frame `.mp4` in `video_references`

Seedance on Higgsfield has an `audio_references` role, which is the obvious place for a voice, but it is a narrower path: it rejects `mode: "fast"` and did not carry a voice into a render reliably. A voice muxed against a black video track and passed in `video_references`, with the prompt told to ignore the black frames, does. So each character's voice is stored twice: the clean take (`assets/audio/voices/<slug>.mp3`, the source of truth) and its black-frame encode (`assets/audio/voices/blackframe/<slug>.mp4`, the form the render takes). This is a Higgsfield workaround, not a Seedance property: on Atlas Cloud the `.mp3` goes straight into `reference_audios`, and the provider adapter says so.
