import argparse
import time
from dataclasses import dataclass
from typing import Protocol

import psutil

MIB = 1024 * 1024


class MemoryInfo(Protocol):
    @property
    def rss(self) -> int: ...


class ProcessLike(Protocol):
    def memory_info(self) -> MemoryInfo: ...


class ClockLike(Protocol):
    def monotonic(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...


class SystemClock:
    def monotonic(self) -> float:
        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)


@dataclass(frozen=True)
class RssMeasurement:
    baseline_bytes: int
    final_bytes: int
    growth_bytes: int
    passed: bool


def measure_rss(
    process: ProcessLike,
    clock: ClockLike,
    warmup_seconds: float,
    total_seconds: float,
    sample_seconds: float,
    max_growth_mib: float,
) -> RssMeasurement:
    if warmup_seconds < 0 or total_seconds < warmup_seconds or sample_seconds <= 0:
        raise ValueError("invalid measurement intervals")
    started = clock.monotonic()
    baseline: int | None = None
    final = 0
    while True:
        elapsed = clock.monotonic() - started
        info = process.memory_info()
        rss = int(info.rss)
        if baseline is None and elapsed >= warmup_seconds:
            baseline = rss
        if elapsed >= total_seconds:
            final = rss
            break
        clock.sleep(min(sample_seconds, total_seconds - elapsed))
    if baseline is None:
        baseline = final
    growth = final - baseline
    return RssMeasurement(
        baseline_bytes=baseline,
        final_bytes=final,
        growth_bytes=growth,
        passed=growth <= max_growth_mib * MIB,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--warmup-seconds", type=float, default=300)
    parser.add_argument("--total-seconds", type=float, default=1200)
    parser.add_argument("--sample-seconds", type=float, default=5)
    parser.add_argument("--max-growth-mib", type=float, default=50)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = measure_rss(
            psutil.Process(args.pid),
            SystemClock(),
            args.warmup_seconds,
            args.total_seconds,
            args.sample_seconds,
            args.max_growth_mib,
        )
    except psutil.Error as error:
        print(f"RSS measurement failed: {error.__class__.__name__}")
        return 2
    print(f"Baseline RSS: {result.baseline_bytes / MIB:.2f} MiB")
    print(f"Final RSS: {result.final_bytes / MIB:.2f} MiB")
    print(f"Growth: {result.growth_bytes / MIB:.2f} MiB")
    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
