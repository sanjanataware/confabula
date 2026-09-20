from dataclasses import dataclass
from typing import Literal

TtsRouteKind = Literal["flash", "v3_conversational"]
TtsOperation = Literal["text_to_speech", "text_to_dialogue"]


class UnsupportedLanguageError(ValueError):
    pass


@dataclass(frozen=True)
class TtsRouteDescriptor:
    kind: TtsRouteKind
    operation: TtsOperation
    model_id: str
    output_format: str


@dataclass(frozen=True)
class LanguageCapability:
    code: str
    display_name: str
    muse_bias_name: str
    eleven_language_code: str
    tts_route: TtsRouteDescriptor


FLASH_ROUTE = TtsRouteDescriptor(
    kind="flash",
    operation="text_to_speech",
    model_id="eleven_flash_v2_5",
    output_format="mp3_44100_128",
)
V3_ROUTE = TtsRouteDescriptor(
    kind="v3_conversational",
    operation="text_to_dialogue",
    model_id="eleven_v3_conversational",
    output_format="mp3_44100_128",
)

LANGUAGE_ROWS = (
    ("ar", "Arabic", "Arabic", "ar", "flash"),
    ("bn", "Bengali", "Bengali", "bn", "v3_conversational"),
    ("nl", "Dutch", "Dutch", "nl", "flash"),
    ("en", "English", "English", "en", "flash"),
    ("fr", "French", "French", "fr", "flash"),
    ("de", "German", "German", "de", "flash"),
    ("he", "Hebrew", "Hebrew", "he", "v3_conversational"),
    ("hi", "Hindi", "Hindi", "hi", "flash"),
    ("id", "Indonesian", "Indonesian", "id", "flash"),
    ("it", "Italian", "Italian", "it", "flash"),
    ("ja", "Japanese", "Japanese", "ja", "flash"),
    ("kn", "Kannada", "Kannada", "kn", "v3_conversational"),
    ("ko", "Korean", "Korean", "ko", "flash"),
    ("ms", "Malay", "Malay", "ms", "flash"),
    ("zh", "Mandarin Chinese", "Mandarin Chinese", "zh", "flash"),
    ("mr", "Marathi", "Marathi", "mr", "v3_conversational"),
    ("pl", "Polish", "Polish", "pl", "flash"),
    ("pt", "Portuguese", "Portuguese", "pt", "flash"),
    ("es", "Spanish", "Spanish", "es", "flash"),
    ("fil", "Tagalog", "Tagalog", "fil", "flash"),
    ("ta", "Tamil", "Tamil", "ta", "flash"),
    ("te", "Telugu", "Telugu", "te", "v3_conversational"),
    ("th", "Thai", "Thai", "th", "v3_conversational"),
    ("tr", "Turkish", "Turkish", "tr", "flash"),
    ("vi", "Vietnamese", "Vietnamese", "vi", "flash"),
)

_ROUTES: dict[str, TtsRouteDescriptor] = {
    "flash": FLASH_ROUTE,
    "v3_conversational": V3_ROUTE,
}

CAPABILITIES: dict[str, LanguageCapability] = {
    code: LanguageCapability(code, display_name, muse_name, eleven_code, _ROUTES[route])
    for code, display_name, muse_name, eleven_code, route in LANGUAGE_ROWS
}


def validate_capabilities() -> None:
    for capability in CAPABILITIES.values():
        route = capability.tts_route
        if not all(
            (
                capability.muse_bias_name,
                capability.eleven_language_code,
                route.operation,
                route.model_id,
                route.output_format,
            )
        ):
            raise RuntimeError(f"incomplete capability route for {capability.code}")


def get_capability(language_code: str) -> LanguageCapability:
    try:
        return CAPABILITIES[language_code]
    except KeyError as error:
        raise UnsupportedLanguageError("unsupported language") from error


def get_tts_route(language_code: str) -> TtsRouteDescriptor:
    return get_capability(language_code).tts_route


validate_capabilities()
