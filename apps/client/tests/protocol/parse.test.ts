import fixture from '../../../../packages/protocol/fixtures/valid-intervention.json';
import { parseServerEvent, ProtocolError } from '../../src/protocol/parse';

test('parses the committed intervention fixture', () => {
  const event = parseServerEvent(fixture);
  expect(event.type).toBe('intervention.committed');
  expect(event.sequence).toBe(3);
});

test('rejects a future protocol version', () => {
  expect(() => parseServerEvent({ ...fixture, protocol_version: 2 })).toThrow(
    ProtocolError,
  );
});

test('rejects an event missing discriminator-specific fields', () => {
  const { target_text: _removed, ...malformed } = fixture;
  expect(() => parseServerEvent(malformed)).toThrow(ProtocolError);
});

test('validates device speech readiness without an audio URL', () => {
  const ready = {
    type: 'intervention.audio_ready',
    protocol_version: 1,
    session_id: fixture.session_id,
    sequence: 4,
    turn_id: fixture.turn_id,
    intervention_id: fixture.intervention_id,
    playback_kind: 'device_speech',
    audio_url: null,
  };
  expect(parseServerEvent(ready).type).toBe('intervention.audio_ready');
  const { playback_kind: _removed, ...malformed } = ready;
  expect(() => parseServerEvent(malformed)).toThrow(ProtocolError);
});
