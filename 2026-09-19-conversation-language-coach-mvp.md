# Conversation Language Coach MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first conversational language coach that detects a learner's native-language insertions, displays only the helpful translation, and speaks it in the shared learning language during a safe pause.

**Architecture:** An Expo/React Native client captures audio and renders intervention cards on web and Android. A local Python/FastAPI backend owns the versioned session protocol, deterministic conversation state, Meta Muse Voice Transcribe and Muse Spark integrations, and ElevenLabs speech generation. Provider adapters are isolated behind typed ports so the coordinator and client can be tested without network calls.

**Tech Stack:** Expo SDK 57, React Native, Expo Router, TypeScript, `expo-audio`, `expo-keep-awake`, Python 3.12, FastAPI, Pydantic, `websockets`, OpenAI Python SDK pointed at Meta Model API, HTTPX, ElevenLabs APIs, pytest, Jest/React Native Testing Library, and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-conversation-language-coach-mvp-design.md`

## Global Constraints

- The client must use one Expo codebase for web-first development and the later S26 Ultra Android build.
- The backend runs on the development computer and must remain deployable later without changing the client protocol.
- Provider credentials stay in backend environment variables and never enter client bundles or protocol messages.
- Client audio sent to Muse is signed 16-bit little-endian mono PCM at 24 kHz in 1,920-sample/3,840-byte frames, approximately 80 ms each.
- Muse Voice Transcribe uses `DIARIZATION`, `CUMULATIVE` partials, and language bias fixed at session start.
- Muse Spark performs native-fragment classification and translation; Muse Voice Transcribe does not translate.
- ElevenLabs uses `eleven_flash_v2_5` where supported and the Text-to-Dialogue route with `eleven_v3_conversational` for the remaining Muse languages.
- Default mode analyzes only the first human speaker; two-learner mode analyzes the first two human speakers against their configured native languages.
- Visual previews may use debounced partials; only a result based on `speechComplete` may be spoken.
- The quiet grace period starts at 600 ms, speculative Spark analysis is debounced at 300 ms, reconnect grace lasts 15 seconds, and sessions end at 50 minutes.
- Full transcripts, interventions, and TTS audio remain in memory only and are cleared at session end; application logs never contain transcript text or raw audio.
- The active conversation screen stays foreground-only and requests keep-awake; background capture is out of scope.
- Accounts, permanent history, lessons, hosted deployment, voice enrollment, Play Store packaging, and confidence/correction workflows remain out of scope.
- Commit `uv.lock` and `package-lock.json`; use `uv` for Python and npm/`npx expo install` for the client.

## Review Focus

- **Overlapping Muse turns and revised cumulative partials:** later completion must update the correct `turn_id`, never append stale text, and never attach a speaker label to the wrong turn. Tasks 5 and 7 add state invariants, official-shape fixtures, and tests for this.
- **Generated speech before the second participant is mapped:** playback-window events must never create or change a participant mapping, even when the phone microphone hears its own speaker. Tasks 5, 10, and 14 test this.
- **Reconnect during queued or playing audio:** `session.resume` must replay only missed ordered events, retain the original mapping, and expire after 15 seconds without leaking provider sessions. Tasks 2, 11, and 13 test this.
- **Language supported by Muse but not Flash:** capability routing must select Text-to-Dialogue with `eleven_v3_conversational`, and incomplete route descriptors must fail readiness rather than fail mid-conversation. Tasks 3 and 9 test this.
- **Device audio not delivered at 24 kHz or in 80 ms callbacks:** the client must downmix, resample, and frame arbitrary callback buffers into exact Muse frames without dropping remainder samples. Task 4 tests this and validates it on the S26.

---

## Planned File Structure

```text
.
├── .env.example                         # Backend variable names only; no secrets
├── .gitignore                           # Python, Node, Expo, certificates, and environment files
├── Makefile                             # Repeatable setup, checks, and local run commands
├── README.md                            # Project overview and development entry points
├── packages/protocol/
│   ├── v1/                                  # Generated JSON Schemas for protocol v1
│   └── fixtures/                            # Golden valid/invalid wire payloads
├── apps/backend/
│   ├── pyproject.toml                       # Python package, runtime dependencies, tooling
│   ├── uv.lock                              # Locked Python environment
│   ├── scripts/export_protocol_schema.py    # Pydantic-to-JSON-Schema exporter
│   ├── scripts/measure_rss.py               # Metadata-only backend soak measurement
│   ├── src/language_coach/
│   │   ├── main.py                          # FastAPI composition root
│   │   ├── composition.py                   # Injectable production/test dependencies
│   │   ├── config.py                        # Environment settings and readiness
│   │   ├── api/http.py                       # Health, capabilities, and audio routes
│   │   ├── api/websocket.py                  # Authorized session WebSocket
│   │   ├── protocol/models.py                # Versioned Pydantic wire messages
│   │   ├── protocol/codec.py                 # JSON decoding and event sequencing
│   │   ├── domain/models.py                  # Provider-neutral session and event types
│   │   ├── domain/speaker_mapping.py         # Speaking-order participant map
│   │   ├── domain/transcript_store.py        # In-memory turn revisions/finals
│   │   ├── domain/interventions.py           # Preview/commit/cancel lifecycle
│   │   ├── domain/playback_gate.py           # Quiet-window and interruption rules
│   │   ├── domain/session_coordinator.py     # Conversation orchestration
│   │   ├── providers/interfaces.py          # Typed provider ports
│   │   ├── providers/muse_transcribe.py      # Muse realtime transport and normalizer
│   │   ├── providers/muse_spark.py           # Structured code-switch translation
│   │   ├── providers/elevenlabs.py           # Flash/T2D model routing and synthesis
│   │   ├── services/capabilities.py          # Supported-language catalog
│   │   ├── services/pairing.py               # Per-run local pairing token
│   │   ├── services/session_registry.py      # Active/resumable session ownership
│   │   ├── services/audio_assets.py          # Session-scoped in-memory MP3 store
│   │   └── services/safe_logging.py          # Metadata-only structured logging
│   └── tests/
│       ├── unit/                               # Pure domain and service tests
│       ├── contract/                           # Provider fixture tests
│       └── integration/                        # FastAPI/WebSocket tests with fakes
├── apps/client/
│   ├── package.json                         # Expo scripts and dependencies
│   ├── package-lock.json                    # Locked npm environment
│   ├── app.json                             # Expo config and permissions
│   ├── src/app/_layout.tsx                 # Expo Router root
│   ├── src/app/index.tsx                   # Setup route
│   ├── src/app/conversation.tsx            # Active-session route
│   ├── src/app/audio-diagnostics.tsx       # Development-only PCM diagnostics
│   ├── src/protocol/generated.ts           # Generated TypeScript wire types
│   ├── src/protocol/server-events.schema.json # Runtime event validation schema
│   ├── src/protocol/parse.ts               # Full event-specific runtime validation
│   ├── src/protocol/sessionSocket.ts       # JSON/binary WebSocket client and resume
│   ├── src/protocol/reducer.ts             # Ordered UI state reducer
│   ├── src/setup/model.ts                  # Setup form state
│   ├── src/setup/validation.ts             # Mode/language validation
│   ├── src/setup/SetupScreen.tsx           # Setup interface
│   ├── src/conversation/model.ts           # Client conversation state
│   ├── src/conversation/ConversationScreen.tsx # Intervention-only screen
│   ├── src/conversation/InterventionCard.tsx   # Source/target card and replay
│   ├── src/audio/pcm.ts                     # Downmix/resample/frame logic
│   ├── src/audio/usePcmCapture.ts           # Expo Audio capture lifecycle
│   ├── src/audio/useInterventionPlayer.ts   # MP3 playback and interruption
│   ├── src/services/capabilities.ts         # Backend discovery
│   ├── src/session/SessionProvider.tsx      # Route-spanning live session ownership
│   ├── src/session/useForegroundSession.ts  # Foreground-only lifecycle guard
│   ├── tests/                               # Jest/React Native Testing Library tests
│   └── e2e/                                # Playwright mocked-provider web path
├── scripts/
│   ├── dev-cert.sh                        # Local trusted certificate generation
│   ├── dev-backend.sh                     # TLS backend launcher
│   └── dev-client.sh                      # Expo web/Android launcher
└── docs/testing/
    ├── provider-smoke-tests.md               # Opt-in live checks
    └── s26-acceptance-checklist.md            # Manual device and soak scenarios
```

## Task 1: Bootstrap Both Applications and Prove the Local Shell

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `Makefile`
- Create: `README.md`
- Create: `apps/backend/pyproject.toml`
- Create: `apps/backend/src/language_coach/__init__.py`
- Create: `apps/backend/src/language_coach/main.py`
- Create: `apps/backend/tests/integration/test_health.py`
- Create: `apps/client/` with the Expo default TypeScript template
- Modify: `apps/client/src/app/index.tsx`

**Interfaces:**
- Produces: `language_coach.main.create_app() -> FastAPI`
- Produces: `GET /health -> {"status": "ok", "protocol_version": 1}`
- Produces: an Expo SDK 57 web/Android shell whose route root is `apps/client/src/app`

- [ ] **Step 1: Scaffold the locked toolchains**

Run from the repository root:

```bash
uv init --package --name language-coach --python 3.12 apps/backend
cd apps/backend
uv add fastapi "uvicorn[standard]" pydantic-settings httpx websockets openai elevenlabs
uv add --dev pytest pytest-asyncio pytest-cov ruff mypy psutil
cd ../..
npx create-expo-app@latest apps/client --template default@57 --yes --no-agents-md
cd apps/client
npx expo install expo-audio expo-keep-awake expo-localization
npm install @react-native-picker/picker ajv ajv-formats
npm install --save-dev jest-expo @testing-library/react-native @types/jest json-schema-to-typescript @playwright/test
npx playwright install chromium
cd ../..
```

The versioned template makes SDK 57 deterministic and does not rely on a suppressed interactive prompt. Move the generated Expo Router tree from `apps/client/app` to `apps/client/src/app` before editing it; the project must contain only one Router root. Keep the generated `uv.lock` and `package-lock.json`.

- [ ] **Step 2: Add repository exclusions and the credential template**

Create `.gitignore` with:

```gitignore
.DS_Store
.env
.certs/
.pytest_cache/
.ruff_cache/
.mypy_cache/
__pycache__/
*.py[cod]
.coverage
htmlcov/
.venv/
node_modules/
.expo/
dist/
web-build/
playwright-report/
test-results/
```

Create `.env.example` with:

```dotenv
MODEL_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ALLOWED_ORIGINS=["http://localhost:8081","https://localhost:8443"]
BACKEND_PUBLIC_BASE_URL=https://localhost:8444
```

- [ ] **Step 3: Write the failing backend health test**

Create `apps/backend/tests/integration/test_health.py`:

```python
from fastapi.testclient import TestClient

from language_coach.main import create_app


def test_health_reports_protocol_version() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "protocol_version": 1}
```

- [ ] **Step 4: Run the health test to verify it fails**

Run:

```bash
cd apps/backend
uv run pytest tests/integration/test_health.py -v
```

Expected: FAIL because `language_coach.main` does not yet expose `create_app`.

- [ ] **Step 5: Implement the smallest FastAPI composition root**

Create `apps/backend/src/language_coach/main.py`:

```python
from fastapi import FastAPI

PROTOCOL_VERSION = 1


def create_app() -> FastAPI:
    app = FastAPI(title="Conversation Language Coach")

    @app.get("/health")
    async def health() -> dict[str, str | int]:
        return {"status": "ok", "protocol_version": PROTOCOL_VERSION}

    return app


app = create_app()
```

Replace `apps/client/src/app/index.tsx` with a minimal `SafeAreaView` containing the title `Conversation Language Coach` and the subtitle `Local development shell`. Add `"test": "jest"` under `scripts` and `"jest": {"preset": "jest-expo"}` at the top level of `apps/client/package.json` so the very next task can run tests without more bootstrap work.

- [ ] **Step 6: Verify both shells build**

Run:

```bash
cd apps/backend
uv run pytest tests/integration/test_health.py -v
uv run ruff check src tests
cd ../client
npm test -- --runInBand --passWithNoTests
npx tsc --noEmit
npx expo export --platform web
```

Expected: the backend test passes, Ruff reports no errors, Jest starts successfully with no tests, TypeScript succeeds, and Expo produces a web export. The bootstrap health response is deliberately liveness-only; Task 3 replaces this test and response with dependency-injected provider readiness.

- [ ] **Step 7: Add concise root commands**

Create a `Makefile` with `backend-test`, `client-test`, `check`, `backend-dev`, and `client-web` targets that invoke the commands above. Create `README.md` with the product sentence, links to the spec and this plan, prerequisites (`uv`, Node LTS, Expo Go), and a warning that `.env` must never be committed.

- [ ] **Step 8: Commit the working shell**

```bash
git add .gitignore .env.example Makefile README.md apps/backend apps/client
git commit -m "chore: bootstrap language coach applications"
```

## Task 2: Define Protocol v1 and Generate Client Types

**Files:**
- Create: `apps/backend/src/language_coach/protocol/models.py`
- Create: `apps/backend/src/language_coach/protocol/codec.py`
- Create: `apps/backend/scripts/export_protocol_schema.py`
- Create: `apps/backend/tests/unit/test_protocol.py`
- Create: `packages/protocol/v1/client-messages.schema.json`
- Create: `packages/protocol/v1/server-events.schema.json`
- Create: `packages/protocol/fixtures/valid-session-start.json`
- Create: `packages/protocol/fixtures/valid-intervention.json`
- Create: `apps/client/scripts/generate-protocol.mjs`
- Create: `apps/client/src/protocol/generated.ts`
- Create: `apps/client/src/protocol/server-events.schema.json`
- Create: `apps/client/src/protocol/parse.ts`
- Create: `apps/client/tests/protocol/parse.test.ts`
- Modify: `apps/client/package.json`
- Modify: `apps/client/tsconfig.json`

**Interfaces:**
- Produces: `parse_client_message(raw: str) -> ClientMessage`
- Produces: `encode_server_event(event: ServerEvent) -> str`
- Produces: strict, event-specific client controls and server events, including session recovery, intervention audio failure, and playback start/stop requests
- Produces: generated TypeScript types with the same field names and discriminators

- [ ] **Step 1: Write failing protocol validation tests**

Create `apps/backend/tests/unit/test_protocol.py` with tests that assert:

```python
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from language_coach.protocol.models import ClientMessageAdapter, SessionStart


FIXTURES = Path(__file__).parents[4] / "packages" / "protocol" / "fixtures"


def test_valid_session_start_fixture_parses() -> None:
    payload = json.loads((FIXTURES / "valid-session-start.json").read_text())
    message = ClientMessageAdapter.validate_python(payload)
    assert isinstance(message, SessionStart)
    assert message.config.mode == "learner_fluent"


def test_native_language_cannot_equal_learning_language() -> None:
    payload = {
        "type": "session.start",
        "protocol_version": 1,
        "pairing_token": "p" * 43,
        "config": {
            "mode": "learner_fluent",
            "learning_language": "es",
            "learner1_native_language": "es",
            "learner2_native_language": None,
        },
    }
    with pytest.raises(ValidationError):
        ClientMessageAdapter.validate_python(payload)


def test_two_learner_mode_requires_second_native_language() -> None:
    payload = {
        "type": "session.start",
        "protocol_version": 1,
        "pairing_token": "p" * 43,
        "config": {
            "mode": "two_learners",
            "learning_language": "es",
            "learner1_native_language": "en",
            "learner2_native_language": None,
        },
    }
    with pytest.raises(ValidationError):
        ClientMessageAdapter.validate_python(payload)
