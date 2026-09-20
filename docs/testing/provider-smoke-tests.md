# Live provider smoke tests

Live Meta checks are opt-in. Create the root `.env`, set `MUSE_API_KEY`, and run `make provider-smoke`. Offline tests and `make check` never call a paid provider.

The transcription check additionally requires `LIVE_MUSE_PCM_PATH`, pointing to a user-supplied signed 16-bit little-endian mono 24 kHz PCM file outside this repository. The path may be in `.env` or the invoking environment. Audio contents, transcripts, keys, and raw provider errors are never logged.

The production smoke suite verifies:

- Muse Voice Transcribe connection, cumulative partial revision, speaker labels, `speechComplete`, and clean close;
- Muse Spark positive and empty intervention outputs plus malformed-output rejection;
- invalid Meta keys and provider errors remain redacted.

Translation playback uses `expo-speech` and the browser or Android system voice, so it needs no live backend-provider smoke test. Voice availability and quality must be checked on each target device with the S26 acceptance checklist.

The legacy ElevenLabs adapter remains isolated for future comparison. If credentials and a compatible paid/API voice are available, run `make elevenlabs-smoke`; it is not part of production readiness.
