import asyncio
import secrets
from collections.abc import AsyncIterator
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, Header, HTTPException

from language_coach.composition import AppDependencies
from language_coach.config import Settings
from language_coach.domain.models import (
    SpeakerObserved,
    SpeechCompleted,
    SpeechStarted,
    TranscriptionEvent,
    TranscriptPartial,
)
from language_coach.domain.session_coordinator import SystemClock
from language_coach.main import create_app
from language_coach.providers.device_speech import DeviceSpeechSynthesizer
from language_coach.providers.interfaces import (
    AnalysisRequest,
    InterventionAnalysis,
    InterventionCandidate,
    TranscriptionConfig,
)
from language_coach.services.audio_assets import InMemoryAudioStore
from language_coach.services.pairing import PairingToken
from language_coach.services.session_registry import SessionUnavailable

E2E_PAIRING_TOKEN = "e" * 43
E2E_STATE_TOKEN = "language-coach-e2e-state"
class ScriptedSession:
    def __init__(self, session_id: UUID) -> None:
        self.session_id = session_id
        self.queue: asyncio.Queue[TranscriptionEvent | None] = asyncio.Queue()
        self.closed = False
        self.frames = 0
        self.finalized = False
        self.barge_turn: str | None = None

    async def send_pcm(self, frame: bytes) -> None:
        if self.closed or len(frame) != 3840:
            raise RuntimeError("invalid fake PCM frame")
        self.frames += 1
        if self.frames == 3:
            self.queue.put_nowait(SpeechStarted("learner-turn", 0))
            self.queue.put_nowait(TranscriptPartial("learner-turn", 1, "Necesito grocery store", 80))
            self.queue.put_nowait(SpeakerObserved("learner-turn", "A", 160))
        if self.frames == 8:
            self.queue.put_nowait(SpeechStarted("partner-turn", 400))
            self.queue.put_nowait(SpeakerObserved("partner-turn", "B", 480))
            self.queue.put_nowait(SpeechCompleted("partner-turn", "Claro", "B", 560))

    def control(self, action: str) -> None:
        at = self.frames * 80
        if action == "finalize" and not self.finalized:
            if self.frames < 8:
                raise HTTPException(status_code=409, detail="waiting for PCM frames")
            self.finalized = True
            self.queue.put_nowait(SpeechCompleted("learner-turn", "Necesito grocery store", "A", at))
        elif action == "barge_in":
            self.barge_turn = f"barge-{self.frames}"
            self.queue.put_nowait(SpeechStarted(self.barge_turn, at))
            self.queue.put_nowait(SpeakerObserved(self.barge_turn, "A", at))
            self.queue.put_nowait(TranscriptPartial(self.barge_turn, 1, "Un momento", at))
        elif action == "complete_human" and self.barge_turn is not None:
            self.queue.put_nowait(SpeechCompleted(self.barge_turn, "Un momento", "A", at))
            self.barge_turn = None
        elif action == "echo":
            turn = f"echo-{self.frames}"
            self.queue.put_nowait(SpeechStarted(turn, at))
            self.queue.put_nowait(SpeakerObserved(turn, "phone", at))
            self.queue.put_nowait(TranscriptPartial(turn, 1, "supermercado", at))
            self.queue.put_nowait(SpeechCompleted(turn, "supermercado.", "phone", at))

    async def events(self) -> AsyncIterator[TranscriptionEvent]:
        while not self.closed:
            event = await self.queue.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        self.closed = True
        while not self.queue.empty():
            self.queue.get_nowait()
        self.queue.put_nowait(None)


class ScriptedTranscriber:
    def __init__(self) -> None:
        self.sessions: list[ScriptedSession] = []

    async def open(self, config: TranscriptionConfig) -> ScriptedSession:
        session = ScriptedSession(config.application_session_id)
        self.sessions = [item for item in self.sessions if not item.closed]
        self.sessions.append(session)
        return session


class ScriptedAnalyzer:
    async def analyze(self, request: AnalysisRequest) -> InterventionAnalysis:
        if "grocery store" not in request.transcript:
            return InterventionAnalysis(interventions=[])
        return InterventionAnalysis(interventions=[InterventionCandidate(
            source_text="grocery store", source_language="English",
            target_text="supermercado", target_language="Spanish",
        )])


def create_e2e_app() -> FastAPI:
    transcriber = ScriptedTranscriber()
    dependencies = AppDependencies(
        settings=Settings(
            _env_file=None, muse_api_key="e2e-muse",
            allowed_origins=["http://localhost:8764"],
            backend_public_base_url="http://127.0.0.1:8765", allow_insecure_loopback_debug=True,
        ),
        pairing_token=PairingToken(E2E_PAIRING_TOKEN), transcriber=transcriber,
        analyzer=ScriptedAnalyzer(), synthesizer=DeviceSpeechSynthesizer(),
        audio_store=InMemoryAudioStore(), clock=SystemClock(),
    )
    app = create_app(dependencies)

    def authorize(token: str | None) -> None:
        if not secrets.compare_digest((token or "").encode(), E2E_STATE_TOKEN.encode()):
            raise HTTPException(status_code=403, detail="forbidden")

    @app.get("/__e2e__/state")
    async def e2e_state(x_e2e_token: str | None = Header(default=None)) -> dict[str, int]:
        authorize(x_e2e_token)
        registry = app.state.registry
        counts = registry.memory_counts()
        counts.update({"speakers": 0, "playing": 0, "pcm_frames": 0})
        for provider in transcriber.sessions:
            if provider.closed:
                continue
            try:
                coordinator = registry.get_entry(provider.session_id).coordinator
            except SessionUnavailable:
                continue
            counts["speakers"] += len(coordinator.speaker_mapping.labels)
            counts["playing"] += int(coordinator.playback.playing is not None)
            counts["pcm_frames"] += provider.frames
        return counts

    @app.post("/__e2e__/control/{action}")
    async def control(
        action: Literal["finalize", "barge_in", "complete_human", "echo"],
        x_e2e_token: str | None = Header(default=None),
    ) -> dict[str, bool]:
        authorize(x_e2e_token)
        active = [item for item in transcriber.sessions if not item.closed]
        if len(active) != 1:
            raise HTTPException(status_code=409, detail="exactly one test session is required")
        active[0].control(action)
        return {"ok": True}

    return app


app = create_e2e_app()
