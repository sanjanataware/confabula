from language_coach.domain.transcript_store import TranscriptStore


def test_cumulative_partial_replaces_instead_of_appending() -> None:
    store = TranscriptStore()
    store.apply_partial("turn-a", 1, "Necesito the")
    store.apply_partial("turn-a", 2, "Necesito the grocery store")
    assert store.get("turn-a").text == "Necesito the grocery store"


def test_stale_partial_cannot_replace_newer_text() -> None:
    store = TranscriptStore()
    store.apply_partial("turn-a", 4, "new text")
    store.apply_partial("turn-a", 3, "old text")
    assert store.get("turn-a").text == "new text"


def test_overlapping_turns_may_complete_out_of_order() -> None:
    store = TranscriptStore()
    store.apply_partial("turn-a", 1, "first")
    store.apply_partial("turn-b", 1, "second")
    store.finalize("turn-b", "speaker-b", "second final", 200)
    store.finalize("turn-a", "speaker-a", "first final", 250)
    assert store.get("turn-a").speaker_label == "speaker-a"
    assert store.get("turn-b").speaker_label == "speaker-b"
