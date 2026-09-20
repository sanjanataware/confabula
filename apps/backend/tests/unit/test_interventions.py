from language_coach.domain.interventions import InterventionStore


def test_obsolete_preview_result_is_discarded() -> None:
    store = InterventionStore()
    store.note_revision("turn-a", 3)
    result = store.preview(
        "turn-a", 2, "grocery store", "supermercado", "Necesito grocery store"
    )
    assert result is None


def test_source_must_exist_in_snapshot_after_normalization() -> None:
    store = InterventionStore()
    store.note_revision("turn-a", 1)
    result = store.preview(
        "turn-a", 1, "train station", "estacion de tren", "Necesito grocery store"
    )
    assert result is None


def test_matching_preview_keeps_stable_identity() -> None:
    store = InterventionStore()
    store.note_revision("turn-a", 1)
    first = store.preview(
        "turn-a", 1, "grocery store", "supermercado", "Necesito grocery store"
    )
    store.note_revision("turn-a", 2)
    second = store.preview(
        "turn-a", 2, "grocery store", "el supermercado", "Necesito grocery store"
    )
    assert first is not None and second is not None
    assert first.intervention_id == second.intervention_id
