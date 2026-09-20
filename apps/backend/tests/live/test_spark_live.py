import os

import pytest
from openai import AsyncOpenAI

from language_coach.providers.muse_spark import AnalysisRequest, MuseSparkAnalyzer

pytestmark = pytest.mark.live_provider


@pytest.mark.asyncio
async def test_spark_positive_and_empty_live() -> None:
    if not os.getenv("MUSE_API_KEY"):
        pytest.fail("Missing required variables: MUSE_API_KEY")
    client = AsyncOpenAI(
        api_key=os.environ["MUSE_API_KEY"],
        base_url="https://api.meta.ai/v1",
        max_retries=0,
    )
    analyzer = MuseSparkAnalyzer(client)
    positive = await analyzer.analyze(
        AnalysisRequest(
            "learner_1",
            "English",
            "Spanish",
            "Necesito ir al grocery store",
            (),
            True,
        )
    )
    empty = await analyzer.analyze(
        AnalysisRequest("learner_1", "English", "Spanish", "Todo está bien", (), True)
    )
    assert positive.interventions
    assert empty.interventions == []
