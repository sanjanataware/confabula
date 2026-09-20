import asyncio
from collections.abc import AsyncIterator

from language_coach.domain.models import TranscriptionEvent
from language_coach.providers.interfaces import (
    AnalysisRequest,
    AudioAsset,
    InterventionAnalysis,
    SpeechRequest,
    TranscriptionConfig,
)


class FakeTranscriptionSession:
    def __init__(self) -> None:
        self.sent_frames: list[bytes] = []
        self.queue: asyncio.Queue[TranscriptionEvent | None] = asyncio.Queue()
        self.closed = False

    async def send_pcm(self, frame: bytes) -> None:
        if self.closed:
            raise RuntimeError("fake transcription session is closed")
        self.sent_frames.append(frame)

    async def emit(self, event: TranscriptionEvent) -> None:
        await self.queue.put(event)

    async def events(self) -> AsyncIterator[TranscriptionEvent]:
        while True:
            event = await self.queue.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            await self.queue.put(None)


class FakeTranscriber:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.configs: list[TranscriptionConfig] = []
        self.sessions: list[FakeTranscriptionSession] = []

    async def open(self, config: TranscriptionConfig) -> FakeTranscriptionSession:
        self.configs.append(config)
        if self.error is not None:
            raise self.error
        session = FakeTranscriptionSession()
        self.sessions.append(session)
        return session


class FakeAnalyzer:
    def __init__(self) -> None:
        self.calls: list[AnalysisRequest] = []
        self.results: asyncio.Queue[InterventionAnalysis] = asyncio.Queue()

    async def analyze(self, request: AnalysisRequest) -> InterventionAnalysis:
        self.calls.append(request)
        if self.results.empty():
            return InterventionAnalysis(interventions=[])
        return await self.results.get()

    def add(self, result: InterventionAnalysis) -> None:
        self.results.put_nowait(result)


class FakeSynthesizer:
    def __init__(self, data: bytes = b"fake-mp3") -> None:
        self.data = data
        self.calls: list[SpeechRequest] = []
        self.error: RuntimeError | None = None

    async def synthesize(self, request: SpeechRequest) -> AudioAsset:
        self.calls.append(request)
        if self.error is not None:
            raise self.error
        return AudioAsset("audio/mpeg", self.data)
