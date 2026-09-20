import asyncio

from language_coach.providers.kokoro import KokoroSpeechSynthesizer


async def main() -> int:
    synthesizer = KokoroSpeechSynthesizer()
    await synthesizer.prepare()
    if not synthesizer.available:
        print("Local neural speech is unavailable; device speech fallback will be used.")
        return 1
    print("Kokoro local neural speech is downloaded and ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
