import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from language_coach.api.http import router as http_router
from language_coach.api.websocket import router as websocket_router
from language_coach.composition import AppDependencies, build_production_dependencies
from language_coach.services.safe_logging import configure_safe_logging, log_event
from language_coach.services.session_registry import SessionRegistry


def create_app(dependencies: AppDependencies | None = None) -> FastAPI:
    configure_safe_logging()
    configured = dependencies or build_production_dependencies()
    show_banner = dependencies is None

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if configured.prepare_speech is not None:
            await configured.prepare_speech()
        registry = SessionRegistry(configured)
        app.state.registry = registry
        if show_banner:
            print(
                "Conversation Language Coach ready\n"
                f"Backend: {configured.settings.backend_public_base_url}\n"
                f"Pairing token: {configured.pairing_token.value}"
            )
        try:
            yield
        finally:
            await registry.shutdown()
            if configured.close_providers is not None:
                await configured.close_providers()

    app = FastAPI(title="Conversation Language Coach", lifespan=lifespan)
    app.state.dependencies = configured
    app.state.settings = configured.settings
    app.state.pairing_token = configured.pairing_token
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured.settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.include_router(http_router)
    app.include_router(websocket_router)

    @app.middleware("http")
    async def safe_access(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        started = time.monotonic()
        response = await call_next(request)
        route = request.scope.get("route")
        name = getattr(route, "name", "unknown")
        event_type = f"http.{name}" if name in {"health", "capabilities", "session_audio"} else "http.other"
        log_event(logging.getLogger("language_coach.access"), logging.INFO, event_type, {
            "status_code": response.status_code,
            "duration_ms": int((time.monotonic() - started) * 1000),
        })
        return response

    return app


app = create_app()
