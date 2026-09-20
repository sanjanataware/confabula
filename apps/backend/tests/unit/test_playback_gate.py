from language_coach.domain.playback_gate import PlaybackGate


def test_audio_becomes_eligible_after_600_ms_of_quiet() -> None:
    gate = PlaybackGate(quiet_grace_ms=600)
    gate.on_speech_completed("turn-a", 1000)
    gate.on_audio_ready("intervention-a")
    assert gate.reserve_eligible(1599) is None
    assert gate.reserve_eligible(1600) == "intervention-a"
    assert gate.reserve_eligible(1600) is None


def test_new_speech_defers_queued_audio() -> None:
    gate = PlaybackGate(quiet_grace_ms=600)
    gate.on_speech_completed("turn-a", 1000)
    gate.on_audio_ready("intervention-a")
    gate.on_speech_started("turn-b", 1500, True)
    assert gate.reserve_eligible(2500) is None
    gate.on_speech_completed("turn-b", 2600)
    assert gate.reserve_eligible(3200) == "intervention-a"


def test_barge_in_marks_clip_manual_only() -> None:
    gate = PlaybackGate(quiet_grace_ms=600)
    gate.on_speech_completed("turn-a", 1000)
    gate.on_audio_ready("intervention-a")
    assert gate.reserve_eligible(1600) == "intervention-a"
    gate.on_playback_started("intervention-a", 2000, False)
    assert gate.on_speech_started("turn-b", 2050, True) == "intervention-a"
    assert gate.reserve_eligible(5000) is None
    assert gate.can_manual_replay("intervention-a")
