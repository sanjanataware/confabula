from language_coach.protocol.models import (
    ClientMessage,
    ClientMessageAdapter,
    ServerEvent,
)


def parse_client_message(raw: str) -> ClientMessage:
    return ClientMessageAdapter.validate_json(raw)


def encode_server_event(event: ServerEvent) -> str:
    return event.model_dump_json()
