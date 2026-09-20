# Project commands

- Install backend dependencies: `cd apps/backend && uv sync`
- Install client dependencies: `cd apps/client && npm ci`
- Download and warm local neural speech: `make speech-setup`
- Run all offline checks: `make check`
- Run deterministic browser E2E: `make e2e`
- Export web: `cd apps/client && npx expo export --platform web`
- Export Android: `cd apps/client && npx expo export --platform android`
- Regenerate protocol: `cd apps/backend && uv run python scripts/export_protocol_schema.py && cd ../client && npm run protocol:generate`
- Syntax-check launch scripts: `bash -n scripts/dev-cert.sh scripts/dev-backend.sh scripts/dev-client.sh`

`MUSE_API_KEY` is the only production provider credential. Kokoro-82M is the local neural speech primary for its supported languages and `expo-speech` is the device fallback; neither requires a backend TTS key. Run `make speech-setup` before demos. The legacy ElevenLabs adapter and opt-in tests remain for comparison only; never put provider values in Expo variables, client code, URLs, logs, tests, or commits.

Default tests must never call paid providers. `make provider-smoke` is explicitly opt-in and also requires the live variables documented in `docs/testing/provider-smoke-tests.md`.

The repository uses Expo SDK 57 and Python 3.12. Keep `uv.lock` and `package-lock.json` committed. Full transcripts, generated audio, resume credentials, and pairing credentials are in-memory only.

# Interface work

Before inventing visual components, inspect `apps/client/src/design`, existing product components, and approved references. Adapt external patterns to this project’s typography, spacing, color, motion, accessibility, and responsive-layout system instead of assembling unrelated templates.

Complete visual work through an iterative browser loop: implement, run, capture desktop/tablet/mobile screenshots, critique, fix, and capture again. Motion must communicate state or cause-and-effect, honor reduced-motion preferences, and never delay interaction. Preserve native platform behavior, accessible labels, keyboard focus, readable contrast, 44-point touch targets, Dynamic Type tolerance, and the intervention-only/no-transcript product boundary.
