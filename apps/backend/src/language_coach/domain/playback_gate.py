from collections import deque


class PlaybackGate:
    def __init__(self, quiet_grace_ms: int = 600) -> None:
        self.quiet_grace_ms = quiet_grace_ms
        self.active_human_turns: set[str] = set()
        self.last_human_activity_ms: int | None = None
        self.playing: str | None = None
        self.reservation: str | None = None
        self.reservation_generation = 0
        self.suspended = False
        self._ready: deque[str] = deque()
        self._has_audio: set[str] = set()
        self._manual_only: set[str] = set()
        self._stop_requested: set[str] = set()
        self._cancelled_requests: set[str] = set()

    def on_speech_started(
        self, turn_id: str, at_ms: int, confirmed_human: bool
    ) -> str | None:
        if not confirmed_human:
            return None
        self.active_human_turns.add(turn_id)
        self.last_human_activity_ms = at_ms
        if self.reservation is not None:
            reserved = self.reservation
            self._ready.appendleft(reserved)
            self._cancelled_requests.add(reserved)
            self.reservation = None
            return reserved
        if self.playing is not None and self.playing not in self._stop_requested:
            self._manual_only.add(self.playing)
            self._stop_requested.add(self.playing)
            return self.playing
        return None

    def on_speech_completed(self, turn_id: str, at_ms: int) -> None:
        self.active_human_turns.discard(turn_id)
        self.last_human_activity_ms = at_ms

    def on_audio_ready(self, intervention_id: str) -> None:
        if intervention_id in self._has_audio:
            return
        self._has_audio.add(intervention_id)
        self._ready.append(intervention_id)

    def reserve_eligible(self, at_ms: int) -> str | None:
        if (
            self.suspended
            or self.active_human_turns
            or self.playing is not None
            or self.reservation is not None
            or (
                self.last_human_activity_ms is not None
                and at_ms - self.last_human_activity_ms < self.quiet_grace_ms
            )
        ):
            return None
        while self._ready:
            candidate = self._ready.popleft()
            if candidate not in self._manual_only:
                self.reservation = candidate
                self.reservation_generation += 1
                self._cancelled_requests.discard(candidate)
                return candidate
        return None

    def on_playback_started(
        self, intervention_id: str, at_ms: int, manual: bool
    ) -> bool:
        del at_ms
        if self.suspended or intervention_id not in self._has_audio:
            return False
        if self.playing is not None:
            return False
        if not manual and self.reservation != intervention_id:
            return False
        if manual and self.reservation not in {None, intervention_id}:
            return False
        self.reservation = None
        self.playing = intervention_id
        self._ready = deque(item for item in self._ready if item != intervention_id)
        self._manual_only.add(intervention_id)
        self._stop_requested.discard(intervention_id)
        self._cancelled_requests.discard(intervention_id)
        return True

    def on_playback_ended(self, intervention_id: str, at_ms: int) -> bool:
        del at_ms
        if self.playing != intervention_id:
            return False
        self.playing = None
        self._stop_requested.discard(intervention_id)
        return True

    def on_playback_interrupted(self, intervention_id: str, at_ms: int) -> bool:
        if intervention_id in self._cancelled_requests and self.playing != intervention_id:
            self._cancelled_requests.discard(intervention_id)
            return False
        if self.playing == intervention_id:
            return self.on_playback_ended(intervention_id, at_ms)
        if self.reservation == intervention_id:
            self.on_start_timeout(intervention_id)
            return True
        return False

    def on_start_timeout(self, intervention_id: str, generation: int | None = None) -> None:
        if self.reservation == intervention_id and (
            generation is None or generation == self.reservation_generation
        ):
            self.reservation = None
            self._manual_only.add(intervention_id)

    def can_manual_replay(self, intervention_id: str) -> bool:
        return intervention_id in self._has_audio

    def handle_connection_lost(self) -> str | None:
        self.suspended = True
        active = self.playing or self.reservation
        if active is not None:
            self._cancelled_requests.discard(active)
            self._manual_only.add(active)
            self.on_playback_interrupted(active, 0)
        return active

    def clear(self) -> None:
        self.active_human_turns.clear()
        self.last_human_activity_ms = None
        self.playing = None
        self.reservation = None
        self._ready.clear()
        self._has_audio.clear()
        self._manual_only.clear()
        self._stop_requested.clear()
        self._cancelled_requests.clear()
        self.suspended = True