```

Add `packages/protocol/fixtures/valid-session-start.json` containing a learner-plus-fluent English-to-Spanish session and a 43-character non-secret fixture pairing token. Add `valid-intervention.json` containing a complete protocol-v1 `intervention.committed` event with UUID strings and sequence `3`. Add validation cases for all five connection states, including `idle`, and reject any unknown state.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd apps/backend
uv run pytest tests/unit/test_protocol.py -v
```

Expected: FAIL because the protocol models do not exist.

- [ ] **Step 3: Implement strict Pydantic wire models**

Create `protocol/models.py` around these exact shapes:

```python
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionConfig(WireModel):
    mode: Literal["learner_fluent", "two_learners"]
    learning_language: str
    learner1_native_language: str
    learner2_native_language: str | None = None

    @model_validator(mode="after")
    def validate_languages(self) -> "SessionConfig":
        if self.learning_language == self.learner1_native_language:
            raise ValueError("learner 1 native language must differ from learning language")
        if self.mode == "two_learners" and self.learner2_native_language is None:
            raise ValueError("two-learner mode requires learner 2 native language")
        if self.mode == "learner_fluent" and self.learner2_native_language is not None:
            raise ValueError("learner-plus-fluent mode cannot configure learner 2")
        if self.learner2_native_language == self.learning_language:
            raise ValueError("learner 2 native language must differ from learning language")
        return self


class SessionStart(WireModel):
    type: Literal["session.start"]
    protocol_version: Literal[1]
    pairing_token: str = Field(min_length=32)
    config: SessionConfig


class SessionResume(WireModel):
    type: Literal["session.resume"]
    protocol_version: Literal[1]
    pairing_token: str = Field(min_length=32)
    session_id: UUID
    resume_token: str = Field(min_length=32)
    last_sequence: int = Field(ge=0)


class AudioStart(WireModel):
    type: Literal["audio.start"]
    protocol_version: Literal[1]


class AudioStop(WireModel):
    type: Literal["audio.stop"]
    protocol_version: Literal[1]


class SpeakersSwap(WireModel):
    type: Literal["speakers.swap"]
    protocol_version: Literal[1]


class PlaybackStarted(WireModel):
    type: Literal["playback.started"]
    protocol_version: Literal[1]
    intervention_id: UUID
    manual: bool = False


class PlaybackEnded(WireModel):
    type: Literal["playback.ended"]
    protocol_version: Literal[1]
    intervention_id: UUID


class PlaybackInterrupted(WireModel):
    type: Literal["playback.interrupted"]
    protocol_version: Literal[1]
    intervention_id: UUID


class InterventionAudioRetry(WireModel):
    type: Literal["intervention.audio_retry"]
    protocol_version: Literal[1]
    intervention_id: UUID


class SessionEnd(WireModel):
    type: Literal["session.end"]
    protocol_version: Literal[1]


ClientMessage = Annotated[
    SessionStart
    | SessionResume
    | AudioStart
    | AudioStop
    | SpeakersSwap
    | PlaybackStarted
    | PlaybackEnded
    | PlaybackInterrupted
    | InterventionAudioRetry
    | SessionEnd,
    Field(discriminator="type"),
]
ClientMessageAdapter = TypeAdapter(ClientMessage)
```

Define a `ServerEnvelope` base with `protocol_version: Literal[1]`, `session_id: UUID`, and non-negative `sequence`. Define each server event as its own `extra="forbid"` Pydantic model with these payload fields:

| Event type | Required payload beyond the envelope |
|---|---|
| `session.ready` | `resume_token`, `resumed` |
| `session.status` | `connection_state`, `activities` |
| `session.warning` | `reason="expiring"`, `seconds_remaining` |
| `speaker.mapped` | `provider_label`, `participant_id`, `display_label` |
| `intervention.preview` | `turn_id`, `intervention_id`, `participant_id`, `revision`, source/target text and language codes |
| `intervention.committed` | `turn_id`, `intervention_id`, `participant_id`, source/target text and language codes |
| `intervention.audio_ready` | `turn_id`, `intervention_id`, `audio_url` |
| `intervention.audio_failed` | `turn_id`, `intervention_id`, `retry_available` |
| `intervention.cancelled` | `turn_id`, `intervention_id`, `reason` |
| `playback.start_requested` | `intervention_id` |
| `playback.stop_requested` | `intervention_id`, `reason` (`human_speech | connection_lost`) |
| `session.degraded` | `subsystem`, `code`, `recoverable`, `restart_required` |
| `session.error` | safe `code`, safe user-facing `message`, `recoverable` |
| `session.ended` | `reason` |

Use these closed literal sets: connection state is `idle | connecting | active | degraded | ended`; activities are `listening | analyzing | audio_pending | speaking`; participant IDs are `learner_1 | learner_2 | fluent_partner`; cancellation reasons are `preview_obsolete | final_empty | final_replaced | session_ended`; playback-stop reasons are `human_speech | connection_lost`; degraded subsystems are `transcription | translation | speech`; and session-ended reasons are `user_end | lifetime | muse_failure | disconnect_timeout | shutdown`. `idle` is the authorized, provider-not-started state after `session.ready`; `audio.start` moves through `connecting`, and only a completed Muse handshake moves to `active`. Keep safe error codes as literals defined beside their event rather than returning raw provider messages.

For each server event, also define a matching internal payload model that omits only `protocol_version`, `session_id`, and `sequence`; `ServerEventPayload` is their discriminated union and is not exported as a wire schema. Define `ServerEvent` as the discriminated union of the complete envelope models and define `ServerEventAdapter = TypeAdapter(ServerEvent)`. `audio_url` is an absolute client-fetchable URL whose session path contains only a random 192-bit asset capability; it expires when that session ends and never contains a pairing token, resume token, or provider credential. No event contains a complete turn transcript.

- [ ] **Step 4: Implement codec functions and schema export**

Create `protocol/codec.py`:

```python
from language_coach.protocol.models import ClientMessage, ClientMessageAdapter, ServerEvent


def parse_client_message(raw: str) -> ClientMessage:
    return ClientMessageAdapter.validate_json(raw)


def encode_server_event(event: ServerEvent) -> str:
    return event.model_dump_json()
```

Create `scripts/export_protocol_schema.py` using `ClientMessageAdapter.json_schema()` and `ServerEventAdapter.json_schema()` and write deterministic, sorted, two-space-indented JSON to `packages/protocol/v1/client-messages.schema.json` and `server-events.schema.json`.

- [ ] **Step 5: Generate TypeScript types and validate incoming envelopes**

Add this npm script:

```json
{
  "scripts": {
    "protocol:generate": "node scripts/generate-protocol.mjs"
  }
}
```

`generate-protocol.mjs` must invoke `compileFromFile` from `json-schema-to-typescript` for both schemas, write `src/protocol/generated.ts`, and copy the server schema to `src/protocol/server-events.schema.json`. In `parse.ts`, compile that local schema once with Ajv plus `ajv-formats` for UUID validation and return a generated `ServerEvent` only when the full event-specific schema validates. Throw `ProtocolError` with Ajv's field paths but not field values. This must reject, for example, an `intervention.committed` event missing `target_text`, not merely validate its common envelope.

Enable `resolveJsonModule` in `apps/client/tsconfig.json` so both Jest and Metro use the same checked-in local schema import; do not make the runtime bundle reach outside `apps/client` into the monorepo.

- [ ] **Step 6: Add client fixture tests**

Create `apps/client/tests/protocol/parse.test.ts`:

```typescript
import fixture from '../../../../packages/protocol/fixtures/valid-intervention.json';
import { parseServerEvent, ProtocolError } from '../../src/protocol/parse';

test('parses the committed intervention fixture', () => {
  const event = parseServerEvent(fixture);
  expect(event.type).toBe('intervention.committed');
  expect(event.sequence).toBe(3);
});

test('rejects a future protocol version', () => {
  expect(() => parseServerEvent({ ...fixture, protocol_version: 2 })).toThrow(ProtocolError);
});

test('rejects an event missing discriminator-specific fields', () => {
  const { target_text: _removed, ...malformed } = fixture;
  expect(() => parseServerEvent(malformed)).toThrow(ProtocolError);
});
```

- [ ] **Step 7: Verify both languages agree on the contract**

Run:

```bash
cd apps/backend
uv run python scripts/export_protocol_schema.py
uv run pytest tests/unit/test_protocol.py -v
cd ../client
npm run protocol:generate
npm test -- --runInBand tests/protocol/parse.test.ts
npx tsc --noEmit
```

Expected: all tests pass and generation is deterministic. Record SHA-256 checksums for the generated schema/type files, run both generators a second time, and assert the checksums are unchanged.

- [ ] **Step 8: Commit protocol v1**

```bash
git add packages/protocol apps/backend/src/language_coach/protocol apps/backend/scripts apps/backend/tests/unit/test_protocol.py apps/client/scripts apps/client/src/protocol apps/client/tests/protocol apps/client/package.json apps/client/package-lock.json apps/client/tsconfig.json
git commit -m "feat: define conversation protocol v1"
```

## Task 3: Add Language Capabilities, Readiness, and Pairing

**Files:**
- Create: `apps/backend/src/language_coach/config.py`
- Create: `apps/backend/src/language_coach/services/capabilities.py`
- Create: `apps/backend/src/language_coach/services/pairing.py`
- Create: `apps/backend/src/language_coach/api/http.py`
- Create: `apps/backend/tests/unit/test_capabilities.py`
- Create: `apps/backend/tests/unit/test_pairing.py`
- Modify: `apps/backend/src/language_coach/main.py`
- Modify: `apps/backend/tests/integration/test_health.py`

**Interfaces:**
- Produces: `Settings` loaded only by the backend
- Produces: `CAPABILITIES: dict[str, LanguageCapability]`
- Produces: `get_capability(language_code: str) -> LanguageCapability`
- Produces: `get_tts_route(language_code: str) -> TtsRouteDescriptor`
- Produces: `PairingToken.verify(candidate: str) -> bool`
- Produces: `GET /health` and `GET /v1/capabilities`

- [ ] **Step 1: Write capability and pairing tests first**

Test these exact conditions:

```python
from language_coach.services.capabilities import CAPABILITIES, get_tts_route
from language_coach.services.pairing import PairingToken


def test_all_muse_languages_have_tts_routes() -> None:
    assert len(CAPABILITIES) == 25
    assert all(item.muse_bias_name for item in CAPABILITIES.values())
    assert all(item.eleven_language_code for item in CAPABILITIES.values())
    assert all(item.tts_route.output_format == "mp3_44100_128" for item in CAPABILITIES.values())


def test_bengali_uses_v3_fallback() -> None:
    assert get_tts_route("bn").kind == "v3_conversational"
    assert get_tts_route("bn").operation == "text_to_dialogue"


def test_spanish_uses_flash() -> None:
    assert get_tts_route("es").kind == "flash"
    assert get_tts_route("es").model_id == "eleven_flash_v2_5"


def test_pairing_token_uses_constant_time_verification() -> None:
    token = PairingToken("a" * 43)
    assert token.verify("a" * 43)
    assert not token.verify("b" * 43)
```

Replace Task 1's unconditional `/health == {"status":"ok"}` assertion rather than leaving both contracts in the suite. The new tests cover `/health` with explicitly injected complete settings (`status="ok"`) and explicitly injected missing provider keys (`status="not_ready"`), assert secret values are never returned, and assert `/v1/capabilities` contains all 25 language codes and display names.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/backend
uv run pytest tests/unit/test_capabilities.py tests/unit/test_pairing.py tests/integration/test_health.py -v
```

Expected: FAIL because the services and readiness response are missing.

- [ ] **Step 3: Implement the explicit language catalog**

Create `services/capabilities.py` with frozen `TtsRouteDescriptor` and `LanguageCapability` dataclasses. A descriptor contains `kind`, SDK `operation`, exact `model_id`, and exact `output_format`. Define two complete descriptors: Flash uses `text_to_speech`, `eleven_flash_v2_5`, and `mp3_44100_128`; conversational v3 uses `text_to_dialogue`, `eleven_v3_conversational`, and `mp3_44100_128`. Each capability stores its app code, UI display name, explicit Muse `languageBias` name, explicit ElevenLabs language code, and one descriptor. Build the catalog from these rows:

```python
LANGUAGE_ROWS = (
    ("ar", "Arabic", "Arabic", "ar", "flash"),
    ("bn", "Bengali", "Bengali", "bn", "v3_conversational"),
    ("nl", "Dutch", "Dutch", "nl", "flash"),
    ("en", "English", "English", "en", "flash"),
    ("fr", "French", "French", "fr", "flash"),
    ("de", "German", "German", "de", "flash"),
    ("he", "Hebrew", "Hebrew", "he", "v3_conversational"),
    ("hi", "Hindi", "Hindi", "hi", "flash"),
    ("id", "Indonesian", "Indonesian", "id", "flash"),
    ("it", "Italian", "Italian", "it", "flash"),
    ("ja", "Japanese", "Japanese", "ja", "flash"),
    ("kn", "Kannada", "Kannada", "kn", "v3_conversational"),
    ("ko", "Korean", "Korean", "ko", "flash"),
    ("ms", "Malay", "Malay", "ms", "flash"),
    ("zh", "Mandarin Chinese", "Mandarin Chinese", "zh", "flash"),
    ("mr", "Marathi", "Marathi", "mr", "v3_conversational"),
    ("pl", "Polish", "Polish", "pl", "flash"),
    ("pt", "Portuguese", "Portuguese", "pt", "flash"),
    ("es", "Spanish", "Spanish", "es", "flash"),
    ("fil", "Tagalog", "Tagalog", "fil", "flash"),
    ("ta", "Tamil", "Tamil", "ta", "flash"),
    ("te", "Telugu", "Telugu", "te", "v3_conversational"),
    ("th", "Thai", "Thai", "th", "v3_conversational"),
    ("tr", "Turkish", "Turkish", "tr", "flash"),
    ("vi", "Vietnamese", "Vietnamese", "vi", "flash"),
)
```

Build `CAPABILITIES` from those rows and raise `UnsupportedLanguageError` when a code is absent. Validate at startup that every capability has a complete route descriptor. This static readiness check proves the application has a route; live account access and provider behavior remain the opt-in Task 16 smoke tests.

- [ ] **Step 4: Implement settings and readiness without leaking secrets**

Use `pydantic-settings` with `env_file=".env"`, `extra="ignore"`, and fields for both API keys, the ElevenLabs voice ID, JSON-array `allowed_origins`, and public backend base URL. Add computed `providers_configured` and make `/health` return `status: "ok"` only when all required provider settings are present; otherwise return `status: "not_ready"` plus boolean provider names, never key contents. Make `create_app(settings: Settings | None = None)` injectable at this stage. Every readiness test passes `Settings(_env_file=None, model_api_key=fixture_model_key, elevenlabs_api_key=fixture_tts_key, elevenlabs_voice_id=fixture_voice_id, allowed_origins=fixture_origins, backend_public_base_url=fixture_base_url)` explicitly, so a developer's shell or `.env` cannot alter test outcomes. Task 11 deliberately migrates this temporary signature and all earlier callers to the final `create_app(dependencies: AppDependencies | None = None)` composition contract; both signatures never coexist in the final tree.

- [ ] **Step 5: Implement per-run pairing**

`PairingToken` must generate `secrets.token_urlsafe(32)` once per backend process and use `secrets.compare_digest` in `verify`. Instantiate it in the FastAPI lifespan and store it on `app.state`. Write one deliberate terminal banner containing the token and local URLs directly to the operator console; do not send that banner through structured/application/access logging. Do not accept a production environment override and do not place the token in `/health` or `/v1/capabilities`; tests inject a `PairingToken` object through application dependencies.

- [ ] **Step 6: Verify capability and security behavior**

```bash
cd apps/backend
uv run pytest tests/unit/test_capabilities.py tests/unit/test_pairing.py tests/integration/test_health.py -v
uv run ruff check src tests
uv run mypy src
```

Expected: all tests pass; missing keys produce `not_ready`; logs and JSON contain no secret values.

- [ ] **Step 7: Commit configuration and capabilities**

```bash
git add apps/backend/src/language_coach/config.py apps/backend/src/language_coach/services apps/backend/src/language_coach/api apps/backend/src/language_coach/main.py apps/backend/tests
git commit -m "feat: add language capabilities and local pairing"
```

## Task 4: Normalize Expo Audio into Exact Muse PCM Frames

**Files:**
- Create: `apps/client/src/audio/pcm.ts`
- Create: `apps/client/src/audio/usePcmCapture.ts`
- Create: `apps/client/src/app/audio-diagnostics.tsx`
- Create: `apps/client/tests/audio/pcm.test.ts`
- Create: `apps/client/tests/audio/usePcmCapture.test.tsx`
- Create: `docs/testing/s26-acceptance-checklist.md`
- Modify: `apps/client/src/app/_layout.tsx`

**Interfaces:**
- Produces: `StreamingPcmNormalizer.push(buffer: AudioStreamBufferLike) -> Int16Array`
- Produces: `PcmFrameAssembler.push(samples: Int16Array) -> ArrayBuffer[]`
- Produces: `usePcmCapture({onFrame}) -> {start, stop, state, diagnostics}`
- Guarantees: every emitted frame is exactly 3,840 bytes and represents 1,920 mono samples at 24 kHz

- [ ] **Step 1: Write failing PCM tests**

Create tests for int16 passthrough, float32 clipping/conversion, stereo downmix, streaming resampling across arbitrary callback boundaries, invalid format metadata, and remainder preservation:

```typescript
import { PcmFrameAssembler, StreamingPcmNormalizer } from '../../src/audio/pcm';

