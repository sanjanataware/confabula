from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from openai import APIStatusError, APITimeoutError

from language_coach.providers.muse_spark import (
    AnalysisRequest,
    AnalysisUnavailable,
    InterventionAnalysis,
    MuseSparkAnalyzer,
)

REQUEST = AnalysisRequest(
    "learner_1", "English", "Spanish", "Necesito ir al grocery store", (), True
)
POSITIVE = {"interventions": [{
    "source_text": "grocery store", "source_language": "English",
    "target_text": "supermercado", "target_language": "Spanish",
}]}


class FakeCompletions:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, object]] = []

    async def parse(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        parsed = InterventionAnalysis.model_validate(response) if response is not None else None
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=parsed))])


def fake_client(*responses: object):
    completions = FakeCompletions(*responses)
    return SimpleNamespace(beta=SimpleNamespace(chat=SimpleNamespace(completions=completions))), completions


@pytest.mark.asyncio
async def test_positive_result_returns_only_native_fragment_and_two_context_turns() -> None:
    client, completions = fake_client(POSITIVE)
    result = await MuseSparkAnalyzer(client).analyze(replace(REQUEST, context=("old", "prior", "recent")))
    assert result.interventions[0].source_text == "grocery store"
    assert result.interventions[0].source_language == "English"
    assert result.interventions[0].target_text == "supermercado"
    assert result.interventions[0].target_language == "Spanish"
    assert len(completions.calls) == 1
    assert completions.calls[0]["model"] == "muse-spark-1.3"
    assert completions.calls[0]["reasoning_effort"] == "minimal"
    assert completions.calls[0]["prompt_cache_key"] == "language-coach-code-switch-v1"
    assert completions.calls[0]["max_tokens"] == 384
    assert completions.calls[0]["timeout"] == 12
    assert '"old"' not in completions.calls[0]["messages"][1]["content"]


@pytest.mark.asyncio
async def test_speculative_request_uses_the_lower_latency_budget() -> None:
    client, completions = fake_client(POSITIVE)
    await MuseSparkAnalyzer(client).analyze(replace(REQUEST, final=False))
    assert completions.calls[0]["model"] == "muse-spark-1.3"
    assert completions.calls[0]["reasoning_effort"] == "minimal"
    assert completions.calls[0]["prompt_cache_key"] == "language-coach-code-switch-v1"
    assert completions.calls[0]["max_tokens"] == 384
    assert completions.calls[0]["timeout"] == 8


@pytest.mark.asyncio
async def test_empty_result_means_no_help() -> None:
    client, _ = fake_client({"interventions": []})
    result = await MuseSparkAnalyzer(client).analyze(REQUEST)
    assert result.interventions == []


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [
    None,
    {"interventions": [{"source_text": "grocery store"}]},
    {"interventions": [], "unexpected": True},
    {"interventions": [*POSITIVE["interventions"]] * 4},
    {"interventions": [{**POSITIVE["interventions"][0], "source_text": "absent-source"}]},
    {"interventions": [{**POSITIVE["interventions"][0], "source_language": "French"}]},
    {"interventions": [{**POSITIVE["interventions"][0], "target_language": "French"}]},
    {"interventions": [{**POSITIVE["interventions"][0], "target_text": "   "}]},
])
async def test_invalid_responses_are_rejected_without_retry(response: object) -> None:
    client, completions = fake_client(response)
    with pytest.raises(AnalysisUnavailable):
        await MuseSparkAnalyzer(client).analyze(REQUEST)
    assert len(completions.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [429, 500, 503, "timeout"])
async def test_final_retries_one_transient_failure(status: int | str) -> None:
    request = httpx.Request("POST", "https://api.meta.ai/v1/chat/completions")
    error = APITimeoutError(request=request) if status == "timeout" else APIStatusError(
        "private-provider-error", response=httpx.Response(status, request=request), body=None,
    )
    client, completions = fake_client(error, POSITIVE)
    delays: list[float] = []

    async def sleep(delay: float) -> None:
        delays.append(delay)

    result = await MuseSparkAnalyzer(client, sleep=sleep).analyze(REQUEST)
    assert result.interventions
    assert len(completions.calls) == 2
    assert delays == [0.1]


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "final"), [(401, True), (400, True), (502, True), (429, False)])
async def test_nontransient_and_speculative_calls_never_retry(status: int, final: bool) -> None:
    request = httpx.Request("POST", "https://api.meta.ai/v1/chat/completions")
    error = APIStatusError("private-provider-error", response=httpx.Response(status, request=request), body=None)
    client, completions = fake_client(error, POSITIVE)
    with pytest.raises(AnalysisUnavailable) as caught:
        await MuseSparkAnalyzer(client).analyze(replace(REQUEST, final=final))
    assert len(completions.calls) == 1
    assert "private-provider-error" not in str(caught.value)
