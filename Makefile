.PHONY: backend-test client-test check dev-cert backend-dev client-web client-android e2e provider-smoke elevenlabs-smoke

backend-test:
	cd apps/backend && uv run pytest -m "not live_provider"

client-test:
	cd apps/client && npm test -- --runInBand

dev-cert:
	./scripts/dev-cert.sh

backend-dev:
	./scripts/dev-backend.sh web

client-web:
	./scripts/dev-client.sh web

client-android:
	./scripts/dev-client.sh android

e2e:
	cd apps/client && npx playwright test e2e/setup-and-intervention.spec.ts

provider-smoke:
	cd apps/backend && RUN_LIVE_PROVIDER_TESTS=1 uv run --env-file ../../.env pytest tests/live/test_muse_live.py tests/live/test_spark_live.py -v

elevenlabs-smoke:
	cd apps/backend && RUN_LIVE_PROVIDER_TESTS=1 uv run --env-file ../../.env pytest tests/live/test_elevenlabs_live.py -v

check: backend-test client-test
	cd apps/backend && uv run ruff check src tests
	cd apps/backend && uv run mypy src
	cd apps/client && npx tsc --noEmit