test('assembles exact 80 ms frames and preserves remainder', () => {
  const assembler = new PcmFrameAssembler();
  const first = assembler.push(new Int16Array(1000));
  const second = assembler.push(new Int16Array(1000));

  expect(first).toHaveLength(0);
  expect(second).toHaveLength(1);
  expect(second[0].byteLength).toBe(3840);
  expect(assembler.pendingSamples).toBe(80);
});

test('downmixes and resamples 48 kHz stereo to 24 kHz mono', () => {
  const stereo = new Int16Array(3840);
  stereo.fill(1200);
  const normalizer = new StreamingPcmNormalizer();
  const output = normalizer.push({
    data: stereo.buffer,
    channels: 2,
    encoding: 'int16',
    sampleRate: 48000,
  });
  expect(output).toHaveLength(960);
  expect(output[0]).toBe(1200);
});

test('split callbacks produce the same stream as one callback', () => {
  const source = Int16Array.from({ length: 4001 }, (_, index) => index - 2000);
  const whole = new StreamingPcmNormalizer().push({
    data: source.buffer,
    channels: 1,
    encoding: 'int16',
    sampleRate: 44100,
  });

  const splitNormalizer = new StreamingPcmNormalizer();
  const split = [source.slice(0, 997), source.slice(997, 2051), source.slice(2051)]
    .flatMap((part) => Array.from(splitNormalizer.push({
      data: part.buffer,
      channels: 1,
      encoding: 'int16',
      sampleRate: 44100,
    })));

  expect(split).toEqual(Array.from(whole));
});
```

Also test callback splits on odd source-frame boundaries, a sample-rate change mid-stream, zero/negative sample rates, zero channels, byte lengths misaligned for the declared encoding, `reset()` clearing interpolation and framing remainder, and a known `0x1234` sample emitting bytes `0x34, 0x12` to prove little-endian wire packing.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/client
npm test -- --runInBand tests/audio/pcm.test.ts
```

Expected: FAIL because `pcm.ts` does not exist.

- [ ] **Step 3: Implement deterministic PCM conversion and framing**

In `pcm.ts`, implement these constants and operations:

```typescript
export const TARGET_SAMPLE_RATE = 24_000;
export const FRAME_SAMPLES = 1_920;
export const FRAME_BYTES = 3_840;

export type AudioStreamBufferLike = {
  data: ArrayBuffer;
  channels: number;
  encoding: 'float32' | 'int16';
  sampleRate: number;
};
```

Decode declared int16 input with `DataView.getInt16(offset, true)` and declared float32 input with `DataView.getFloat32(offset, true)`. Convert float samples by clamping to `[-1, 1]` and multiplying negative values by `32768` and non-negative values by `32767`. Downmix interleaved channels by averaging each frame. `StreamingPcmNormalizer` keeps the prior mono sample plus a fractional source position between calls, so a callback split produces the same output stream as one contiguous buffer. A sample-rate or channel-count change resets only after returning a typed `audio_format_changed` error; it must never silently splice two formats. `PcmFrameAssembler` concatenates pending and new samples, writes each emitted sample with `DataView.setInt16(offset, value, true)` to guarantee little-endian bytes, emits exactly 1,920 samples, and retains the final short slice.

- [ ] **Step 4: Wrap Expo's realtime stream**

Implement `usePcmCapture` with:

```typescript
const SOURCE_ENCODING = 'int16' as const;

const { stream } = useAudioStream({
  channels: 1,
  encoding: SOURCE_ENCODING,
  sampleRate: TARGET_SAMPLE_RATE,
  onBuffer(buffer) {
    const adapted = adaptExpoBuffer(buffer, SOURCE_ENCODING);
    updateDiagnostics({ sampleRate: buffer.sampleRate, channels: buffer.channels });
    const samples = normalizer.current.push(adapted);
    for (const frame of assembler.current.push(samples)) {
      onFrameRef.current(frame);
    }
  },
});
```

Expo reports `data`, `channels`, and `sampleRate` in callbacks; encoding comes from the stream option, not the callback object. `adaptExpoBuffer` therefore receives the configured encoding explicitly, validates positive rates/channels and byte alignment, and never invents an `encoding` property by spreading the callback. If a platform adapter can report a different actual encoding, pass that actual value and use the float32 conversion path; otherwise the requested Expo encoding is the platform contract. The hook must request permission only from its explicit `start()` method, return recoverable `permission_denied`, `unsupported_audio_format`, and `audio_format_changed` states, and call `stream.stop()` plus reset both normalizer and assembler on `stop()` or unmount.

- [ ] **Step 5: Add a development-only diagnostics route**

`audio-diagnostics.tsx` must be reachable only when `__DEV__` is true. The hook's returned `diagnostics` object exposes actual callback sample rate, channel count, configured encoding, emitted frame count, and last frame byte length. Display those values with permission/capture state and start/stop controls. Never expose sample contents or save audio.

- [ ] **Step 6: Run automated checks**

```bash
cd apps/client
npm test -- --runInBand tests/audio
npx tsc --noEmit
npx expo export --platform web
```

Expected: tests pass and the web bundle builds.

- [ ] **Step 7: Validate the audio contract on both targets**

Run the diagnostics route from `http://localhost` in desktop Chrome; localhost is a secure-context exception for this isolated early browser microphone check. Open the same diagnostics route in Expo Go on the S26 Ultra through Expo's normal development QR/LAN bundle connection; it does not contact the backend yet. Task 15 adds the separate ADB-reversed backend path for full Android sessions. Speak continuously for 30 seconds on each target. Confirm every emitted frame reports 3,840 bytes, no frame counter stalls, stopping releases the microphone indicator, and permission denial returns to an actionable state. Record the observed native callback sample rates in `docs/testing/s26-acceptance-checklist.md` without recording speech content.

- [ ] **Step 8: Commit the reusable audio adapter**

```bash
git add apps/client/src/audio apps/client/src/app apps/client/tests/audio docs/testing/s26-acceptance-checklist.md
git commit -m "feat: normalize microphone audio for Muse"
```

## Task 5: Model Participants, Speaker Mapping, and Authoritative Turns

**Files:**
- Create: `apps/backend/src/language_coach/domain/models.py`
- Create: `apps/backend/src/language_coach/domain/speaker_mapping.py`
- Create: `apps/backend/src/language_coach/domain/transcript_store.py`
- Create: `apps/backend/tests/unit/test_speaker_mapping.py`
- Create: `apps/backend/tests/unit/test_transcript_store.py`

**Interfaces:**
- Produces: provider-neutral `SpeechStarted`, `TranscriptPartial`, `SpeakerObserved`, `SpeechCompleted`, and `TranscriptionFailure` events
- Produces: `SpeakerMapping.observe(label: str, first_audio_ms: int, overlaps_playback: bool) -> ParticipantId | None`
- Produces: `SpeakerMapping.swap_learners() -> None`
- Produces: `TranscriptStore.start(turn_id, started_at_ms)`, `apply_partial(turn_id, revision, text)`, `finalize(turn_id, speaker_label, text, completed_at_ms)`, and `context_before(turn_id, limit)`
- Guarantees: cumulative text replaces the prior revision for the same `turn_id`; turn completion order never determines speaker identity

- [ ] **Step 1: Write failing speaker-mapping tests**

Create `test_speaker_mapping.py` with these scenarios:

```python
from language_coach.domain.models import ConversationMode, ParticipantId
from language_coach.domain.speaker_mapping import SpeakerMapping


def test_default_mode_maps_first_two_human_speakers() -> None:
    mapping = SpeakerMapping(ConversationMode.LEARNER_FLUENT)
    assert mapping.observe("A", first_audio_ms=100, overlaps_playback=False) is ParticipantId.LEARNER_1
    assert mapping.observe("B", first_audio_ms=500, overlaps_playback=False) is ParticipantId.FLUENT_PARTNER
    assert mapping.observe("A", first_audio_ms=100, overlaps_playback=False) is ParticipantId.LEARNER_1


def test_two_learner_mode_maps_and_swaps() -> None:
    mapping = SpeakerMapping(ConversationMode.TWO_LEARNERS)
    mapping.observe("A", first_audio_ms=100, overlaps_playback=False)
    mapping.observe("B", first_audio_ms=500, overlaps_playback=False)
    mapping.swap_learners()
    assert mapping.participant_for("A") is ParticipantId.LEARNER_2
    assert mapping.participant_for("B") is ParticipantId.LEARNER_1


def test_playback_overlap_cannot_create_a_mapping() -> None:
    mapping = SpeakerMapping(ConversationMode.TWO_LEARNERS)
    assert mapping.observe("phone-speaker", first_audio_ms=900, overlaps_playback=True) is None
    assert mapping.labels == {}
```

Also assert that a third distinct label is ignored in both modes and that swap is unavailable until two learner labels exist.

- [ ] **Step 2: Write failing transcript-store tests**

Cover revised cumulative partials, duplicate revisions, stale revisions, authoritative completion, overlapping `turn_id` values, and reverse completion order:

```python
from language_coach.domain.transcript_store import TranscriptStore


def test_cumulative_partial_replaces_instead_of_appending() -> None:
    store = TranscriptStore()
    store.apply_partial("turn-a", revision=1, text="Necesito the")
    store.apply_partial("turn-a", revision=2, text="Necesito the grocery store")
    assert store.get("turn-a").text == "Necesito the grocery store"


def test_stale_partial_cannot_replace_newer_text() -> None:
    store = TranscriptStore()
    store.apply_partial("turn-a", revision=4, text="new text")
    store.apply_partial("turn-a", revision=3, text="old text")
    assert store.get("turn-a").text == "new text"


def test_overlapping_turns_may_complete_out_of_order() -> None:
    store = TranscriptStore()
    store.apply_partial("turn-a", 1, "first")
    store.apply_partial("turn-b", 1, "second")
    store.finalize("turn-b", "speaker-b", "second final", completed_at_ms=200)
    store.finalize("turn-a", "speaker-a", "first final", completed_at_ms=250)
    assert store.get("turn-a").speaker_label == "speaker-a"
    assert store.get("turn-b").speaker_label == "speaker-b"
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd apps/backend
uv run pytest tests/unit/test_speaker_mapping.py tests/unit/test_transcript_store.py -v
```

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 4: Implement provider-neutral domain types**

Define string enums for `ConversationMode` and `ParticipantId`, immutable normalized transcription events, and this turn record:

```python
from dataclasses import dataclass


@dataclass
class TurnRecord:
    turn_id: str
    revision: int = 0
    text: str = ""
    speaker_label: str | None = None
    started_at_ms: int | None = None
    completed_at_ms: int | None = None
    final: bool = False
```

Every normalized event carries its correlated `turn_id` and provider `audio_processed_ms` when applicable, even though Muse omits `turnId` from raw partial and speaker events. `SpeechCompleted` carries the final text and resolved provider speaker label; the adapter, not the store, is responsible for correlating provider messages.

- [ ] **Step 5: Implement deterministic speaking-order mapping**

Store each distinct accepted label with its first provider-audio timestamp. Process normalized `SpeakerObserved` events, not completion order, so overlapping turns that complete in reverse cannot reverse learner identity. In learner-plus-fluent mode the earliest accepted label maps to `LEARNER_1` and the second to `FLUENT_PARTNER`; in two-learner mode they map to `LEARNER_1` and `LEARNER_2`. Assert normalized speaker observations arrive in nondecreasing provider-audio order and surface a provider-contract error rather than silently remapping if that invariant is violated. Return `None` without mutating state when `overlaps_playback` is true or when the mode already has all allowed human labels. Swapping reverses only the two learner values and emits no new provider identity.

- [ ] **Step 6: Implement the transcript store**

`start` creates or timestamps the exact turn without affecting any other active turn. `apply_partial` accepts a partial only when the turn is not final and the revision is greater than the stored revision. `finalize` replaces the partial with final text regardless of partial revision, attaches the label to that exact `turn_id`, and is idempotent for an identical duplicate completion. `context_before` returns at most the prior two finalized turns ordered by start time, not provider completion order. Add `clear()` and ensure no method logs text.

- [ ] **Step 7: Verify domain invariants**

```bash
cd apps/backend
uv run pytest tests/unit/test_speaker_mapping.py tests/unit/test_transcript_store.py -v
uv run ruff check src tests
uv run mypy src
```

Expected: all mapping and transcript tests pass with no type or lint errors.

- [ ] **Step 8: Commit the conversation primitives**

```bash
git add apps/backend/src/language_coach/domain apps/backend/tests/unit/test_speaker_mapping.py apps/backend/tests/unit/test_transcript_store.py
git commit -m "feat: add speaker and transcript domain model"
```

## Task 6: Define Intervention Lifecycle and Playback Safety

**Files:**
- Create: `apps/backend/src/language_coach/domain/interventions.py`
- Create: `apps/backend/src/language_coach/domain/playback_gate.py`
- Create: `apps/backend/tests/unit/test_interventions.py`
- Create: `apps/backend/tests/unit/test_playback_gate.py`

**Interfaces:**
- Produces: `InterventionStore.note_revision(turn_id, revision)`, `preview(turn_id, revision, source_text, target_text, transcript_snapshot)`, `commit(turn_id, candidate)`, `cancel(turn_id, reason)`, `mark_audio_ready(intervention_id, asset_id)`, and `mark_audio_failed(intervention_id, retry_available)`
- Produces: `PlaybackGate.on_speech_started(turn_id, at_ms, confirmed_human)`, `on_speech_completed(turn_id, at_ms)`, `on_audio_ready(intervention_id)`, `reserve_eligible(at_ms)`, `on_playback_started(intervention_id, at_ms, manual)`, `on_playback_ended(intervention_id, at_ms)`, `on_playback_interrupted(intervention_id, at_ms)`, `on_start_timeout(intervention_id)`, and `can_manual_replay(intervention_id)`
- Guarantees: previews are revision-scoped; only final results can commit; queued audio waits for 600 ms of quiet; interrupted audio is never automatically replayed

- [ ] **Step 1: Write failing intervention lifecycle tests**

