import pytest

from language_coach.domain.models import ConversationMode, ParticipantId
from language_coach.domain.speaker_mapping import SpeakerMapping, SpeakerSwapUnavailable


def test_default_mode_maps_first_two_human_speakers() -> None:
    mapping = SpeakerMapping(ConversationMode.LEARNER_FLUENT)
    assert mapping.observe("A", 100, False) is ParticipantId.LEARNER_1
    assert mapping.observe("B", 500, False) is ParticipantId.FLUENT_PARTNER
    assert mapping.observe("A", 100, False) is ParticipantId.LEARNER_1


def test_two_learner_mode_maps_and_swaps() -> None:
    mapping = SpeakerMapping(ConversationMode.TWO_LEARNERS)
    mapping.observe("A", 100, False)
    mapping.observe("B", 500, False)
    mapping.swap_learners()
    assert mapping.participant_for("A") is ParticipantId.LEARNER_2
    assert mapping.participant_for("B") is ParticipantId.LEARNER_1


def test_playback_overlap_cannot_create_a_mapping() -> None:
    mapping = SpeakerMapping(ConversationMode.TWO_LEARNERS)
    assert mapping.observe("phone-speaker", 900, True) is None
    assert mapping.labels == {}


def test_swap_requires_two_learners() -> None:
    mapping = SpeakerMapping(ConversationMode.TWO_LEARNERS)
    mapping.observe("A", 100, False)
    with pytest.raises(SpeakerSwapUnavailable):
        mapping.swap_learners()
