import os

import pytest


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    if os.getenv("RUN_LIVE_PROVIDER_TESTS") == "1":
        return
    skip = pytest.mark.skip(reason="live provider tests are opt-in")
    for item in items:
        if "live_provider" in item.keywords:
            item.add_marker(skip)