Test one stable card identity per source fragment, obsolete partial rejection, preview revision, preview removal when the final result is empty, final commit replacement, source-containment validation, and audio-failure state:

```python
from language_coach.domain.interventions import InterventionStore


def test_obsolete_preview_result_is_discarded() -> None:
    store = InterventionStore()
    store.note_revision("turn-a", 3)
    result = store.preview(
        turn_id="turn-a",
        revision=2,
        source_text="grocery store",
        target_text="supermercado",
        transcript_snapshot="Necesito grocery store",
    )
    assert result is None


def test_source_must_exist_in_snapshot_after_normalization() -> None:
    store = InterventionStore()
    store.note_revision("turn-a", 1)
    result = store.preview(
        turn_id="turn-a",
        revision=1,
        source_text="train station",
        target_text="estacion de tren",
        transcript_snapshot="Necesito grocery store",
    )
    assert result is None
```

Normalize Unicode and whitespace for containment but preserve the provider text displayed to the user. Do not accept fuzzy semantic matches in the MVP.

- [ ] **Step 2: Write failing playback-gate tests with a fake clock**

Use integer monotonic milliseconds rather than sleeps:

```python
from language_coach.domain.playback_gate import PlaybackGate


def test_audio_becomes_eligible_after_600_ms_of_quiet() -> None:
    gate = PlaybackGate(quiet_grace_ms=600)
    gate.on_speech_completed("turn-a", at_ms=1_000)
    gate.on_audio_ready("intervention-a")
    assert gate.reserve_eligible(at_ms=1_599) is None
    assert gate.reserve_eligible(at_ms=1_600) == "intervention-a"
    assert gate.reserve_eligible(at_ms=1_600) is None


def test_new_speech_defers_queued_audio() -> None:
    gate = PlaybackGate(quiet_grace_ms=600)
    gate.on_speech_completed("turn-a", at_ms=1_000)
    gate.on_audio_ready("intervention-a")
    gate.on_speech_started("turn-b", at_ms=1_500, confirmed_human=True)
    assert gate.reserve_eligible(at_ms=2_500) is None
    gate.on_speech_completed("turn-b", at_ms=2_600)
    assert gate.reserve_eligible(at_ms=3_200) == "intervention-a"


def test_barge_in_marks_clip_manual_only() -> None:
    gate = PlaybackGate(quiet_grace_ms=600)
    gate.on_speech_completed("turn-a", at_ms=1_000)
    gate.on_audio_ready("intervention-a")
    assert gate.reserve_eligible(at_ms=1_600) == "intervention-a"
    gate.on_playback_started("intervention-a", at_ms=2_000, manual=False)
    interrupted = gate.on_speech_started("turn-b", at_ms=2_050, confirmed_human=True)
    assert interrupted == "intervention-a"
    assert gate.reserve_eligible(at_ms=5_000) is None
    assert gate.can_manual_replay("intervention-a")
```

- [ ] **Step 3: Run the focused tests to verify failure**

```bash
cd apps/backend
uv run pytest tests/unit/test_interventions.py tests/unit/test_playback_gate.py -v
```

Expected: FAIL because the lifecycle and gate do not exist.

- [ ] **Step 4: Implement revision-safe intervention records**

Use an `InterventionRecord` with UUID, turn ID, source revision, source/target text, `preview | committed | audio_ready | audio_failed | interrupted | cancelled` state, an `automatic_playback_allowed` boolean, and `audio_retry_remaining` initialized to one on commit. `note_revision` records the latest partial revision even before a card exists. Keep the same ID when a final result confirms the same normalized source fragment; cancel the preview and create a replacement ID when the final source fragment changes. A final empty analysis cancels every preview for that turn. `mark_audio_failed` exposes retry only while that counter remains; handling `intervention.audio_retry` consumes it before calling ElevenLabs so concurrent controls cannot trigger two retries.

- [ ] **Step 5: Implement the pure playback state machine**

Track the set of active human turns, `last_human_activity_ms`, one currently playing intervention, one start-request reservation, and a FIFO of ready intervention IDs. `reserve_eligible` removes and returns only the queue head, only when no human turn is active, no clip/reservation exists, and the grace time has elapsed; repeated polling cannot emit duplicate start requests. A two-second acknowledgement watchdog calls `on_start_timeout`, clears the reservation, and leaves the card manual-replay-only. Confirmed human speech while a start request is reserved cancels that request but requeues the clip for the next safe pause because playback had not begun; confirmed speech after `playback.started` marks it interrupted and manual-only. Outside playback, speech starts are human. During playback, the coordinator passes `confirmed_human=False` until its echo guard sees a known human label or transcript divergence from the generated target; only `confirmed_human=True` requests client cancellation. `can_manual_replay` remains true for an interrupted or completed clip with a retained asset; a client `playback.started` control with `manual=true` records the user-initiated replay directly rather than re-entering the automatic queue.

- [ ] **Step 6: Verify exact timing and cleanup behavior**

```bash
cd apps/backend
uv run pytest tests/unit/test_interventions.py tests/unit/test_playback_gate.py -v
uv run pytest tests/unit -v
```

Expected: all domain tests pass without wall-clock sleeps.

- [ ] **Step 7: Commit intervention timing**

```bash
git add apps/backend/src/language_coach/domain/interventions.py apps/backend/src/language_coach/domain/playback_gate.py apps/backend/tests/unit/test_interventions.py apps/backend/tests/unit/test_playback_gate.py
git commit -m "feat: add intervention and playback state machines"
```

## Task 7: Adapt Muse Voice Transcribe Without Leaking Provider Semantics

**Files:**
- Create: `apps/backend/src/language_coach/providers/interfaces.py`
- Create: `apps/backend/src/language_coach/providers/muse_transcribe.py`
- Create: `apps/backend/tests/fixtures/muse/partial.json`
- Create: `apps/backend/tests/fixtures/muse/revised-partial.json`
- Create: `apps/backend/tests/fixtures/muse/overlapping-turns.jsonl`
- Create: `apps/backend/tests/fixtures/muse/error.json`
- Create: `apps/backend/tests/contract/test_muse_transcribe.py`

**Interfaces:**
- Produces: `Transcriber.open(config: TranscriptionConfig) -> TranscriptionSession`
- Produces: `TranscriptionSession.send_pcm(frame: bytes)`, `events()`, and `close()`
- Produces: `MuseEventNormalizer.feed(payload: dict) -> list[TranscriptionEvent]`
- Guarantees: provider closure is surfaced as a failure; partials are revisioned per turn; unknown future event types are ignored safely

- [ ] **Step 1: Capture provider contract fixtures and write failing tests**

Use these exact redacted fixtures so the adapter work is executable without a live connection:

| Fixture | Exact representative contents | Expected normalized result |
|---|---|---|
| `partial.json` | A JSON array containing `{"type":"speechStart","turnId":1,"audioProcessedMs":1200}` then `{"type":"transcript","transcript":"how is the","final":false,"audioProcessedMs":2400}` | `SpeechStarted(turn_id=1, audio_processed_ms=1200)` then `PartialTranscript(turn_id=1, revision=1, text="how is the", audio_processed_ms=2400)` |
| `revised-partial.json` | `{"type":"transcript","transcript":"how is the weather","final":false,"audioProcessedMs":3200}` | Replacement `PartialTranscript(turn_id=1, revision=2, text="how is the weather", audio_processed_ms=3200)`, never an append |
| `overlapping-turns.jsonl` | One object per line, in this order: start turn 1 at `1000`; partial `I need` at `1200`; speaker `A` at `1280`; start turn 2 at `1400`; partial `Claro` at `1600`; speaker `B` at `1680`; end and complete turn 2 at `1800`; end and complete turn 1 at `2000` | Two active turn records; labels `A -> turn 1` and `B -> turn 2`; `SpeechCompleted` arrives for turn 2 before turn 1 without moving either label/text to the other turn |
| `error.json` | `{"type":"error","message":"human-readable message","sessionId":"fixture-session"}` | A typed fatal provider error whose safe application form contains no raw message |

Write `overlapping-turns.jsonl` exactly as newline-delimited objects:

```jsonl
{"type":"speechStart","turnId":1,"audioProcessedMs":1000}
{"type":"transcript","transcript":"I need","final":false,"audioProcessedMs":1200}
{"type":"speaker","label":"A","audioProcessedMs":1280}
{"type":"speechStart","turnId":2,"audioProcessedMs":1400}
{"type":"transcript","transcript":"Claro","final":false,"audioProcessedMs":1600}
{"type":"speaker","label":"B","audioProcessedMs":1680}
{"type":"speechEnd","turnId":2,"audioProcessedMs":1800}
{"type":"speechComplete","turnId":2,"transcript":"Claro.","audioProcessedMs":1800}
{"type":"speechEnd","turnId":1,"audioProcessedMs":2000}
{"type":"speechComplete","turnId":1,"transcript":"I need the grocery store.","audioProcessedMs":2000}
```

The adapter test also constructs and snapshots this exact handshake object, substituting only the fake key: `authorization.accessToken="Bearer test-key"`, `audioEncoding="PCM_24KHZ"`, `model="muse-voice-transcribe-1.0"`, `mode="DIARIZATION"`, `partialMode="CUMULATIVE"`, `emitAudioProgress=true`, and `languageBias=["English", "Spanish"]`.

The contract tests must assert:

- the authorization object contains `Bearer <key>` only in the outbound handshake;
- the configured encoding is `PCM_24KHZ`, mode is `DIARIZATION`, and partial mode is `CUMULATIVE`;
- language bias contains unique `muse_bias_name` values for the configured native and learning languages;
- provider partials, which carry no `turnId`, attach to the turn opened by the most recent still-open `speechStart` and increment that turn's internal revision;
- `speechComplete` is the authoritative text for its `turnId`;
- each provider `speaker` event, which also carries no `turnId`, attaches by its ordered audio span to the most recently opened active turn that does not yet have its one allowed speaker event;
- two active turns can complete in reverse order without swapping labels, revisions, or text;
- `speechStart`, `speechEnd`, `speaker`, `error`, and unknown messages normalize correctly;
- `audioProgress` updates only the adapter's latest processed-millisecond counter and never opens, revises, maps, or completes a turn;
- sending anything other than 3,840-byte frames raises `InvalidPcmFrame` before network I/O.
- graceful close sends `endStream` and drains a normal `1000` close, while a fake provider that never responds hits the injected zero-second close deadline, force-closes the transport, terminates the event iterator, and returns without leaking a receiver task.

Use a fake WebSocket transport; contract tests must not call Meta.

- [ ] **Step 2: Run the contract tests to verify they fail**

```bash
cd apps/backend
uv run pytest tests/contract/test_muse_transcribe.py -v
```

Expected: FAIL because the provider port and adapter do not exist.

- [ ] **Step 3: Define provider ports**

Use `typing.Protocol` so coordinator tests can inject fakes:

```python
from collections.abc import AsyncIterator
from typing import Protocol

from language_coach.domain.models import TranscriptionEvent


class TranscriptionSession(Protocol):
    async def send_pcm(self, frame: bytes) -> None:
        raise NotImplementedError

    def events(self) -> AsyncIterator[TranscriptionEvent]:
        raise NotImplementedError

    async def close(self) -> None:
        raise NotImplementedError


class Transcriber(Protocol):
    async def open(self, config: TranscriptionConfig) -> TranscriptionSession:
        raise NotImplementedError
```

Add `SparkAnalyzer` and `SpeechSynthesizer` ports with the request/result types used in Tasks 8 and 9 so the coordinator never imports a concrete provider. Define the `TranscriptionConfig` dataclass beside these ports with application session ID, Muse bias names, model, encoding, mode, and partial mode.

- [ ] **Step 4: Implement the Muse handshake and frame guard**

Connect to:

```text
wss://api.meta.ai/v1/asr/realtime?sessionId=<application-session-uuid>
```

Send this first message with values supplied by backend settings:

```python
handshake = {
    "authorization": {"accessToken": f"Bearer {api_key}"},
    "audioEncoding": "PCM_24KHZ",
    "model": "muse-voice-transcribe-1.0",
    "mode": "DIARIZATION",
    "partialMode": "CUMULATIVE",
    "emitAudioProgress": True,
    "languageBias": muse_bias_names,
}
```

Use a 10-second connect/handshake timeout and wait for the acknowledgement containing `sessionId` before sending audio. Configure the underlying WebSocket with a one-second transport `close_timeout`. Validate each binary frame length before `send`, pace frames as they arrive rather than bursting buffered audio, and continue sending live silence supplied by the microphone stream. Ensure the API key, payload text, and audio bytes are excluded from exception strings and application logs.

- [ ] **Step 5: Implement correlation that is safe for overlap**

Keep state keyed by provider `turnId`: open/final flags, partial revision count, current text, provider-audio start/end milliseconds, and speaker label. Maintain an ordered collection of open turns solely to apply Meta's documented rule that a `transcript` without a turn ID belongs to the most recent `speechStart`; replace that turn's cumulative text and never append it. Associate the single `speaker` event for a turn with the latest still-open audio span lacking a label, using `audioProcessedMs` to reject an event outside that span. Remove only the specific ID named by `speechEnd`, and treat it as a boundary rather than text. Normalize `speechComplete` into one `SpeechCompleted` for its exact key even when another turn is open; ignore partials after finalization. Consume `audioProgress` by updating a session-level latest-processed counter only; it must not produce a domain speech event or change any turn.

Carry provider `audioProcessedMs` into normalized speech events so the coordinator can compare turns with the PCM-stream playback windows rather than mixing provider time with server wall-clock time. Make adapter `close()` idempotent and bounded: inside a default three-second `asyncio.timeout`, send `{"type":"endStream"}`, send no more audio, drain pending results, and wait for close code `1000`. If that deadline expires, cancel and await the receiver, force-abort the underlying transport after its one-second close timeout, terminate the event iterator, and return; cleanup must finish even when Meta or the network stalls. Inject `graceful_close_timeout_s` so the never-closes contract test uses zero rather than sleeping. On provider `error` or any other unexpected close while the session is active, emit one `TranscriptionFailure` requiring a fresh application session and close the iterator once; a forced close during already-requested application shutdown is cleanup metadata, not a second failure event.

- [ ] **Step 6: Verify the adapter against every fixture**

```bash
cd apps/backend
uv run pytest tests/contract/test_muse_transcribe.py -v
uv run ruff check src tests
uv run mypy src
```

Expected: all contract fixtures pass and no network call occurs.

- [ ] **Step 7: Commit the transcription boundary**

```bash
git add apps/backend/src/language_coach/providers apps/backend/tests/fixtures/muse apps/backend/tests/contract/test_muse_transcribe.py
git commit -m "feat: add Muse transcription adapter"
```

## Task 8: Add Structured Muse Spark Intervention Analysis

**Files:**
- Create: `apps/backend/src/language_coach/providers/muse_spark.py`
- Create: `apps/backend/tests/fixtures/spark/positive.json`
- Create: `apps/backend/tests/fixtures/spark/empty.json`
- Create: `apps/backend/tests/fixtures/spark/malformed.json`
- Create: `apps/backend/tests/contract/test_muse_spark.py`
- Modify: `apps/backend/src/language_coach/providers/interfaces.py`

**Interfaces:**
- Produces: `InterventionAnalysis` and `InterventionCandidate`
- Produces: `MuseSparkAnalyzer.analyze(request: AnalysisRequest) -> InterventionAnalysis`
- Guarantees: an empty array means no help; output must match the strict schema; final analyses retry one transient failure and speculative analyses do not retry

- [ ] **Step 1: Write failing structured-output tests**

Use an injected fake OpenAI-compatible client and assert:

