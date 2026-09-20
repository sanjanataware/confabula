from dataclasses import replace

from language_coach.domain.models import TurnRecord


class TranscriptConflictError(RuntimeError):
    pass


class TranscriptStore:
    def __init__(self) -> None:
        self._turns: dict[str, TurnRecord] = {}

    @property
    def count(self) -> int:
        return len(self._turns)

    def start(self, turn_id: str, started_at_ms: int) -> TurnRecord:
        record = self._turns.setdefault(turn_id, TurnRecord(turn_id=turn_id))
        if record.started_at_ms is None:
            record.started_at_ms = started_at_ms
        return record

    def apply_partial(self, turn_id: str, revision: int, text: str) -> TurnRecord:
        record = self._turns.setdefault(turn_id, TurnRecord(turn_id=turn_id))
        if not record.final and revision > record.revision:
            record.revision = revision
            record.text = text
        return record

    def finalize(
        self,
        turn_id: str,
        speaker_label: str | None,
        text: str,
        completed_at_ms: int,
    ) -> TurnRecord:
        record = self._turns.setdefault(turn_id, TurnRecord(turn_id=turn_id))
        if record.final:
            if (
                record.speaker_label == speaker_label
                and record.text == text
                and record.completed_at_ms == completed_at_ms
            ):
                return record
            raise TranscriptConflictError("conflicting completion for finalized turn")
        record.text = text
        record.speaker_label = speaker_label
        record.completed_at_ms = completed_at_ms
        record.final = True
        return record

    def get(self, turn_id: str) -> TurnRecord:
        return self._turns[turn_id]

    def context_before(self, turn_id: str, limit: int = 2) -> list[TurnRecord]:
        if limit <= 0:
            return []
        current = self._turns.get(turn_id)
        current_start = current.started_at_ms if current else None
        candidates = [
            record
            for key, record in self._turns.items()
            if key != turn_id
            and record.final
            and (
                current_start is None
                or record.started_at_ms is None
                or record.started_at_ms < current_start
            )
        ]
        candidates.sort(
            key=lambda record: (
                record.started_at_ms if record.started_at_ms is not None else -1,
                record.turn_id,
            )
        )
        return [replace(record) for record in candidates[-max(0, limit) :]]

    def clear(self) -> None:
        self._turns.clear()
