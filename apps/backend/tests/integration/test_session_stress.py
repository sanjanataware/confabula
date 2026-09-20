from dataclasses import replace
from uuid import uuid4

import pytest

from language_coach.domain.models import SpeakerObserved, SpeechCompleted, SpeechStarted
from language_coach.providers.interfaces import AudioAsset, SpeechRequest
from language_coach.services.audio_assets import InMemoryAudioStore
from language_coach.services.session_registry import SessionRegistry
from tests.fakes.clock import ManualClock, flush_tasks
from tests.fakes.providers import FakeSynthesizer
from tests.unit.test_session_coordinator import positive
from tests.unit.test_session_registry import CONFIG, dependencies


def test_one_hundred_unique_assets_are_linear_and_clear_completely() -> None:
    store = InMemoryAudioStore()
    session_id = uuid4()
    payloads = [f"fake-mp3-{index}".encode() for index in range(100)]
    asset_ids = [store.put(session_id, AudioAsset("audio/mpeg", payload)) for payload in payloads]
    assert len(set(asset_ids)) == 100
    assert store.count == 100
    assert store.size_bytes == sum(map(len, payloads))
    store.clear_session(session_id)
    assert store.count == store.size_bytes == 0


class UniqueSynthesizer(FakeSynthesizer):
    async def synthesize(self, request: SpeechRequest) -> AudioAsset:
        self.calls.append(request)
        return AudioAsset("audio/mpeg", f"unique-mp3-{len(self.calls)}".encode())


@pytest.mark.asyncio
async def test_one_hundred_positive_turns_have_linear_state_and_complete_cleanup() -> None:
    deps = dependencies(ManualClock())
    synth = UniqueSynthesizer()
    registry = SessionRegistry(replace(deps, synthesizer=synth))
    attachment = uuid4()
    created = await registry.create(CONFIG, attachment)
    try:
        await registry.start_audio(created.session_id, attachment)
        provider = deps.transcriber.sessions[0]
        entry = registry.get_entry(created.session_id)
        for index in range(100):
            source = f"native fragment {index}"
            deps.analyzer.add(positive(source, f"traducción {index}"))
            turn = f"turn-{index}"
            await provider.emit(SpeechStarted(turn, index * 1000))
            await provider.emit(SpeakerObserved(turn, "A", index * 1000 + 10))
            await provider.emit(SpeechCompleted(turn, f"Necesito {source}", "A", index * 1000 + 80))
            await flush_tasks()
        counts = registry.memory_counts()
        assert len(synth.calls) == counts["interventions"] == counts["transcript_turns"] == 100
        assert counts["audio_bytes"] == sum(len(f"unique-mp3-{index}".encode()) for index in range(1, 101))
        assert deps.audio_store.count == 100
        assert counts["events"] == 512
        assert 300 <= entry.sink.sequence <= 1200
    finally:
        await registry.close(created.session_id)
    assert all(value == 0 for value in registry.memory_counts().values())
    assert not entry.sink.events
    assert entry.coordinator.transcripts.count == entry.coordinator.interventions.count == 0
    assert provider.closed
