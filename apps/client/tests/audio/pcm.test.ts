import {
  PcmFormatError,
  PcmFrameAssembler,
  StreamingPcmNormalizer,
} from '../../src/audio/pcm';

function int16Buffer(values: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return buffer;
}

test('assembles exact frames and preserves remainder', () => {
  const assembler = new PcmFrameAssembler();
  expect(assembler.push(new Int16Array(1000))).toHaveLength(0);
  const frames = assembler.push(new Int16Array(1000));
  expect(frames).toHaveLength(1);
  expect(frames[0].byteLength).toBe(3840);
  expect(assembler.pendingSamples).toBe(80);
});

test('downmixes and resamples 48 kHz stereo to 24 kHz mono', () => {
  const stereo = Array.from({ length: 3840 }, () => 1200);
  const output = new StreamingPcmNormalizer().push({
    data: int16Buffer(stereo),
    channels: 2,
    encoding: 'int16',
    sampleRate: 48000,
  });
  expect(output).toHaveLength(960);
  expect(output[0]).toBe(1200);
});

test('split callbacks produce the same stream as one callback', () => {
  const source = Int16Array.from({ length: 4001 }, (_, index) => index - 2000);
  const whole = new StreamingPcmNormalizer().push({
    data: int16Buffer(Array.from(source)),
    channels: 1,
    encoding: 'int16',
    sampleRate: 44100,
  });
  const splitNormalizer = new StreamingPcmNormalizer();
  const split = [source.slice(0, 997), source.slice(997, 2051), source.slice(2051)]
    .flatMap((part) => Array.from(splitNormalizer.push({
      data: int16Buffer(Array.from(part)),
      channels: 1,
      encoding: 'int16',
      sampleRate: 44100,
    })));
  expect(split).toEqual(Array.from(whole));
});

test('packs samples as signed little endian', () => {
  const assembler = new PcmFrameAssembler();
  const samples = new Int16Array(1920);
  samples[0] = 0x1234;
  const frame = assembler.push(samples)[0];
  expect(Array.from(new Uint8Array(frame).slice(0, 2))).toEqual([0x34, 0x12]);
});

test('rejects malformed and changed formats', () => {
  const normalizer = new StreamingPcmNormalizer();
  expect(() => normalizer.push({
    data: new ArrayBuffer(3),
    channels: 1,
    encoding: 'int16',
    sampleRate: 24000,
  })).toThrow(PcmFormatError);
  normalizer.push({
    data: int16Buffer([1, 2]),
    channels: 1,
    encoding: 'int16',
    sampleRate: 24000,
  });
  expect(() => normalizer.push({
    data: int16Buffer([1, 2]),
    channels: 1,
    encoding: 'int16',
    sampleRate: 48000,
  })).toThrow('audio_format_changed');
});
