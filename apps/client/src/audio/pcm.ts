export const TARGET_SAMPLE_RATE = 24_000;
export const FRAME_SAMPLES = 1_920;
export const FRAME_BYTES = 3_840;

export type AudioStreamBufferLike = {
  data: ArrayBuffer;
  channels: number;
  encoding: 'float32' | 'int16';
  sampleRate: number;
};

export type PcmErrorCode = 'unsupported_audio_format' | 'audio_format_changed';

export class PcmFormatError extends Error {
  constructor(readonly code: PcmErrorCode) {
    super(code);
    this.name = 'PcmFormatError';
  }
}

function validateBuffer(buffer: AudioStreamBufferLike): void {
  if (
    !Number.isFinite(buffer.sampleRate) ||
    buffer.sampleRate <= 0 ||
    !Number.isInteger(buffer.channels) ||
    buffer.channels <= 0
  ) {
    throw new PcmFormatError('unsupported_audio_format');
  }
  const bytesPerSample = buffer.encoding === 'int16' ? 2 : 4;
  if (
    buffer.data.byteLength % bytesPerSample !== 0 ||
    buffer.data.byteLength / bytesPerSample / buffer.channels % 1 !== 0
  ) {
    throw new PcmFormatError('unsupported_audio_format');
  }
}

function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767);
}

function decodeMono(buffer: AudioStreamBufferLike): Int16Array {
  const bytesPerSample = buffer.encoding === 'int16' ? 2 : 4;
  const sampleCount = buffer.data.byteLength / bytesPerSample;
  const frameCount = sampleCount / buffer.channels;
  const view = new DataView(buffer.data);
  const mono = new Int16Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < buffer.channels; channel += 1) {
      const sampleIndex = frame * buffer.channels + channel;
      const offset = sampleIndex * bytesPerSample;
      sum +=
        buffer.encoding === 'int16'
          ? view.getInt16(offset, true)
          : view.getFloat32(offset, true);
    }
    const average = sum / buffer.channels;
    mono[frame] =
      buffer.encoding === 'int16'
        ? Math.max(-32768, Math.min(32767, Math.round(average)))
        : floatToInt16(average);
  }
  return mono;
}

export class StreamingPcmNormalizer {
  private sampleRate: number | null = null;
  private channels: number | null = null;
  private encoding: AudioStreamBufferLike['encoding'] | null = null;
  private totalSourceFrames = 0;
  private nextOutputPosition = 0;
  private previousSample: number | null = null;

  push(buffer: AudioStreamBufferLike): Int16Array {
    validateBuffer(buffer);
    if (
      this.sampleRate !== null &&
      (this.sampleRate !== buffer.sampleRate ||
        this.channels !== buffer.channels ||
        this.encoding !== buffer.encoding)
    ) {
      this.reset();
      throw new PcmFormatError('audio_format_changed');
    }
    this.sampleRate = buffer.sampleRate;
    this.channels = buffer.channels;
    this.encoding = buffer.encoding;

    const mono = decodeMono(buffer);
    if (mono.length === 0) {
      return new Int16Array();
    }

    const startIndex = this.totalSourceFrames;
    const endIndex = startIndex + mono.length - 1;
    const ratio = buffer.sampleRate / TARGET_SAMPLE_RATE;
    const output: number[] = [];

    while (Math.ceil(this.nextOutputPosition) <= endIndex) {
      const lowerIndex = Math.floor(this.nextOutputPosition);
      const upperIndex = Math.ceil(this.nextOutputPosition);
      const lower =
        lowerIndex < startIndex
          ? this.previousSample
          : mono[lowerIndex - startIndex];
      const upper =
        upperIndex < startIndex
          ? this.previousSample
          : mono[upperIndex - startIndex];
      if (lower === null || upper === null || lower === undefined || upper === undefined) {
        break;
      }
      const fraction = this.nextOutputPosition - lowerIndex;
      output.push(Math.round(lower + (upper - lower) * fraction));
      this.nextOutputPosition += ratio;
    }

    this.totalSourceFrames += mono.length;
    this.previousSample = mono[mono.length - 1];
    return Int16Array.from(output);
  }

  reset(): void {
    this.sampleRate = null;
    this.channels = null;
    this.encoding = null;
    this.totalSourceFrames = 0;
    this.nextOutputPosition = 0;
    this.previousSample = null;
  }
}

export class PcmFrameAssembler {
  private pending = new Int16Array();

  get pendingSamples(): number {
    return this.pending.length;
  }

  push(samples: Int16Array): ArrayBuffer[] {
    const combined = new Int16Array(this.pending.length + samples.length);
    combined.set(this.pending);
    combined.set(samples, this.pending.length);
    const frames: ArrayBuffer[] = [];
    let offset = 0;

    while (combined.length - offset >= FRAME_SAMPLES) {
      const frame = new ArrayBuffer(FRAME_BYTES);
      const view = new DataView(frame);
      for (let index = 0; index < FRAME_SAMPLES; index += 1) {
        view.setInt16(index * 2, combined[offset + index], true);
      }
      frames.push(frame);
      offset += FRAME_SAMPLES;
    }

    this.pending = combined.slice(offset);
    return frames;
  }

  reset(): void {
    this.pending = new Int16Array();
  }
}
