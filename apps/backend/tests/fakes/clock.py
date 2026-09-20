import asyncio


async def flush_tasks(turns: int = 12) -> None:
    loop = asyncio.get_running_loop()
    for _ in range(turns):
        future: asyncio.Future[None] = loop.create_future()
        loop.call_soon(future.set_result, None)
        await future


class ManualClock:
    def __init__(self, start_ms: int = 0) -> None:
        self.current_ms = start_ms
        self._waiters: list[tuple[int, asyncio.Future[None]]] = []

    def now_ms(self) -> int:
        return self.current_ms

    async def sleep_ms(self, milliseconds: int) -> None:
        if milliseconds <= 0:
            return
        future: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._waiters.append((self.current_ms + milliseconds, future))
        try:
            await future
        finally:
            self._waiters = [item for item in self._waiters if item[1] is not future]

    def advance(self, milliseconds: int) -> None:
        self.current_ms += milliseconds
        for target, future in tuple(self._waiters):
            if target <= self.current_ms and not future.done():
                future.set_result(None)

    async def advance_and_flush(self, milliseconds: int) -> None:
        await flush_tasks()
        self.advance(milliseconds)
        await flush_tasks()