```python
import pytest

from language_coach.providers.muse_spark import AnalysisRequest, MuseSparkAnalyzer


@pytest.mark.asyncio
async def test_positive_result_returns_only_native_fragment(fake_spark_client) -> None:
    analyzer = MuseSparkAnalyzer(fake_spark_client)
    result = await analyzer.analyze(
        AnalysisRequest(
            participant="learner_1",
            native_language="English",
            learning_language="Spanish",
            transcript="Necesito ir al grocery store",
            context=(),
            final=True,
        )
    )
    assert result.interventions[0].source_text == "grocery store"
    assert result.interventions[0].target_text == "supermercado"
```

Also test empty output, malformed output, source text absent from the snapshot, one retry for 429/500/503 on final input, no retry for authentication/invalid-request failures, and no retry for a speculative partial.

- [ ] **Step 2: Run the contract tests to verify they fail**

```bash
cd apps/backend
uv run pytest tests/contract/test_muse_spark.py -v
```

Expected: FAIL because the analyzer does not exist.

- [ ] **Step 3: Define the strict response schema**

```python
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, field_validator


@dataclass(frozen=True)
class AnalysisRequest:
    participant: str
    native_language: str
    learning_language: str
    transcript: str
    context: tuple[str, ...]
    final: bool


class InterventionCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_text: str = Field(min_length=1, max_length=160)
    source_language: str = Field(min_length=1, max_length=80)
    target_text: str = Field(min_length=1, max_length=240)
    target_language: str = Field(min_length=1, max_length=80)

    @field_validator("source_text", "source_language", "target_text", "target_language")
    @classmethod
    def reject_whitespace_only(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("field cannot be blank")
        return stripped


class InterventionAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    interventions: list[InterventionCandidate] = Field(max_length=3)
```

After parsing, require `completion.choices[0].message.parsed` to be a non-null `InterventionAnalysis`. In the analyzer, compare every candidate's source/target language names to the current `AnalysisRequest` and reject the complete response if either differs. Then apply exact normalized source containment against `request.transcript`; the Pydantic constraints already reject blank fields, oversized fragments, extra fields, and more than three interventions.

- [ ] **Step 4: Implement the narrow analysis prompt**

Initialize `AsyncOpenAI(api_key=settings.model_api_key, base_url="https://api.meta.ai/v1", max_retries=0)` so only the application's explicit retry policy applies. Call `client.beta.chat.completions.parse` with model `muse-spark-1.3` and `response_format=InterventionAnalysis`. The system instruction must state all of these rules:

1. Return only exact, short spans that the active learner spoke in the configured native language because they lacked the learning-language wording; a short standalone native-language fallback is eligible even when it is the whole turn.
2. Do not translate the complete mixed-language turn, a long native-language monologue, or ordinary learning-language grammar.
3. Return an empty list when the turn stays in the learning language or evidence is uncertain.
4. Preserve the exact source substring and translate each span into the configured learning language.
5. Treat surrounding turns as context only, never as text to extract.

Send participant identity, language names, current transcript, and at most two prior finalized turns in a separate user message. Do not send the full session transcript.

- [ ] **Step 5: Add validation and bounded retries**

Validate exact source containment after Unicode and whitespace normalization before returning candidates. Give a speculative call 900 ms with no retry. Give each final attempt 1.2 seconds and retry once after 100 ms for timeout, 429, 500, or 503 only. Convert an invalid response or exhausted retry into a typed `AnalysisUnavailable`; do not surface provider prose or transcript text in logs.

- [ ] **Step 6: Verify Spark behavior**

```bash
cd apps/backend
uv run pytest tests/contract/test_muse_spark.py -v
uv run ruff check src tests
uv run mypy src
```

Expected: all response, validation, and retry tests pass without a network call.

- [ ] **Step 7: Commit structured analysis**

```bash
git add apps/backend/src/language_coach/providers apps/backend/tests/fixtures/spark apps/backend/tests/contract/test_muse_spark.py
git commit -m "feat: add Muse Spark intervention analysis"
```

## Task 9: Route ElevenLabs Speech and Keep Replay Audio in Memory

**Files:**
- Create: `apps/backend/src/language_coach/providers/elevenlabs.py`
- Create: `apps/backend/src/language_coach/services/audio_assets.py`
- Create: `apps/backend/tests/contract/test_elevenlabs.py`
- Create: `apps/backend/tests/unit/test_audio_assets.py`
- Modify: `apps/backend/src/language_coach/providers/interfaces.py`

**Interfaces:**
- Produces: `ElevenLabsSynthesizer.synthesize(request: SpeechRequest) -> AudioAsset`
- Produces: `InMemoryAudioStore.put(session_id, audio) -> asset_id`, `get(session_id, asset_id)`, and `clear_session(session_id)`
- Guarantees: `mp3_44100_128` output; Flash/T2D routing follows backend capabilities; audio bytes never touch disk

- [ ] **Step 1: Write failing route and memory-store tests**

Use a fake ElevenLabs SDK client and assert that Spanish invokes `text_to_speech.convert` with `eleven_flash_v2_5`, Bengali invokes `text_to_dialogue.convert` with `eleven_v3_conversational`, both request `mp3_44100_128`, and returned chunks are concatenated in memory. Test provider error normalization and reject a target language that is absent from `CAPABILITIES`.

Create memory-store tests that prove asset IDs are high-entropy and unguessable, one session cannot fetch another session's asset, `clear_session` removes every asset, and `size_bytes` returns to zero after cleanup.

- [ ] **Step 2: Run focused tests to verify they fail**

```bash
cd apps/backend
uv run pytest tests/contract/test_elevenlabs.py tests/unit/test_audio_assets.py -v
```

Expected: FAIL because the synthesizer and store do not exist.

- [ ] **Step 3: Implement the two explicit ElevenLabs paths**

Keep the synchronous official client behind `asyncio.to_thread` so FastAPI's event loop is never blocked:

```python
def render() -> bytes:
    capability = get_capability(request.target_language_code)
    route = capability.tts_route
    if route.kind == "flash":
        chunks = client.text_to_speech.convert(
            voice_id=voice_id,
            text=request.target_text,
            model_id=route.model_id,
            output_format=route.output_format,
            language_code=capability.eleven_language_code,
        )
    else:
        chunks = client.text_to_dialogue.convert(
            inputs=[{"text": request.target_text, "voice_id": voice_id}],
            model_id=route.model_id,
            output_format=route.output_format,
            language_code=capability.eleven_language_code,
        )
    return b"".join(chunks)
```

Configure the ElevenLabs SDK transport itself with a five-second request timeout and automatic retries disabled before calling it through `asyncio.to_thread`; a coroutine timeout alone cannot cancel a running worker thread. Return `AudioAsset(content_type="audio/mpeg", data=rendered_bytes)`. Map authentication, quota, rate-limit, timeout, and unsupported-language errors to typed exceptions without including text or credentials.

- [ ] **Step 4: Implement the session-scoped memory store**

Use nested dictionaries keyed by session UUID and `secrets.token_urlsafe(24)` asset IDs. Store immutable bytes plus MIME type and intervention ID. `get` takes both session and asset identifiers and raises the same not-found error for a missing session, missing asset, or ownership mismatch. `clear_session` drops all application references and removes the session dictionary; it does not claim process-memory zeroization and never writes a cache file.

- [ ] **Step 5: Verify routing, isolation, and cleanup**

```bash
cd apps/backend
uv run pytest tests/contract/test_elevenlabs.py tests/unit/test_audio_assets.py -v
uv run pytest tests/unit tests/contract -v
uv run ruff check src tests
uv run mypy src
```

Expected: all provider fakes and isolation tests pass.

- [ ] **Step 6: Commit speech generation**

```bash
git add apps/backend/src/language_coach/providers apps/backend/src/language_coach/services/audio_assets.py apps/backend/tests/contract/test_elevenlabs.py apps/backend/tests/unit/test_audio_assets.py
git commit -m "feat: add routed ElevenLabs speech generation"
```

## Task 10: Orchestrate One Conversation with Deterministic Fakes

**Files:**
- Create: `apps/backend/src/language_coach/domain/session_coordinator.py`
- Create: `apps/backend/src/language_coach/services/safe_logging.py`
- Create: `apps/backend/tests/fakes/clock.py`
- Create: `apps/backend/tests/fakes/providers.py`
- Create: `apps/backend/tests/unit/test_session_coordinator.py`
- Modify: `apps/backend/src/language_coach/domain/models.py`
- Modify: `apps/backend/src/language_coach/providers/interfaces.py`

**Interfaces:**
- Produces: long-lived `ConversationCoordinator.run()`, plus `wait_started()`, `accept_pcm(frame)`, `handle_control(message)`, `handle_connection_lost()`, `close(reason)`, and `wait_closed()`
- Consumes: a session-scoped `SequencedEventSink.emit(event_payload) -> ServerEvent` shared with the registry for WebSocket delivery and replay
- Produces: `Clock.now_ms()` and `Clock.sleep_ms()` injection points
- Guarantees: only eligible learners are analyzed; only final analyses are spoken; failures degrade the smallest possible subsystem

- [ ] **Step 1: Build controllable provider fakes and a manual clock**

Create fakes that record calls and expose queues for normalized transcription events, Spark results, and audio results. `ManualClock.advance(ms)` must resolve pending `sleep_ms` calls deterministically, so no coordinator test uses `asyncio.sleep` or a wall-clock delay. The fake transcriber must reject audio after close and expose its configured language bias for assertions.

- [ ] **Step 2: Write failing happy-path and no-op tests**

Create tests for these exact flows:

1. A target-language-only Learner 1 turn results in no intervention and no ElevenLabs call.
2. A fluent-partner turn in default mode is never sent to Spark.
3. An English insertion in an otherwise Spanish Learner 1 turn emits preview, commit, audio-ready, then playback eligibility after 600 ms.
4. Two-learner mode analyzes speaker A against Learner 1's native language and speaker B against Learner 2's native language.
5. `speakers.swap` reverses the native-language association used by the next analysis and emits two updated `speaker.mapped` events with the same provider labels and reversed learner IDs.

Assert the visible help flow without using transcript events:

```python
help_event_types = [
    event.type
    for event in sink.events
    if event.type not in {"session.status", "session.ready"}
]
assert help_event_types == [
    "speaker.mapped",
    "intervention.preview",
    "intervention.committed",
    "intervention.audio_ready",
    "playback.start_requested",
]
assert all(event.type != "transcript" for event in sink.events)
```

- [ ] **Step 3: Write failing race, feedback, and failure tests**

Add these cases before implementation:

- partial revision 2 returns after revision 3 and cannot update a card;
- a final empty result cancels the partial preview;
- two overlapping turns finish in reverse order and retain their own speaker/native-language inputs;
- their `SpeakerObserved` events map participants by provider-audio speaking order before either completion, so reverse completion cannot swap Learner 1 and the partner;
- new human speech before 600 ms leaves audio queued;
- new human speech after playback begins emits `playback.stop_requested`, marks the card replayable, and does not automatically replay it;
- a Muse label first observed during the reported playback window never enters `SpeakerMapping`;
- a playback-overlap partial matching the normalized generated target is classified as echo and does not stop its own clip;
- a playback-overlap partial that diverges from the generated target, or a speaker event carrying an already-mapped human label, confirms barge-in and stops the clip;
- a turn whose normalized text equals currently generated target speech is excluded from Spark;
- a Spark timeout retries a final turn once and then omits only that intervention;
- an ElevenLabs failure preserves the committed card, emits `intervention.audio_failed`, and permits one `intervention.audio_retry` control;
- a Muse open/handshake failure resolves `wait_started()` with typed `MuseStartFailed`, emits unrecoverable `session.degraded` followed by `session.ended(reason="muse_failure")`, and clears the half-started provider;
- a Muse failure emits degraded state, stops accepting audio, and requires a fresh session;
- a warning is emitted at 49 minutes and the session ends at 50 minutes;
- `close` clears transcript, mapping, interventions, audio assets, tasks, and provider connections exactly once.

- [ ] **Step 4: Run the coordinator tests to verify they fail**

```bash
cd apps/backend
uv run pytest tests/unit/test_session_coordinator.py -v
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 5: Implement one-owner session orchestration**

Define the canonical sink port and construct the coordinator with all dependencies rather than reading globals:

```python
class SequencedEventSink(Protocol):
    async def emit(self, payload: ServerEventPayload) -> ServerEvent:
        raise NotImplementedError


class ConversationCoordinator:
    def __init__(
        self,
        session_id: UUID,
        config: SessionConfig,
        transcriber: Transcriber,
        analyzer: SparkAnalyzer,
        synthesizer: SpeechSynthesizer,
        audio_store: InMemoryAudioStore,
        event_sink: SequencedEventSink,
        clock: Clock,
    ) -> None:
        self.session_id = session_id
        self.config = config
        self.transcriber = transcriber
        self.analyzer = analyzer
        self.synthesizer = synthesizer
        self.audio_store = audio_store
        self.event_sink = event_sink
        self.clock = clock
