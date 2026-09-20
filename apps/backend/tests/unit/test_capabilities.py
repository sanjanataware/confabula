from language_coach.services.capabilities import CAPABILITIES, get_tts_route


def test_all_muse_languages_have_tts_routes() -> None:
    assert len(CAPABILITIES) == 25
    assert all(item.muse_bias_name for item in CAPABILITIES.values())
    assert all(item.eleven_language_code for item in CAPABILITIES.values())
    assert all(
        item.tts_route.output_format == "mp3_44100_128"
        for item in CAPABILITIES.values()
    )


def test_bengali_uses_v3_fallback() -> None:
    assert get_tts_route("bn").kind == "v3_conversational"
    assert get_tts_route("bn").operation == "text_to_dialogue"


def test_spanish_uses_flash() -> None:
    assert get_tts_route("es").kind == "flash"
    assert get_tts_route("es").model_id == "eleven_flash_v2_5"
