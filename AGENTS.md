# Project commands

- Install backend dependencies: `cd apps/backend && uv sync`
- Install client dependencies: `cd apps/client && npm ci`
- Run all offline checks: `make check`
- Run deterministic browser E2E: `make e2e`
- Export web: `cd apps/client && npx expo export --platform web`
- Export Android: `cd apps/client && npx expo export --platform android`
- Regenerate protocol: `cd apps/backend && uv run python scripts/export_protocol_schema.py && cd ../client && npm run protocol:generate`
- Syntax-check launch scripts: `bash -n scripts/dev-cert.sh scripts/dev-backend.sh scripts/dev-client.sh`

`MUSE_API_KEY` is the only production provider credential. Device-native translation speech uses `expo-speech` and requires no backend key. The legacy ElevenLabs adapter and opt-in tests remain for comparison only; never put provider values in Expo variables, client code, URLs, logs, tests, or commits.

Default tests must never call paid providers. `make provider-smoke` is explicitly opt-in and also requires the live variables documented in `docs/testing/provider-smoke-tests.md`.

The repository uses Expo SDK 57 and Python 3.12. Keep `uv.lock` and `package-lock.json` committed. Full transcripts, generated audio, resume credentials, and pairing credentials are in-memory only.