```

`run` is the long-lived owner coroutine started only after the authorized client sends `audio.start`; creating the application session itself must not open Muse while the user is still deciding on microphone permission. `run` opens exactly one Muse session with a bounded handshake timeout, then resolves a one-shot startup future consumed by `wait_started()` and enters one `asyncio.TaskGroup` containing the provider-event consumer, playback eligibility loop, and 50-minute lifetime loop. If open/handshake fails or times out, `run` closes any partial transport, resolves that same future with typed `MuseStartFailed`, emits `session.degraded(subsystem="transcription", code="muse_start_failed", recoverable=false, restart_required=true)` followed by `session.ended(reason="muse_failure")`, signals `wait_closed()`, and returns; no exit path may leave `wait_started()` pending. `SessionRegistry.start_audio` owns `asyncio.create_task(coordinator.run())`; it never awaits `run` inline and rejects a second start. When `close(reason)` is called, it atomically records the first reason and sets a stop event. The `run` coroutine observes that event, cancels and awaits its three child task handles inside the TaskGroup, then closes the provider, clears every in-memory store, emits one `session.ended`, signals `wait_closed`, and returns. A child wrapper converts its failure into the appropriate stop reason so TaskGroup cancellation cannot escape as an unobserved exception. `close` and `wait_closed` are safe when called more than once; `accept_pcm` forwards only between started and stopping states.

The coordinator never assigns wire sequence numbers itself. Its injected `SequencedEventSink` stamps protocol version, session ID, and the next sequence, then publishes the complete `ServerEvent`. Coordinator fakes use the same rule; Task 11 makes the registry own the real sink so gateway-generated `session.ready` and replayed coordinator events share one sequence space.

- [ ] **Step 6: Implement partial and final analysis scheduling**

On `SpeakerObserved`, use the correlated turn's provider-audio start time to map the label in speaking order unless that span overlaps generated playback, then emit `speaker.mapped` if a new participant was accepted. If that turn already has a current partial, start its debounce at this point. For each later partial, store the new revision, cancel that turn's prior 300 ms debounce task, and schedule one speculative analysis only when its speaker is already a mapped learner; capture `(turn_id, revision, transcript_snapshot)` and compare both ID and revision when the result returns. On `SpeechCompleted`, cancel speculative work for that turn, finalize the transcript, look up the existing mapping, and run authoritative analysis only for a mapped learner. A final result confirms, revises, or cancels the preview before TTS begins. If it contains multiple candidates, preserve Spark's source order, commit and synthesize them sequentially, and enqueue their audio in that same order.

- [ ] **Step 7: Implement playback feedback protection**

Maintain an input-audio clock by adding `frame_bytes / 48` milliseconds for every accepted 24 kHz int16 mono frame. When client `playback.started` and `playback.ended` controls arrive, record the current input-audio offset and normalized target text being played. Compare those windows with Muse `audioProcessedMs`; do not compare provider audio time with server wall-clock time. A provider turn overlapping the window may update an already-known label's transcript but must not create or change a mapping or reach Spark.

Treat a `speechStart` inside playback as possible echo, not immediate human barge-in. Confirm human speech as soon as either its speaker event has an already-mapped human label or its cumulative partial stops being a normalized prefix match of the generated target; then emit `playback.stop_requested`. A partial/final consisting only of generated target text remains echo and cannot stop, map, or intervene. This guard complements platform echo cancellation while preserving real barge-in; wait for `playback.interrupted` or `playback.ended` before clearing the speaking activity flag.

- [ ] **Step 8: Scope errors and sanitize logs**

Create metadata-only logging helpers whose permitted fields are `event_type`, `session_id`, `turn_id`, `intervention_id`, duration, status code, provider request ID, and exception class. Add a test logging filter that fails if a known test transcript, audio sentinel, model key, ElevenLabs key, pairing token, or resume token appears in any captured structured/access record. The intentional one-time operator pairing banner is tested separately and bypasses these loggers. Spark and TTS failures keep Muse listening; a Muse failure ends audio acceptance and marks the session unrecoverable.

- [ ] **Step 9: Verify the complete pure orchestration layer**

```bash
cd apps/backend
uv run pytest tests/unit/test_session_coordinator.py -v
uv run pytest tests/unit -v
uv run ruff check src tests
uv run mypy src
```

Expected: all coordinator scenarios pass deterministically with no real network or sleeps.

- [ ] **Step 10: Commit conversation orchestration**

```bash
git add apps/backend/src/language_coach/domain apps/backend/src/language_coach/services/safe_logging.py apps/backend/src/language_coach/providers/interfaces.py apps/backend/tests/fakes apps/backend/tests/unit/test_session_coordinator.py
git commit -m "feat: orchestrate conversation interventions"
```

## Task 11: Expose Authorized Sessions, Resume, and Temporary Audio

**Files:**
- Create: `apps/backend/src/language_coach/composition.py`
- Create: `apps/backend/src/language_coach/services/session_registry.py`
- Create: `apps/backend/src/language_coach/api/websocket.py`
- Create: `apps/backend/tests/unit/test_session_registry.py`
- Create: `apps/backend/tests/integration/test_session_websocket.py`
- Create: `apps/backend/tests/integration/test_audio_endpoint.py`
- Modify: `apps/backend/src/language_coach/api/http.py`
- Modify: `apps/backend/src/language_coach/main.py`
- Modify: `apps/backend/src/language_coach/protocol/models.py`

**Interfaces:**
- Produces: `WS /v1/session`
- Produces: `GET /v1/sessions/{session_id}/audio/{asset_id}` with `Cache-Control: no-store`
- Produces: `SessionRegistry.create(config, attachment_id)`, `start_audio(session_id, attachment_id)`, `disconnect(session_id, attachment_id)`, `resume(session_id, attachment_id, resume_token, last_sequence)`, and `close(session_id, reason)`
- Guarantees: invalid pairing never starts providers; resume reuses the same coordinator/mapping; expiry after 15 seconds closes and clears the session

- [ ] **Step 1: Write failing session-registry tests**

Test with a manual clock:

- creation produces an application session UUID, a high-entropy resume token, and sequence zero;
- emitted events are retained in sequence order;
- disconnect leaves the coordinator alive for exactly 15 seconds;
- while detached, an 80 ms zeroed PCM frame is paced to Muse every 80 ms so the provider does not close for idle input, and the filler stops before resumed client audio is accepted;
- a valid resume token and `last_sequence=k` replay buffered `k+1..n` in ascending order, then emit resumed `session.ready` as `n+1`; the ready event never precedes missed events or evicts one before ring validation;
- an invalid resume token or invalid sequence leaves the original expiry and silence-filler tasks armed, so the valid client can still resume or the provider is cleaned up at the original deadline;
- an event emitted while replay is in progress is delivered once after the replay snapshot and before resumed live delivery, never lost or duplicated;
- a replay socket that blocks/fails delivery releases both locks and restores filler/expiry only for the original deadline's remaining time;
- an old socket's delayed `disconnect(session_id, old_attachment_id)` after successful resume is a no-op and cannot detach or expire the new attachment;
- an invalid token uses constant-time verification and exposes no distinction between missing and mismatched sessions;
- a resume after expiry fails and the provider has been closed;
- a Muse failure during the detach grace closes the entry and makes resume unavailable rather than constructing a replacement transcriber;
- resume never creates another coordinator or resets speaker mapping;
- a replay request older than the bounded event buffer returns `resume_unavailable` rather than a partial history;
- cleanup removes all audio assets and buffered events.
- disconnect during generated playback marks that playback interrupted without automatic replay, appends `playback.stop_requested(reason="connection_lost")` for replay, and retains its committed card/audio event for manual replay after resume.

Use a 512-event per-session replay ring; this buffer is only for transient reconnect, not product history.

- [ ] **Step 2: Write failing WebSocket and audio integration tests**

With `TestClient` and injected provider fakes, assert:

1. The first WebSocket text frame must be `session.start` or `session.resume` within five seconds.
2. A wrong pairing token closes with application code `4401` and opens no provider.
3. Text controls before `session.ready` and binary audio before the post-`audio.start` active/listening acknowledgement close with `4400`.
4. A valid `session.start` emits `session.ready` plus idle/empty-activities status but opens no Muse connection; the first `audio.start` emits connecting, opens exactly one provider, and only then emits active/listening status.
5. A Muse open/handshake failure after `audio.start` emits `session.degraded(code="muse_start_failed", restart_required=true)` and `session.ended(reason="muse_failure")`, returns control without hanging, and leaves no runner/provider task.
6. A syntactically valid start containing a code absent from backend capabilities is rejected before Muse opens.
7. Each 3,840-byte binary frame reaches the same coordinator in order.
8. A socket disconnect followed by valid resume replays only missing events and continues the same mapping.
9. The initial socket's close-finally handler running after a replacement socket has resumed cannot detach the replacement, stop its audio, or move its deadline.
10. Disconnect during active playback updates backend playback state and replays `playback.stop_requested(reason="connection_lost")` on resume, leaving the committed card/audio asset available for manual replay while clearing the server's speaking activity.
11. The audio route serves `audio/mpeg`, denies cross-session lookup with 404, and returns 404 after end.
12. HTTP CORS and WebSocket `Origin` validation accept only configured development origins; a native client may omit `Origin` but must still pair. The exact React Native loopback origin `http://127.0.0.1:8000` is accepted only when `ALLOW_INSECURE_LOOPBACK_DEBUG=true`, rejected when false, and no LAN/non-loopback insecure origin is ever accepted by that exception.
13. Logs never include pairing tokens, resume tokens, transcript text, or random audio asset IDs from URL paths.

- [ ] **Step 3: Verify protocol authentication and recovery messages**

Use the Task 2 `pairing_token` fields on both `SessionStart` and `SessionResume`; the initial WebSocket JSON body is the only place the client presents that token. Exercise the existing `intervention.audio_retry`, `session.warning`, `intervention.audio_failed`, `playback.start_requested`, and `playback.stop_requested` models in gateway integration tests, then regenerate schemas/types to prove the gateway did not introduce an undocumented wire shape. No protocol event contains full transcript text; intervention events contain only the source fragment and translated fragment required by the card.

- [ ] **Step 4: Run the focused tests to verify failure**

```bash
cd apps/backend
uv run pytest tests/unit/test_session_registry.py tests/integration/test_session_websocket.py tests/integration/test_audio_endpoint.py -v
```

Expected: FAIL because the registry and routes do not exist.

- [ ] **Step 5: Implement bounded resumable ownership**

The gateway assigns a fresh UUID `attachment_id` to every accepted socket and passes it to every registry operation. Each registry entry owns one coordinator, an initially null `runner_task`, one `SequencedEventSink`, resume-token digest, the current attachment ID with its own `audio_started` flag, a lifecycle/attachment lock, disconnect deadline, 512-event deque, and detachable-silence task. Creation validates configuration, binds the initial attachment, emits `session.ready`, then emits `session.status(connection_state="idle", activities=[])` without starting a provider. `start_audio(session_id, attachment_id)` verifies that the named attachment is still current, emits `connecting`, and on the first session-wide call assigns `runner_task = asyncio.create_task(coordinator.run())` before awaiting `wait_started()`; success emits active/listening status, while typed `MuseStartFailed` awaits the finished runner, removes the closed entry, and never emits active/listening. After a successful resume, one `audio.start` on the new attachment merely switches that attachment from filler to live microphone input and emits active/listening status; it never starts a second runner. Reject duplicate starts on the same attachment. `disconnect(session_id, attachment_id)` first compares the current ID under the lifecycle lock; a missing or stale ID is a no-op, so an old socket's delayed `finally` block cannot touch its replacement. Cleanup signals `close`, awaits `wait_closed` when a runner exists, then awaits that runner so no task leaks. The shared sink is the sole sequence owner for coordinator and gateway events and appends each emitted event to the replay deque before live delivery. Reject a second live attachment.

On disconnect of the **current** attachment from an active audio session, mark that attachment detached before any await, stop accepting its audio immediately, and call `coordinator.handle_connection_lost()`. If generated playback was reserved or active, that method cancels/resolves the reservation, marks active playback interrupted/manual-only, clears the speaking activity, and emits `playback.stop_requested(reason="connection_lost")` into the replay deque. Pace exact zeroed 3,840-byte frames to the same Muse session every 80 ms for at most the 15-second grace so Meta does not close an idle input; a prepared session with no runner needs no filler.

The WebSocket gateway verifies the process pairing token before calling `resume(session_id, new_attachment_id, resume_token, last_sequence)`. Registry lookup performs the same constant-time resume-token comparison against the stored digest or a fixed dummy digest for a missing session, so missing and mismatched sessions have the same external failure. For an existing entry, `resume` acquires the lifecycle/attachment lock also used by expiry and validates that the entry is detached, the new attachment ID is unused, the resume-token digest matches, the grace deadline has not passed, the claimed sequence is not ahead of the sequencer, and the claimed sequence is not older than the deque **while the existing expiry and silence tasks remain armed**. Any failure releases the lock without changing attachment, expiry, filler, coordinator, or playback state.

Only after every check succeeds does `resume` reserve the new attachment as replaying, cancel and await the expiry and silence tasks, and acquire the sequencer's replay barrier—the same lock used to assign a sequence and append to the ring. Inside one three-second replay-send timeout while producers are briefly blocked at that barrier, first send the already-buffered events with `sequence > last_sequence` in ascending order. Only after the final missed event is sent, create, append, and send a new `session.ready(resumed=true)` with the next sequence. Then mark the attachment live but `audio_started=false` and release the replay barrier and lifecycle lock; newly produced events necessarily receive later sequences and deliver live. Validate ring coverage before adding the ready event so a full ring cannot evict a needed replay item. On a replay send failure or timeout, clear the replay reservation under the already-held lock, release both locks, and restart expiry/filler for only the unelapsed portion of the original grace deadline; do not recursively call the public `disconnect` while holding its lock. On expiry, the same lifecycle lock serializes against resume, then cancels filler and closes the coordinator/provider cleanly.

- [ ] **Step 6: Implement the strict WebSocket state machine**

Before accepting a browser WebSocket, compare its `Origin` header against the explicit allowed-origin set; permit an absent origin for the native client, whose pairing token remains mandatory. React Native Android can send an Origin derived from the WebSocket target, so when—and only when—`ALLOW_INSECURE_LOOPBACK_DEBUG=true`, also accept the exact `http://127.0.0.1:8000` Origin used by the ADB-reversed native path. This exception must compare parsed scheme, host, and port exactly, never accept a wildcard, LAN address, suffix match, or forwarded-host guess. Accept the socket, allocate its attachment ID, parse one initial text message with `asyncio.timeout(5)`, verify its pairing token, and validate every configured language code against the backend capability catalog before creating or looking up any session. Then enter one receive loop, passing that attachment ID to create/resume/start/disconnect. Permit binary data only in the `audio_started` state. Permit JSON controls through `parse_client_message`; reject a second start/resume, malformed JSON, unsupported protocol version, unsupported language, or wrong frame type with a stable application close code. When `audio.start` raises `MuseStartFailed`, allow the already-sequenced degraded/ended events to flush, close with a stable provider-start code, and return; do not wait again or leave a registry entry behind. In the socket `finally`, call `disconnect(session_id, attachment_id)`; a disconnected or superseded client must not discard the live replacement or the session before its grace deadline.

- [ ] **Step 7: Serve session-owned MP3 bytes safely**

Build `audio_url` from `BACKEND_PUBLIC_BASE_URL`, session UUID, and the random asset ID. Return `StreamingResponse(iter([asset.data]), media_type="audio/mpeg")` with `Cache-Control: no-store, max-age=0` and `X-Content-Type-Options: nosniff`. The unguessable asset ID is the bearer capability for playback; do not include API credentials, pairing tokens, or resume tokens in the URL.

- [ ] **Step 8: Compose the real app through lifespan**

Define the final composition contract in `composition.py`:

```python
@dataclass(frozen=True)
class AppDependencies:
    settings: Settings
    pairing_token: PairingToken
    transcriber: Transcriber
    analyzer: SparkAnalyzer
    synthesizer: SpeechSynthesizer
    audio_store: InMemoryAudioStore
    clock: Clock
```

`build_production_dependencies()` loads settings once, generates the process pairing token, and constructs the real adapters. Replace the temporary Task 3 factory with `create_app(dependencies: AppDependencies | None = None)`; when omitted it calls the production builder, and every Task 1/3/11 test is updated to pass a complete dependency bundle with fake providers and `_env_file=None` settings. The FastAPI lifespan creates the registry and cleanup task exactly once from this bundle. Shutdown closes every registry entry before provider clients. Configure explicit CORS origins. Disable Uvicorn's raw access log in project launch scripts and emit only sanitized route-template metadata through `safe_logging`, so the asset capability in `/v1/sessions/{session_id}/audio/{asset_id}` never reaches a log.

- [ ] **Step 9: Regenerate and verify the complete gateway**

```bash
cd apps/backend
uv run python scripts/export_protocol_schema.py
uv run pytest tests/unit/test_session_registry.py tests/integration/test_session_websocket.py tests/integration/test_audio_endpoint.py -v
cd ../client
npm run protocol:generate
npm test -- --runInBand tests/protocol
npx tsc --noEmit
```

Expected: protocol generation is deterministic; all WebSocket, resume, authorization, and asset tests pass.

- [ ] **Step 10: Commit the local session gateway**

```bash
git add packages/protocol apps/backend/src/language_coach apps/backend/tests apps/client/src/protocol/generated.ts
git commit -m "feat: expose resumable local conversation sessions"
```

## Task 12: Build and Validate the Setup Experience

**Files:**
- Create: `apps/client/src/setup/model.ts`
- Create: `apps/client/src/setup/validation.ts`
- Create: `apps/client/src/setup/SetupScreen.tsx`
- Create: `apps/client/src/services/capabilities.ts`
- Create: `apps/client/src/session/SessionProvider.tsx`
- Create: `apps/client/tests/setup/validation.test.ts`
- Create: `apps/client/tests/setup/SetupScreen.test.tsx`
- Modify: `apps/client/src/app/_layout.tsx`
- Modify: `apps/client/src/app/index.tsx`

**Interfaces:**
- Produces: `loadCapabilities(baseUrl) -> Promise<CapabilitiesResponse>`
- Produces: `validateSetup(model, capabilities) -> SetupErrors`
- Produces: `SetupScreen` and route-spanning `SessionProvider`
- Guarantees: language choices come from the backend; device locale is only a default; recording never starts before readiness, pairing, disclosure, and permission succeed

- [ ] **Step 1: Write failing setup-model tests**

Assert that learner-plus-fluent mode requires one native language and one different learning language, two-learner mode additionally requires Learner 2's native language, every code must occur in the fetched capabilities, and both learners may share the same native language. Assert that switching back to default mode clears Learner 2 configuration before the start payload is built.

