# Local development

## Prerequisites

- Python 3.12 and `uv`
- Node.js and npm
- `mkcert` for trusted localhost HTTPS
- Chrome for web testing
- Android platform tools, USB debugging, and Expo Go or a development build for the S26 path

## Provider configuration

Copy `.env.example` to `.env` at the repository root. Set `MUSE_API_KEY` for Meta Muse Voice Transcribe and Muse Spark. Never place it in Expo variables or client code.

The application state is local and ephemeral, but processing is not offline: microphone audio and intervention analysis go to Meta, so internet access is required and provider retention follows the configured Meta account. Translated speech is requested through the browser or Android system speech engine rather than a backend TTS provider. Voice availability, downloads, and any network processing depend on the configured OS/browser speech engine.

## Trusted web workflow

1. Run `make dev-cert` once and approve the local trust prompt.
2. Run `make backend-dev` in one terminal. Copy the one-time pairing token printed there.
3. Run `make client-web` in another terminal.
4. Open `https://localhost:8443`, enter the backend address `https://localhost:8444` and pairing token, then grant microphone permission.

If microphone permission was denied, use the browser site controls to restore it and reload. `not_ready` health means the Meta key is missing; key values are never returned. Device speech availability is determined by the browser or Android speech engine.

Stop both terminal processes to end development. Session transcripts and generated audio are cleared when each session ends.

## Device-local Android workflow

1. Enable USB debugging and connect the S26 over USB.
2. Run `./scripts/dev-backend.sh android`.
3. Run `make client-android`. The script executes `adb reverse tcp:8000 tcp:8000` and enables the development-only loopback URL.
4. Enter the printed pairing token in the app.

The backend remains bound to `127.0.0.1`; cleartext HTTP is device-local through ADB reverse and is not exposed to the LAN. Expo Go is for validation, not Play Store packaging.

A future hosted or release build must use HTTPS/WSS and can retain the same versioned session protocol.
