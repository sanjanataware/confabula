# Conversation Language Coach

A local-first, provider-backed coach that detects a learner’s native-language fallback, shows only the useful source-to-target translation, and speaks it during a safe pause.

## Architecture

- **Expo SDK 57 client:** one TypeScript codebase for web and Android, exact 24 kHz PCM framing, ordered WebSocket state, intervention-only UI, and foreground-only capture.
- **FastAPI backend:** versioned protocol, deterministic speaker/turn state, reconnect replay, in-memory transcript/audio ownership, and provider credential isolation.
- **Speech:** Meta Muse Voice Transcribe provides diarized cumulative transcription, Muse Spark performs narrow code-switch analysis, and local Kokoro-82M neural TTS generates high-quality WAV speech for English, Spanish, French, Hindi, Italian, Japanese, Portuguese, and Mandarin. `expo-speech` remains the free fallback for the other languages or local-model failure.

Provider credentials never enter the client or protocol. Full transcripts and local neural WAV assets remain in backend memory and are cleared at session end; unsupported languages fall back to the browser or device speech engine. The application runs locally but still requires Meta processing over the internet, so provider-account retention policies remain applicable.

## Development

Prerequisites are Python 3.12, `uv`, Node.js, npm, `espeak-ng`, `mkcert`, Chrome, and optionally Expo Go plus Android platform tools. On macOS install the phonemizer with `brew install espeak-ng`; on Debian/Ubuntu use `apt install espeak-ng`.

1. Copy `.env.example` to `.env`.
2. Set `MUSE_API_KEY`. Local neural speech needs no second provider key. Never commit `.env`.
3. Run `make speech-setup` once to download and warm the Apache-2.0 Kokoro model. The model cache is outside the repository and is roughly 625 MB.
4. Follow [local development](docs/testing/local-development.md) for trusted web or ADB-reversed Android startup.
5. Run `make check` for the paid-provider-free test suite.
6. Run `make e2e` for the deterministic browser path.
7. Run `make provider-smoke` only when intentionally exercising live Meta providers.

The backend prints a new pairing token on each run. A session can resume for 15 seconds without remapping speakers and ends automatically at 50 minutes. The conversation view never renders a full transcript. The first backend start loads Kokoro before reporting ready; with a cached model this takes about six seconds on Apple Silicon, and warm Spanish synthesis takes roughly 0.4–1.5 seconds. Device fallback voice availability and quality vary by browser/OS.

See the [implementation plan](2026-09-19-conversation-language-coach-mvp.md), [provider smoke guide](docs/testing/provider-smoke-tests.md), and [S26 acceptance checklist](docs/testing/s26-acceptance-checklist.md).

## Verification boundary

Offline backend/client tests, deterministic browser E2E, protocol regeneration, type checks, lint, and web/Android exports are automated. Live Meta calls and physical S26 voice checks are deliberately opt-in and must not be inferred from offline success. The checked-in S26 checklist remains blank until run on the device.

`npm audit` currently reports 14 moderate transitive findings in the Expo SDK 57 toolchain (`decode-uri-component` through Expo Router and `uuid` through Expo config tooling). npm’s proposed forced fixes downgrade Expo/Expo Router and violate the SDK 57 contract, so they are documented rather than applied; there are no high or critical findings.

## Later, not in this MVP

- Permanent conversation history or ChatGPT-style history browsing
- Lessons generated from conversation gaps
- Planned practice conversations
- Hosted deployment
- Voice enrollment
- Polished production design
- Accounts
- Play Store packaging or distribution
