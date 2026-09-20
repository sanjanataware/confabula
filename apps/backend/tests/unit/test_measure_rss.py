from types import SimpleNamespace

from scripts.measure_rss import MIB, measure_rss


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class FakeProcess:
    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock

    def memory_info(self) -> object:
        return SimpleNamespace(rss=int((100 + self.clock.now) * MIB))


def test_measurement_uses_first_post_warmup_sample() -> None:
    clock = FakeClock()
    result = measure_rss(
        FakeProcess(clock),
        clock,
        warmup_seconds=5,
        total_seconds=10,
        sample_seconds=2,
        max_growth_mib=6,
    )
    assert result.baseline_bytes == 106 * MIB
    assert result.final_bytes == 110 * MIB
    assert result.growth_bytes == 4 * MIB
    assert result.passed


def test_measurement_fails_above_threshold() -> None:
    clock = FakeClock()
    result = measure_rss(
        FakeProcess(clock),
        clock,
        warmup_seconds=0,
        total_seconds=10,
        sample_seconds=5,
        max_growth_mib=9,
    )
    assert not result.passed
