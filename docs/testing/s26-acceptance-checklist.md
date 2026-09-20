# S26 Ultra acceptance checklist

Record device, OS and app versions, timing metadata, and pass/fail only. Never record speech, transcript text, or audio.

## Audio contract

- [ ] Record the observed native callback sample rate and channel count in diagnostics.
- [ ] Every emitted Muse frame is 3,840 bytes.
- [ ] Thirty seconds of continuous speech produces frames without stalls.
- [ ] Stop releases the microphone indicator.
- [ ] Permission denial returns to an actionable state.

## Conversation behavior

- [ ] Learner-plus-fluent mode maps the first and second human speakers correctly.
- [ ] Two-learner mode maps both learners and **Swap speakers** reverses their assignments.
- [ ] A target-language-only conversation produces no intervention.
- [ ] A native-language insertion produces one concise source-to-target card.
- [ ] Audio waits through speech and starts after at least 600 ms of quiet.
- [ ] Human barge-in stops audio while replay remains available.
- [ ] Ten generated phrases create no participant, intervention, or feedback loop.
- [ ] Kokoro neural speech is natural and timely for Spanish plus another supported language.
- [ ] Device fallback plays representative unsupported Latin, CJK, and Indic learning languages.
- [ ] A missing system voice leaves the card visible and reports recoverable playback failure.

## Recovery and limits

- [ ] Disconnect/resume within 15 seconds preserves speaker mappings.
- [ ] Resume after expiry requires a new session.
- [ ] Representative visual help arrives in about 1.5 seconds or less under normal network conditions.
- [ ] Representative audio begins within about 2.5 seconds of a safe pause.
- [ ] The injected-clock test emits the 49-minute warning and ends at 50 minutes.

## Stability

- [ ] Run a 20-minute foreground target-language-only session without a stall and with zero audio assets.
- [ ] Record the backend PID and run `cd apps/backend && uv run python scripts/measure_rss.py --pid <PID> --warmup-seconds 300 --total-seconds 1200 --max-growth-mib 50`; attach only numeric output and verify growth below 50 MiB.
- [ ] Run the automated 100-intervention stress check and verify unique byte totals, linear counts, and complete cleanup.
