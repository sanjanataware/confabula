import re
import unicodedata
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID, uuid4

from language_coach.domain.models import ParticipantId


class CandidateLike(Protocol):
    source_text: str
    source_language: str
    target_text: str
    target_language: str


class InterventionState(StrEnum):
    PREVIEW = "preview"
    COMMITTED = "committed"
    AUDIO_READY = "audio_ready"
    AUDIO_FAILED = "audio_failed"
    INTERRUPTED = "interrupted"
    CANCELLED = "cancelled"


@dataclass
class InterventionRecord:
    intervention_id: UUID
    turn_id: str
    source_revision: int
    source_text: str
    target_text: str
    source_language: str = ""
    target_language: str = ""
    participant_id: ParticipantId = ParticipantId.LEARNER_1
    state: InterventionState = InterventionState.PREVIEW
    automatic_playback_allowed: bool = True
    audio_retry_remaining: int = 0
    asset_id: str | None = None
    cancellation_reason: str | None = None


_whitespace = re.compile(r"\s+")


def normalize_fragment(value: str) -> str:
    return _whitespace.sub(" ", unicodedata.normalize("NFKC", value)).strip().casefold()


def source_is_contained(source: str, snapshot: str) -> bool:
    normalized_source = normalize_fragment(source)
    return bool(normalized_source) and normalized_source in normalize_fragment(snapshot)


class InterventionStore:
    def __init__(self) -> None:
        self._latest_revisions: dict[str, int] = {}
        self._records: dict[UUID, InterventionRecord] = {}
        self._by_turn: dict[str, list[UUID]] = {}
        self._final_turns: set[str] = set()

    @property
    def count(self) -> int:
        return len(self._records)

    @property
    def records(self) -> tuple[InterventionRecord, ...]:
        return tuple(self._records.values())

    def note_revision(self, turn_id: str, revision: int) -> None:
        self._latest_revisions[turn_id] = max(
            revision, self._latest_revisions.get(turn_id, 0)
        )

    def preview(
        self,
        turn_id: str,
        revision: int,
        source_text: str,
        target_text: str,
        transcript_snapshot: str,
        source_language: str = "",
        target_language: str = "",
        participant_id: ParticipantId = ParticipantId.LEARNER_1,
    ) -> InterventionRecord | None:
        if turn_id in self._final_turns or revision != self._latest_revisions.get(turn_id, revision):
            return None
        if not source_is_contained(source_text, transcript_snapshot):
            return None
        normalized_source = normalize_fragment(source_text)
        for record in self.for_turn(turn_id):
            if (
                record.state is InterventionState.PREVIEW
                and normalize_fragment(record.source_text) == normalized_source
            ):
                record.source_revision = revision
                record.source_text = source_text
                record.target_text = target_text
                record.source_language = source_language
                record.target_language = target_language
                record.participant_id = participant_id
                return record
        record = InterventionRecord(
            intervention_id=uuid4(),
            turn_id=turn_id,
            source_revision=revision,
            source_text=source_text,
            target_text=target_text,
            source_language=source_language,
            target_language=target_language,
            participant_id=participant_id,
        )
        self._records[record.intervention_id] = record
        self._by_turn.setdefault(turn_id, []).append(record.intervention_id)
        return record

    def finalize_turn(self, turn_id: str) -> None:
        self._final_turns.add(turn_id)

    def reconcile_previews(
        self, turn_id: str, sources: set[str], reason: str
    ) -> list[InterventionRecord]:
        cancelled = []
        for record in self.for_turn(turn_id):
            if (
                record.state is InterventionState.PREVIEW
                and normalize_fragment(record.source_text) not in sources
            ):
                record.state = InterventionState.CANCELLED
                record.cancellation_reason = reason
                record.automatic_playback_allowed = False
                cancelled.append(record)
        return cancelled

    def commit(
        self,
        turn_id: str,
        candidate: CandidateLike,
        participant_id: ParticipantId = ParticipantId.LEARNER_1,
    ) -> InterventionRecord:
        self.finalize_turn(turn_id)
        normalized_source = normalize_fragment(candidate.source_text)
        matching: InterventionRecord | None = None
        for record in self.for_turn(turn_id):
            if (
                record.state is not InterventionState.CANCELLED
                and normalize_fragment(record.source_text) == normalized_source
            ):
                if record.state is not InterventionState.PREVIEW:
                    return record
                matching = record
                break
        if matching is None:
            matching = InterventionRecord(
                intervention_id=uuid4(),
                turn_id=turn_id,
                source_revision=self._latest_revisions.get(turn_id, 0),
                source_text=candidate.source_text,
                target_text=candidate.target_text,
                source_language=candidate.source_language,
                target_language=candidate.target_language,
                participant_id=participant_id,
            )
            self._records[matching.intervention_id] = matching
            self._by_turn.setdefault(turn_id, []).append(matching.intervention_id)
        matching.source_text = candidate.source_text
        matching.target_text = candidate.target_text
        matching.source_language = candidate.source_language
        matching.target_language = candidate.target_language
        matching.participant_id = participant_id
        matching.state = InterventionState.COMMITTED
        matching.audio_retry_remaining = 1
        matching.automatic_playback_allowed = True
        return matching

    def cancel(self, turn_id: str, reason: str) -> list[InterventionRecord]:
        cancelled: list[InterventionRecord] = []
        for record in self.for_turn(turn_id):
            if record.state is InterventionState.PREVIEW or reason == "session_ended":
                record.state = InterventionState.CANCELLED
                record.cancellation_reason = reason
                record.automatic_playback_allowed = False
                cancelled.append(record)
        return cancelled

    def mark_audio_ready(self, intervention_id: UUID, asset_id: str) -> InterventionRecord:
        record = self._records[intervention_id]
        record.asset_id = asset_id
        record.state = InterventionState.AUDIO_READY
        return record

    def mark_audio_failed(
        self, intervention_id: UUID, retry_available: bool
    ) -> InterventionRecord:
        record = self._records[intervention_id]
        record.state = InterventionState.AUDIO_FAILED
        if not retry_available:
            record.audio_retry_remaining = 0
        return record

    def consume_audio_retry(self, intervention_id: UUID) -> bool:
        record = self._records[intervention_id]
        if record.state is not InterventionState.AUDIO_FAILED or record.audio_retry_remaining <= 0:
            return False
        record.audio_retry_remaining -= 1
        record.state = InterventionState.COMMITTED
        return True

    def mark_interrupted(self, intervention_id: UUID) -> InterventionRecord:
        record = self._records[intervention_id]
        record.state = InterventionState.INTERRUPTED
        record.automatic_playback_allowed = False
        return record

    def get(self, intervention_id: UUID) -> InterventionRecord:
        return self._records[intervention_id]

    def for_turn(self, turn_id: str) -> list[InterventionRecord]:
        return [self._records[item] for item in self._by_turn.get(turn_id, [])]

    def clear(self) -> None:
        self._latest_revisions.clear()
        self._records.clear()
        self._by_turn.clear()
        self._final_turns.clear()
