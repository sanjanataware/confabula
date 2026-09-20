import json
from pathlib import Path

from language_coach.protocol.models import ClientMessageAdapter, ServerEventAdapter

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "packages" / "protocol" / "v1"


def write_schema(name: str, schema: dict[str, object]) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT / name
    target.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")


def main() -> None:
    write_schema("client-messages.schema.json", ClientMessageAdapter.json_schema())
    write_schema("server-events.schema.json", ServerEventAdapter.json_schema())


if __name__ == "__main__":
    main()
