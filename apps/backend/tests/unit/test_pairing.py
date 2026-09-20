from language_coach.services.pairing import PairingToken


def test_pairing_token_verifies_candidates() -> None:
    token = PairingToken("a" * 43)
    assert token.verify("a" * 43)
    assert not token.verify("b" * 43)
    assert not token.verify("é" * 43)
    assert not token.verify("")
