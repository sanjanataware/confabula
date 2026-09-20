from language_coach.domain.models import ConversationMode, ParticipantId


class ProviderOrderingError(RuntimeError):
    pass


class SpeakerSwapUnavailable(RuntimeError):
    pass


class SpeakerMapping:
    def __init__(self, mode: ConversationMode) -> None:
        self.mode = ConversationMode(mode)
        self._labels: dict[str, ParticipantId] = {}
        self._first_audio_ms: dict[str, int] = {}
        self._last_new_label_ms: int | None = None

    @property
    def labels(self) -> dict[str, ParticipantId]:
        return dict(self._labels)

    def participant_for(self, label: str) -> ParticipantId | None:
        return self._labels.get(label)

    def observe(
        self,
        label: str,
        first_audio_ms: int,
        overlaps_playback: bool,
    ) -> ParticipantId | None:
        existing = self._labels.get(label)
        if existing is not None:
            return existing
        if overlaps_playback:
            return None
        capacity = 2
        if len(self._labels) >= capacity:
            return None
        if self._last_new_label_ms is not None and first_audio_ms < self._last_new_label_ms:
            raise ProviderOrderingError("speaker observations arrived out of order")
        if not self._labels:
            participant = ParticipantId.LEARNER_1
        elif self.mode is ConversationMode.TWO_LEARNERS:
            participant = ParticipantId.LEARNER_2
        else:
            participant = ParticipantId.FLUENT_PARTNER
        self._labels[label] = participant
        self._first_audio_ms[label] = first_audio_ms
        self._last_new_label_ms = first_audio_ms
        return participant

    def swap_learners(self) -> None:
        learner_1_label = next(
            (label for label, value in self._labels.items() if value is ParticipantId.LEARNER_1),
            None,
        )
        learner_2_label = next(
            (label for label, value in self._labels.items() if value is ParticipantId.LEARNER_2),
            None,
        )
        if learner_1_label is None or learner_2_label is None:
            raise SpeakerSwapUnavailable("two mapped learners are required")
        self._labels[learner_1_label] = ParticipantId.LEARNER_2
        self._labels[learner_2_label] = ParticipantId.LEARNER_1

    def clear(self) -> None:
        self._labels.clear()
        self._first_audio_ms.clear()
        self._last_new_label_ms = None
