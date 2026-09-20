# Local development

## Prerequisites

- Python 3.12 and `uv`
- Node.js and npm
- `espeak-ng` for multilingual Kokoro phonemization
- `mkcert` for trusted localhost HTTPS
- Chrome for web testing
- Android platform tools, USB debugging, and Expo Go or a development build for the S26 path

## Provider configuration

Copy `.env.example` to `.env` at the repository root. Set `MUSE_API_KEY` for Meta Muse Voice Transcribe and Muse Spark. Never place it in Expo variables or client code.

The application state is local and ephemeral, but processing is not offline: microphone audio and intervention analysis go to Meta, so internet access is required and provider retention follows the configured Meta account. Kokoro neural speech runs locally on the backend for English, Spanish, French, Hindi, Italian, Japanese, Portuguese, and Mandarin. Other languages or local-model failures use the browser or Android system speech engine.

## Trusted web workflow

1. Install `espeak-ng` (`brew install espeak-ng` on macOS or `apt install espeak-ng` on Debian/Ubuntu).
2. Run `make speech-setup` once. This downloads roughly 625 MB of Apache-2.0 Kokoro weights into the user cache, outside the repository.
3. Run `make dev-cert` once and approve the local trust prompt.
4. Run `make backend-dev` in one terminal. The cached Kokoro model warms before the pairing banner appears; keep the printed `Open coach` link.
5. Run `make client-web` in another terminal.
6. Open the printed link. The PWA imports its fragment-only temporary token, clears it from the address bar, and leaves manual connection settings available if recovery is needed. Then choose languages and grant microphone permission.

If microphone permission was denied, use the browser site controls to restore it and reload. `not_ready` health means the Meta key is missing; key values are never returned. For languages outside Kokoro coverage, fallback voice availability is determined by the browser or Android speech engine.

Stop both terminal processes to end development. Session transcripts and generated audio are cleared when each session ends.

## Device-local Android workflow

1. Enable USB debugging and connect the S26 over USB.
2. Run `./scripts/dev-backend.sh android`.
3. Run `make client-android`. The script executes `adb reverse tcp:8000 tcp:8000` and enables the development-only loopback URL.
4. Enter the printed pairing token in the app.

The backend remains bound to `127.0.0.1`; cleartext HTTP is device-local through ADB reverse and is not exposed to the LAN. Expo Go is for validation, not Play Store packaging.

A future hosted or release build must use HTTPS/WSS and can retain the same versioned session protocol.