- [ ] **Step 2: Write failing SetupScreen interaction tests**

Using React Native Testing Library, cover:

- loading and retry states for backend capabilities;
- backend address and temporary pairing-token inputs;
- a supported device locale preselecting Learner 1's native language;
- an unsupported device locale leaving a visible required selection instead of guessing;
- the **Two learners** toggle revealing Learner 2's selector;
- same native/learning language showing an inline validation error;
- provider readiness failure naming Meta or ElevenLabs without exposing credentials;
- the disclosure stating that microphone audio/text go to Meta, translated speech goes to ElevenLabs, and an internet connection is required even though the app/backend run locally;
- a speaking-order instruction that Learner 1 must speak first and, in two-learner mode, Learner 2 should be the next distinct speaker;
- **Start conversation** remaining disabled until disclosure acknowledgement and valid fields;
- pairing failure occurring before microphone permission is requested;
- successful readiness and pairing requesting microphone permission once, creating the session, and navigating to `/conversation`.

- [ ] **Step 3: Run the setup tests to verify they fail**

```bash
cd apps/client
npm test -- --runInBand tests/setup
```

Expected: FAIL because the setup model and screen do not exist.

- [ ] **Step 4: Implement backend discovery and device-locale defaulting**

Fetch `/health` and `/v1/capabilities` with an abortable five-second timeout. Preserve backend display names and codes as returned; do not duplicate the 25-language catalog in TypeScript. Read `getLocales()[0]?.languageCode` from `expo-localization` and select it only when that exact code is present. Keep the manually entered backend base URL and pairing token in React state only, never AsyncStorage, URLs, or logs.

- [ ] **Step 5: Implement the sparse setup form**

Render labeled native and learning-language pickers, the mode toggle, development connection fields, disclosure checkbox, readiness banner, a concise speaking-order instruction, and one primary start button. The disclosure copy must explicitly say that the local app still requires internet access because microphone audio/text are processed by Meta and translated speech is processed by ElevenLabs. In default mode, state that the learner must speak first; in two-learner mode, state that Learner 1 should speak before Learner 2 and that the conversation screen can swap them. Validation must be synchronous and visible. Use accessible labels and `testID` values without depending on platform-specific picker text in tests. The form may remain visually plain; do not add history, lessons, accounts, or voice calibration.

- [ ] **Step 6: Implement ordered session startup**

`SessionProvider.start(setup)` performs these steps in order:

1. Re-fetch readiness and capabilities.
2. Open the WebSocket and send `session.start` with protocol version, pairing token, and locked configuration.
3. Wait for `session.ready` and retain session/resume identifiers in memory.
4. Request microphone permission.
5. If permission is denied, send `session.end`, close the socket, and leave the user on setup with recovery guidance.
6. If granted, send `audio.start`, wait for active/listening status confirming Muse is ready, then navigate to the conversation route and begin capture.

This order ensures an unreachable or unauthorized backend never activates the microphone, while the backend's lazy provider start ensures Muse does not sit idle during a permission prompt.

- [ ] **Step 7: Verify setup on web and Android rendering**

```bash
cd apps/client
npm test -- --runInBand tests/setup
npx tsc --noEmit
npx expo export --platform web
npx expo export --platform android
```

Expected: tests pass and both target bundles compile.

- [ ] **Step 8: Commit the setup flow**

```bash
git add apps/client/src/app apps/client/src/setup apps/client/src/services apps/client/src/session apps/client/tests/setup
git commit -m "feat: add language coach setup flow"
```

## Task 13: Implement Ordered Client Transport and Resume

**Files:**
- Create: `apps/client/src/protocol/sessionSocket.ts`
- Create: `apps/client/src/protocol/reducer.ts`
- Create: `apps/client/src/conversation/model.ts`
- Create: `apps/client/tests/protocol/sessionSocket.test.ts`
- Create: `apps/client/tests/protocol/reducer.test.ts`
- Modify: `apps/client/src/session/SessionProvider.tsx`

**Interfaces:**
- Produces: `SessionSocket.start(setup)`, `sendAudio(frame)`, `sendControl(message)`, `end()`, and `resume(credentials)`
- Produces: `reduceConversation(state, action: ServerEvent | LocalConnectionLost) -> ConversationState`
- Guarantees: only monotonically ordered events from the active session mutate UI; audio is never buffered across a disconnect; resume expires after 15 seconds

- [ ] **Step 1: Write failing reducer tests**

Cover ready/status/mapping—including `idle -> connecting -> active`—preview replacement, commit stability, audio-ready, audio-failed, playback requests (including both stop reasons), degraded state, expiry warning, and ended cleanup. A local `connection_lost` action must immediately clear speaking/current playback and retain its card/audio as manual replay without advancing `lastSequence`; replaying the server's sequenced `playback.stop_requested(reason="connection_lost")` must be idempotent. Explicitly assert:

```typescript
const afterWrongSession = reduceConversation(activeState, {
  ...committedEvent,
  session_id: '00000000-0000-4000-8000-000000000099',
});
expect(afterWrongSession).toBe(activeState);

const afterDuplicate = reduceConversation(activeState, {
  ...committedEvent,
  sequence: activeState.lastSequence,
});
expect(afterDuplicate).toBe(activeState);
```

An `intervention.cancelled` caused by final-empty or preview replacement removes only the provisional card. A `playback.stop_requested` changes playback state but retains the committed card and replay URL.

- [ ] **Step 2: Write failing socket tests with a fake WebSocket**

Assert first-message ordering, binary frame forwarding, JSON controls, malformed event rejection, obsolete session rejection, duplicate/out-of-order suppression, disconnect notification, and backpressure handling. Give each injected socket a local generation number and assert that a delayed `close`/`message` callback from the pre-resume socket cannot reset or mutate the resumed connection. When `WebSocket.bufferedAmount` exceeds 96,000 bytes (two seconds of the configured PCM rate), `sendAudio` must stop capture and surface `connection_too_slow` rather than dropping frames or accumulating five seconds of audio that Meta will reject. Also test this resume flow:

1. Stop microphone capture and generated-audio playback immediately on unexpected close.
2. Dispatch the local `connection_lost` reducer action so speaking/current playback clear before any reconnect succeeds.
3. Retain no unsent PCM frames.
4. Reconnect within 15 seconds and send `session.resume` with the pairing token, session ID, resume token, and last accepted sequence.
5. Apply replayed events in order, including the sequenced `connection_lost` playback stop when the disconnect occurred during a clip; if the last accepted sequence is `k` and the server had reached `n`, assert receipt of `k+1..n` followed by resumed `session.ready` at `n+1` with no gap or reversal.
6. Send `audio.start` and restart capture only after resumed `session.ready` or `session.status` confirms attachment.
7. Return to a restart-required state when resume is unavailable or the deadline elapses.

- [ ] **Step 3: Run transport tests to verify they fail**

```bash
cd apps/client
npm test -- --runInBand tests/protocol/sessionSocket.test.ts tests/protocol/reducer.test.ts
```

Expected: FAIL because the socket and reducer do not exist.

- [ ] **Step 4: Implement the versioned socket wrapper**

Make the native `WebSocket` constructor injectable. Increment a local socket generation on each start/resume and make every callback verify it is still current before changing transport or reducer state. Parse every current text frame with `parseServerEvent`; close and surface `protocol_error` for invalid JSON, an unsupported version, an unexpected event type, a future sequence gap after live attachment, or an event for another active session. Send only `ArrayBuffer` audio and JSON-serialized generated client-message types. Before each audio send, enforce the 96,000-byte `bufferedAmount` ceiling; crossing it stops capture and requires reconnect/restart rather than skipping time in the transcription stream. Never append pairing or resume credentials to the connection URL.

- [ ] **Step 5: Implement explicit reconnect rather than silent restart**

Use one reconnect attempt within the backend's 15-second grace period. Do not create a new `session.start` automatically because that would silently remap voices. While disconnected, reject frames rather than queueing audio. On the close callback, stop the native player and dispatch `LocalConnectionLost` before opening the resume socket; this action clears only transient speaking/playback state, marks the active card replayable, and preserves session/mapping/sequence data. If resume succeeds, continue that reducer state and apply the server's replayed stop event idempotently; if it fails, stop capture, retain no transcript or audio, show **Start a new conversation**, and let the user return to setup.

- [ ] **Step 6: Connect transport to SessionProvider**

The provider owns the `SessionSocket`, reducer, and in-memory credentials for exactly one active route-spanning session. Its cleanup sends `audio.stop` then `session.end` when possible, closes the socket, stops capture/playback callbacks, clears reducer state and credentials, and returns to setup. React unmount cleanup must be idempotent for development Strict Mode.

- [ ] **Step 7: Verify transport determinism**

```bash
cd apps/client
npm test -- --runInBand tests/protocol
npx tsc --noEmit
```

Expected: reducer and reconnect tests pass with no real WebSocket or timers.

- [ ] **Step 8: Commit client protocol handling**

```bash
git add apps/client/src/protocol apps/client/src/conversation/model.ts apps/client/src/session/SessionProvider.tsx apps/client/tests/protocol
git commit -m "feat: add ordered conversation transport"
```

## Task 14: Integrate the Intervention-Only Conversation Screen

**Files:**
- Create: `apps/client/src/conversation/InterventionCard.tsx`
- Create: `apps/client/src/conversation/ConversationScreen.tsx`
- Create: `apps/client/src/audio/useInterventionPlayer.ts`
- Create: `apps/client/src/session/useForegroundSession.ts`
- Create: `apps/client/tests/conversation/ConversationScreen.test.tsx`
- Create: `apps/client/tests/audio/useInterventionPlayer.test.tsx`
- Modify: `apps/client/src/app/conversation.tsx`
- Modify: `apps/client/src/audio/usePcmCapture.ts`
- Modify: `apps/client/src/session/SessionProvider.tsx`

**Interfaces:**
- Produces: an active conversation view with status, speaker mapping, intervention cards, swap, replay, and end controls
- Produces: `useInterventionPlayer({onStarted, onEnded, onInterrupted})`
- Guarantees: no full transcript is rendered; generated clips never overlap; playback lifecycle is reported to the backend

- [ ] **Step 1: Write failing conversation-view tests**

Using a fake `SessionProvider`, assert:

- connecting, listening, analyzing, audio-pending, speaking, degraded, expiring, and ended states are understandable and may coexist where the model permits;
- ordinary target-language turns create no row or transcript area;
- a preview card displays exactly `source_text -> target_text` with a provisional state;
- a committed event stabilizes the matching card rather than duplicating it;
- audio-ready enables replay, audio-failed displays one retry action, and a second failure removes retry;
- two-learner mode shows current label assignments and **Swap speakers**;
- default mode does not show swap;
- end requires no history decision and returns to setup after cleanup;
- native app backgrounding or web document hiding stops capture/playback and ends the foreground-only session;
- source or target text never appears in accessibility announcements while a card is cancelled;
- there is no element named `Transcript`, `History`, `Lesson`, `Save`, or `Account`.

- [ ] **Step 2: Write failing playback-controller tests**

Inject a fake Expo player and test:

1. `playback.start_requested` loads one audio URL and reports `playback.started` before play.
2. A second automatic request is queued until the first reports completion.
3. `playback.stop_requested` stops immediately, reports `playback.interrupted`, and keeps the URL replayable.
4. Manual replay reports `manual: true` and never creates another intervention.
5. Load or decode failure reports an audio failure without changing the translation card.
6. End/unmount stops and releases the player exactly once.

- [ ] **Step 3: Run the UI and playback tests to verify they fail**

```bash
cd apps/client
npm test -- --runInBand tests/conversation tests/audio/useInterventionPlayer.test.tsx
```

Expected: FAIL because the screen and player do not exist.

- [ ] **Step 4: Implement the intentionally sparse conversation UI**

Call `useKeepAwake()` while the route is active. Subscribe to React Native `AppState` and web `document.visibilityState` through a small platform adapter; leaving the foreground invokes the same idempotent session-end cleanup as the end button because background capture is outside the MVP. Render a compact status region, current mapped speaker labels, a newest-first list of intervention cards, and swap/end controls. Each card displays the native fragment, an arrow, the learning-language fragment, provisional/committed/audio state, and replay or retry when available. Do not render the transcript store, partial text outside an intervention, or provider debug data.

- [ ] **Step 5: Integrate capture with the active socket**

After SessionProvider has permission, sends `audio.start`, and receives active/listening status, call `usePcmCapture.start()` and forward every exact frame through `SessionSocket.sendAudio`. Stop capture immediately on socket loss, Muse degradation, route exit, or end. On a successful resume of an already active provider session, restart only after the resumed ready/status sequence and a fresh `audio.start` attachment control. Never persist, inspect, or render frame contents.

- [ ] **Step 6: Integrate playback and feedback markers**

Create the Expo player from the session-owned `audio_url`. Before calling play, send `playback.started` with the intervention ID and whether it is manual. On natural completion send `playback.ended`; on server stop, player failure, route cleanup, or human interruption send `playback.interrupted`. Keep microphone capture active during playback so Muse can detect human barge-in; rely on platform echo cancellation where available plus the coordinator's playback-window mapping suppression and generated-text exclusion.

- [ ] **Step 7: Verify React behavior and builds**

```bash
cd apps/client
npm test -- --runInBand tests/conversation tests/audio
npx tsc --noEmit
npx expo export --platform web
npx expo export --platform android
```

Expected: tests pass; both bundles build; test output has no unhandled state-update warnings.

- [ ] **Step 8: Run the S26 feedback-loop gate**

On the S26 Ultra, play ten generated phrases while capture remains active. Confirm app-generated speech never creates a participant, never produces another intervention, and never loops. Begin human speech during three clips and confirm each clip stops while its card remains manually replayable. Record only pass/fail and timing metadata in the acceptance checklist. If the device exposes no effective acoustic echo cancellation, the marker/text safeguards must still satisfy these outcomes; do not silently mute capture and lose barge-in detection.

- [ ] **Step 9: Commit the live conversation interface**

```bash
git add apps/client/src/app/conversation.tsx apps/client/src/conversation apps/client/src/audio apps/client/src/session apps/client/tests/conversation apps/client/tests/audio docs/testing/s26-acceptance-checklist.md
git commit -m "feat: add intervention-only conversation screen"
```

## Task 15: Make Local Web and S26 Development Repeatable

**Files:**
- Create: `scripts/dev-cert.sh`
- Create: `scripts/dev-backend.sh`
- Create: `scripts/dev-client.sh`
- Create: `docs/testing/local-development.md`
- Create: `apps/backend/tests/unit/test_public_urls.py`
- Modify: `Makefile`
- Modify: `README.md`
- Modify: `apps/client/package.json`
- Modify: `apps/client/package-lock.json`

**Interfaces:**
- Produces: `make dev-cert`, `make backend-dev`, `make client-web`, and `make client-android`
- Produces: HTTPS/WSS localhost Expo web workflow and a device-local Android debug workflow
- Guarantees: credentials are backend-only; browser microphone use has a secure context; Android cleartext is never exposed to the LAN

- [ ] **Step 1: Write failing public-URL tests**

Add a backend `ALLOW_INSECURE_LOOPBACK_DEBUG` setting defaulting to false. Test that `audio_url` uses the configured backend origin, rejects an origin with credentials/query/fragment, preserves HTTPS for web, and may use loopback HTTP only when that explicit development flag is true. Reject wildcard CORS origins and any non-loopback insecure public base URL.

- [ ] **Step 2: Add local TLS tooling and script syntax tests**

Install `local-ssl-proxy` as a client dev dependency. Before filling in the scripts, create them with executable mode and run:

