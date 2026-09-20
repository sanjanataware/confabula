import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

from openai import APIError, APITimeoutError, LengthFinishReasonError
from pydantic import ValidationError

from language_coach.domain.interventions import source_is_contained
from language_coach.providers.interfaces import (
    AnalysisRequest,
    AnalysisUnavailable,
    InterventionAnalysis,
    InterventionCandidate,
)

SYSTEM_INSTRUCTION = """Identify only exact, short spans the active learner spoke in their configured native language because they lacked the learning-language wording. A short standalone native-language fallback may be the whole turn. Do not translate a complete mixed-language turn, a long native-language monologue, or ordinary learning-language grammar. Return an empty interventions list when the turn stays in the learning language or evidence is uncertain. Preserve each exact source substring and translate it into the configured learning language. Surrounding turns are context only and must never be extracted."""


class MuseSparkAnalyzer:
    def __init__(
        self,
        client: Any,
        model: str = "muse-spark-1.3",
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        speculative_timeout_s: float = 8,
        final_timeout_s: float = 12,
        reasoning_effort: str = "minimal",
        speculative_max_tokens: int = 384,
        final_max_tokens: int = 384,
    ) -> None:
        self._client = client
        self._model = model
        self._sleep = sleep
        self._speculative_timeout_s = speculative_timeout_s
        self._final_timeout_s = final_timeout_s
        self._reasoning_effort = reasoning_effort
        self._speculative_max_tokens = speculative_max_tokens
        self._final_max_tokens = final_max_tokens

    async def analyze(self, request: AnalysisRequest) -> InterventionAnalysis:
        attempts = 2 if request.final else 1
        timeout_s = self._final_timeout_s if request.final else self._speculative_timeout_s
        for attempt in range(attempts):
            try:
                response = await self._request(request, timeout_s)
                return self._validate(response, request)
            except (TimeoutError, APIError) as error:
                if attempt + 1 >= attempts or not self._is_transient(error):
                    raise AnalysisUnavailable("Muse Spark analysis unavailable") from None
                await self._sleep(0.1)
            except (
                ValidationError,
                LengthFinishReasonError,
                AttributeError,
                IndexError,
                TypeError,
                ValueError,
            ):
                raise AnalysisUnavailable("Muse Spark returned invalid output") from None
        raise AnalysisUnavailable("Muse Spark analysis unavailable")

    async def _request(self, request: AnalysisRequest, timeout_s: float) -> Any:
        user_payload = {
            "participant": request.participant,
            "native_language": request.native_language,
            "learning_language": request.learning_language,
            "transcript": request.transcript,
            "context": list(request.context[-2:]),
        }
        async with asyncio.timeout(timeout_s):
            return await self._client.beta.chat.completions.parse(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_INSTRUCTION},
                    {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
                ],
                response_format=InterventionAnalysis,
                reasoning_effort=self._reasoning_effort,
                prompt_cache_key="language-coach-code-switch-v1",
                max_tokens=(
                    self._final_max_tokens if request.final
                    else self._speculative_max_tokens
                ),
                timeout=timeout_s,
            )

    @staticmethod
    def _validate(response: Any, request: AnalysisRequest) -> InterventionAnalysis:
        parsed = response.choices[0].message.parsed
        if not isinstance(parsed, InterventionAnalysis):
            raise TypeError("missing structured response")
        analysis = InterventionAnalysis.model_validate(parsed.model_dump())
        for candidate in analysis.interventions:
            if candidate.source_language.casefold() != request.native_language.casefold():
                raise ValueError("unexpected source language")
            if candidate.target_language.casefold() != request.learning_language.casefold():
                raise ValueError("unexpected target language")
            if not source_is_contained(candidate.source_text, request.transcript):
                raise ValueError("source absent from transcript")
        return analysis

    @staticmethod
    def _is_transient(error: BaseException) -> bool:
        if isinstance(error, (TimeoutError, APITimeoutError)):
            return True
        return getattr(error, "status_code", None) in {429, 500, 503}


__all__ = [
    "AnalysisRequest",
    "AnalysisUnavailable",
    "InterventionAnalysis",
    "InterventionCandidate",
    "MuseSparkAnalyzer",
]
