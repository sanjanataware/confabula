import secrets


class PairingToken:
    def __init__(self, value: str | None = None) -> None:
        self._value = value or secrets.token_urlsafe(32)
        if len(self._value) < 32:
            raise ValueError("pairing token must contain at least 32 characters")

    @property
    def value(self) -> str:
        return self._value

    def verify(self, candidate: str) -> bool:
        return secrets.compare_digest(self._value.encode(), candidate.encode())