```bash
bash -n scripts/dev-cert.sh scripts/dev-backend.sh scripts/dev-client.sh
cd apps/backend
uv run pytest tests/unit/test_public_urls.py -v
```

Expected: URL tests fail until validation is implemented; shell syntax succeeds.

- [ ] **Step 3: Implement trusted localhost certificates for the web client**

`dev-cert.sh` must require `mkcert`, create `.certs/`, run `mkcert -install`, and generate `.certs/dev-cert.pem` plus `.certs/dev-key.pem` for `localhost`, `127.0.0.1`, and `::1`. Do not generate certificates for an automatically guessed LAN address. The files remain excluded by `.gitignore`.

`dev-backend.sh web` runs Uvicorn with `--no-access-log` on `127.0.0.1:8444` and those cert/key files. `dev-client.sh web` runs Expo web on `127.0.0.1:8081` and `local-ssl-proxy` from `https://localhost:8443` to that port. The setup defaults become client `https://localhost:8443`, HTTP API `https://localhost:8444`, and session socket `wss://localhost:8444/v1/session`.

- [ ] **Step 4: Implement a device-local Android debug path**

For Expo Go or a development build on the tethered S26, `dev-backend.sh android` uses `--no-access-log`, listens on `127.0.0.1:8000`, and overrides `BACKEND_PUBLIC_BASE_URL=http://127.0.0.1:8000` plus `ALLOW_INSECURE_LOOPBACK_DEBUG=true` for that process; `dev-client.sh android` first runs `adb reverse tcp:8000 tcp:8000`, sets `EXPO_PUBLIC_LOOPBACK_DEBUG=1`, and then starts Expo. The client uses `http://127.0.0.1:8000` and `ws://127.0.0.1:8000/v1/session` only when `__DEV__` and that build variable are both true. The backend accepts React Native's exact `Origin: http://127.0.0.1:8000` only under the same backend flag; add a gateway integration test for enabled, disabled, and non-loopback Origin cases. Because ADB reverse keeps that port device-local rather than exposing it to the LAN, this exception does not weaken the browser path. Release builds reject insecure URLs.

At this task, replace the bootstrap development recipes with these exact wrappers (Task 16 will add `e2e` and `provider-smoke` without changing them):

```make
.PHONY: dev-cert backend-dev client-web client-android

dev-cert:
	./scripts/dev-cert.sh

backend-dev:
	./scripts/dev-backend.sh web

client-web:
	./scripts/dev-client.sh web

client-android:
	./scripts/dev-client.sh android
```

- [ ] **Step 5: Document the two supported workflows**

`docs/testing/local-development.md` must list prerequisites, `.env` setup, certificate trust, pairing-token entry, web start commands, USB debugging/ADB reverse steps, microphone permission recovery, provider readiness interpretation, and clean shutdown. State clearly that:

- processing still uses Meta and ElevenLabs over the internet;
- only application state is local and ephemeral;
- provider retention follows the configured provider accounts;
- Expo Go is for validation, not Play Store packaging;
- a future hosted or release build must use HTTPS/WSS and the same protocol.

- [ ] **Step 6: Verify scripts and both launch surfaces**

```bash
bash -n scripts/dev-cert.sh scripts/dev-backend.sh scripts/dev-client.sh
make check
make dev-cert
```

In separate terminals run `make backend-dev` and `make client-web`. Confirm `/health` loads over HTTPS, the browser grants microphone permission, WSS connects with a pairing token, and no mixed-content warning appears. Then run `make client-android`, confirm the S26 reaches the loopback-reversed backend, and verify the backend is not listening on a LAN interface.

- [ ] **Step 7: Commit repeatable local development**

```bash
git add scripts Makefile README.md docs/testing/local-development.md apps/backend/tests/unit/test_public_urls.py apps/client/package.json apps/client/package-lock.json
git commit -m "chore: add secure local development workflows"
```

## Task 16: Prove the MVP End to End and Document Its Boundary

**Files:**
- Create: `apps/backend/tests/e2e/fake_app.py`
- Create: `apps/backend/tests/integration/test_session_stress.py`
- Create: `apps/backend/tests/unit/test_measure_rss.py`
- Create: `apps/backend/tests/live/test_muse_live.py`
- Create: `apps/backend/tests/live/test_spark_live.py`
- Create: `apps/backend/tests/live/test_elevenlabs_live.py`
- Create: `apps/backend/scripts/measure_rss.py`
- Create: `apps/client/e2e/setup-and-intervention.spec.ts`
- Create: `apps/client/playwright.config.ts`
- Create: `docs/testing/provider-smoke-tests.md`
- Complete: `docs/testing/s26-acceptance-checklist.md`
- Modify: `README.md`
- Modify: `Makefile`
- Modify: `apps/backend/pyproject.toml`
- Modify: `apps/client/package.json`

**Interfaces:**
- Produces: `make e2e`, `make provider-smoke`, and a manual S26 acceptance checklist
- Guarantees: CI/default tests use no paid providers; live-provider checks are explicit; completion evidence covers behavior, latency, stability, cleanup, and non-goals

- [ ] **Step 1: Write a failing browser acceptance test against provider fakes**

The E2E-only FastAPI composition root injects scripted Transcribe, Spark, and ElevenLabs fakes through `create_app(dependencies=e2e_dependencies)`; production settings cannot select this mode. The fake transcriber waits for valid 3,840-byte frames, then emits two mapped speakers, a Spanish turn with an English insertion, final completion, and a barge-in event. The fake audio asset is a short non-speech MP3 fixture retained only in memory.

The Playwright test must:

1. Open setup and load backend capabilities.
2. Select English native, Spanish learning, and default mode.
3. Acknowledge provider processing, enter the test pairing token, and start.
4. Confirm no full transcript is present.
5. Observe `grocery store -> supermercado` first as preview and then committed.
6. Confirm automatic audio waits until the scripted safe pause.
7. Trigger scripted barge-in, observe playback stop, and verify replay remains.
8. End the session and confirm return to setup with no session cards, pairing/resume credentials, transcript state, or audio state; ordinary device-language defaults may be recomputed.
9. Fetch `GET /__e2e__/state` with the fixed non-production `X-E2E-Token` and assert zero sessions, zero transcript turns, and zero audio bytes after cleanup.

- [ ] **Step 2: Run the browser test to verify it fails**

```bash
cd apps/client
npx playwright test e2e/setup-and-intervention.spec.ts
```

Expected: FAIL because the E2E fake composition root and Playwright configuration are missing.

- [ ] **Step 3: Implement deterministic E2E orchestration**

Configure Playwright `webServer` entries for the fake backend on `127.0.0.1:8765` and Expo web on `localhost:8764`. The injected E2E dependency bundle allows only `http://localhost:8764`, uses an insecure-loopback public URL only inside that fake process, and cannot be selected by production settings. Set the existing development-only loopback flag in the Expo webServer command, point it at `http://127.0.0.1:8765`/`ws://127.0.0.1:8765`, and never expose this test flag in an export or production composition. Browsers treat `http://localhost` as a potentially trustworthy microphone context, so offline E2E does not depend on a developer's `mkcert` installation; the Task 15 HTTPS/WSS workflow remains the manual production-shaped path. Grant microphone permission to `http://localhost:8764` and launch Chromium with `--use-fake-device-for-media-stream` so the source contains no human speech. Ensure the fake provider advances from received frame count and explicit test controls rather than wall-clock sleeps. `tests/e2e/fake_app.py` registers `GET /__e2e__/state` only on its returned test app and requires an `X-E2E-Token` known to Playwright; `language_coach.main.app` never imports that module or registers that route. Add an integration assertion that the production composition root returns 404 for `/__e2e__/state`.

In `test_session_stress.py`, drive 100 fake positive turns through one session with unique small byte payloads. Assert the audio store byte count equals the exact sum of those payloads, transcript/intervention/event counts are linear rather than duplicated, and session end returns every in-memory count to zero.

Implement `scripts/measure_rss.py` with `psutil.Process(pid).memory_info().rss`. It accepts `--pid`, `--warmup-seconds` (default `300`), `--total-seconds` (default `1200`), `--sample-seconds` (default `5`), and `--max-growth-mib` (default `50`). It samples only RSS/timestamps, captures the first sample at or after warmup as the baseline, compares the final sample at total duration, prints those two MiB values plus the delta, and exits nonzero when the delta exceeds the limit or the process disappears. `test_measure_rss.py` injects a fake process and clock to verify byte-to-MiB conversion, baseline selection, pass/fail thresholds, and that no session/transcript data is read.

- [ ] **Step 4: Add opt-in live provider smoke checks**

Document exact commands and expected results for:

- Muse Voice Transcribe connection, partial revision, speaker labels, `speechComplete`, and clean close using a user-supplied 24 kHz mono int16 PCM path from `LIVE_MUSE_PCM_PATH`; the fixture stays outside the repository and its contents are never logged;
- Muse Spark positive, empty, and malformed-response handling with no full-turn translation;
- ElevenLabs Spanish through Flash and Bengali through Text-to-Dialogue, both returning playable `mp3_44100_128`;
- invalid keys and quota errors redacted from logs.

Register a `live_provider` pytest marker in `apps/backend/pyproject.toml`. Mark tests with it. When `RUN_LIVE_PROVIDER_TESTS` is absent or not `1`, a collection hook skips every live-provider test without inspecting credentials. Once the flag is `1`, each test validates its own required variables and calls `pytest.fail` with their exact missing names; opt-in tests must never skip because configuration is incomplete. Replace the cumulative root `Makefile` with this exact final target set:

```make
.PHONY: backend-test client-test check dev-cert backend-dev client-web client-android e2e provider-smoke

backend-test:
	cd apps/backend && uv run pytest -m "not live_provider"

client-test:
	cd apps/client && npm test -- --runInBand

dev-cert:
	./scripts/dev-cert.sh

backend-dev:
	./scripts/dev-backend.sh web

client-web:
	./scripts/dev-client.sh web

client-android:
	./scripts/dev-client.sh android

e2e:
	cd apps/client && npx playwright test e2e/setup-and-intervention.spec.ts

provider-smoke:
	cd apps/backend && RUN_LIVE_PROVIDER_TESTS=1 uv run --env-file ../../.env pytest -m live_provider tests/live -v

check: backend-test client-test
	cd apps/backend && uv run ruff check src tests
	cd apps/backend && uv run mypy src
	cd apps/client && npx tsc --noEmit
```

`make provider-smoke` is the only target that sets the opt-in flag; `make check` never invokes paid APIs. Document that `.env` must exist before the smoke target, while `LIVE_MUSE_PCM_PATH` may be supplied either there or in the invoking environment.

- [ ] **Step 5: Complete the S26 acceptance checklist**

Run and record pass/fail for:

- learner-plus-fluent first/second speaker mapping;
- two-learner mapping and swap;
- target-language-only conversation with no intervention;
- native-language insertion showing a concise card;
- audio waiting through speech and starting after 600 ms of quiet;
- barge-in stopping audio with replay retained;
- generated audio never mapping a speaker or causing another intervention;
- microphone denial and recovery;
- disconnect/resume inside 15 seconds preserving mappings;
- resume after expiry requiring a new session rather than remapping silently;
- Flash and v3-fallback target languages;
- approximately 1.5 seconds or less to representative visual help and 2.5 seconds or less from safe pause to representative audio under normal network conditions;
- 20 minutes of continuous target-language-only foreground operation without a stall, with zero audio assets and backend RSS growth below 50 MiB between the 5-minute warm point and 20-minute endpoint; record the backend PID, then run `cd apps/backend && uv run python scripts/measure_rss.py --pid <PID> --warmup-seconds 300 --total-seconds 1200 --max-growth-mib 50` alongside the device session and attach only its numeric result;
- an automated 100-intervention stress session where stored audio bytes equal the sum of unique fake MP3 payloads (no duplicate retention), event/transcript counts remain proportional to input turns, and every count plus stored byte total returns to zero after end;
- the 49-minute warning and 50-minute clean end using the injected clock in automation;
- zero application transcript files, audio files, or retained in-memory assets after end.

Record timing values, device/OS/app versions, and pass/fail only; do not record speech or transcript content.

- [ ] **Step 6: Document what this MVP deliberately does not do**

Update `README.md` with architecture, setup links, test commands, session behavior, privacy boundary, and a **Later, not in this MVP** section listing permanent conversation history, ChatGPT-style history browsing, lessons from conversation gaps, planned practice conversations, hosted deployment, voice enrollment, polished design, accounts, and Play Store distribution. Do not add schemas, endpoints, or tasks for those future features.

- [ ] **Step 7: Run the complete verification matrix**

```bash
make check
make e2e
cd apps/backend
uv run pytest -m "not live_provider" --cov=language_coach --cov-report=term-missing
uv run ruff check src tests
uv run mypy src
cd ../client
npm test -- --runInBand
npx tsc --noEmit
npx expo export --platform web
npx expo export --platform android
```

Expected: all offline tests and E2E pass; lint and types are clean; both Expo exports build; live provider tests remain skipped unless explicitly requested.

- [ ] **Step 8: Inspect the final diff and persistence boundary**

```bash
git status --short
git diff --check
git grep -nE "MODEL_API_KEY=.+|ELEVENLABS_API_KEY=.+|BEGIN (RSA |EC )?PRIVATE KEY"
find . -path ./.git -prune -o -type f \( -name '*.wav' -o -name '*.mp3' -o -name '*.pcm' \) -print
```

Expected: no `.wav`, `.mp3`, or `.pcm` file is listed because the synthetic E2E asset is generated from an in-source byte constant and retained only in process memory. No credentials, captured audio, transcript dump, whitespace error, or unrelated change remains.

- [ ] **Step 9: Commit the verified MVP**

```bash
git add README.md Makefile apps/backend/pyproject.toml apps/backend/scripts/measure_rss.py apps/backend/tests/e2e apps/backend/tests/integration/test_session_stress.py apps/backend/tests/unit/test_measure_rss.py apps/backend/tests/live apps/client/e2e apps/client/playwright.config.ts apps/client/package.json docs/testing
git commit -m "test: verify language coach MVP end to end"
```

---

## Requirement Coverage Map

| Approved MVP requirement | Primary implementation tasks | Verification evidence |
|---|---:|---|
| One learner plus fluent partner | 5, 10, 12, 14 | Coordinator tests, Playwright path, S26 mapping check |
| Two learners with explicit native languages and swap | 2, 5, 10, 12, 14 | Domain/UI tests and S26 swap check |
| All 25 Muse languages with compatible speech routing | 3, 7, 9 | Capability/contract tests and Flash/v3 smoke checks |
| Live 24 kHz PCM transcription with diarization | 4, 7 | Audio unit tests, Muse fixtures, web/S26 diagnostics |
| Detect and translate only native-language insertions | 8, 10 | Structured Spark tests and no-op/positive coordinator tests |
| Show only helpful source-to-target cards | 2, 13, 14 | Reducer/UI/E2E assertions; no transcript surface |
| Speak only final help after a safe pause | 6, 9, 10, 14 | Pure timing tests, playback tests, device barge-in check |
| Prevent generated-speech feedback | 5, 10, 14 | Mapping suppression, generated-text exclusion, S26 loop gate |
| Local-first, provider-backed, no secrets in client | 3, 11, 12, 15 | Readiness, pairing, gateway, and local workflow tests |
| In-memory transcript/audio with complete cleanup | 5, 9, 10, 11 | Store tests, E2E cleanup metrics, final file inspection |
| 15-second client reconnect without speaker remap | 2, 11, 13 | Registry and client-resume tests |
| 50-minute bounded session | 10, 16 | Manual-clock warning/end tests |
| Reusable backend protocol for later deployment | 2, 7-11, 13 | Generated contract and provider-neutral adapter tests |
| History and lessons documented but not built | 1, 14, 16 | README non-goals and UI/E2E absence checks |
