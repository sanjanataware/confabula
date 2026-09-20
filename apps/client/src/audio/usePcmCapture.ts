import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
  type AudioStreamEncoding,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
  PcmFormatError,
  PcmFrameAssembler,
  StreamingPcmNormalizer,
  TARGET_SAMPLE_RATE,
  type AudioStreamBufferLike,
} from './pcm';

const SOURCE_ENCODING: AudioStreamEncoding = 'int16';
const WORKLET_SOURCE = `
class CoachPcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.channels = 0; this.offset = 0; this.buffer = null; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || !channels.length || !channels[0].length) return true;
    if (this.channels !== channels.length) {
      this.channels = channels.length;
      this.buffer = new Float32Array(1920 * this.channels);
      this.offset = 0;
    }
    for (let frame = 0; frame < channels[0].length; frame++) {
      for (let channel = 0; channel < this.channels; channel++) {
        this.buffer[this.offset++] = channels[channel][frame];
      }
      if (this.offset === this.buffer.length) {
        const data = this.buffer.buffer;
        this.port.postMessage({ data, channels: this.channels, sampleRate, encoding: 'float32' }, [data]);
        this.buffer = new Float32Array(1920 * this.channels);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('coach-pcm-capture', CoachPcmCapture);
`;

type WebCapture = {
  media: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode | null;
  processor: AudioWorkletNode | null;
  gain: GainNode | null;
};
export type CaptureState =
  | 'idle' | 'requesting_permission' | 'capturing' | 'permission_denied'
  | 'unsupported_audio_format' | 'audio_format_changed' | 'error';
export type CaptureDiagnostics = {
  sampleRate: number | null;
  channels: number | null;
  encoding: AudioStreamEncoding;
  emittedFrameCount: number;
  lastFrameByteLength: number | null;
};

export function adaptExpoBuffer(buffer: AudioStreamBuffer, encoding: AudioStreamEncoding): AudioStreamBufferLike {
  return { data: buffer.data, channels: buffer.channels, encoding, sampleRate: buffer.sampleRate };
}

export function usePcmCapture({ onFrame, onError }: {
  onFrame: (frame: ArrayBuffer) => void;
  onError?: (state: CaptureState) => void;
}) {
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  const normalizer = useRef(new StreamingPcmNormalizer());
  const assembler = useRef(new PcmFrameAssembler());
  const webCapture = useRef<WebCapture | null>(null);
  const streamRef = useRef<ReturnType<typeof useAudioStream>['stream'] | null>(null);
  const generation = useRef(0);
  const capturing = useRef(false);
  const nativeStarted = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<Promise<boolean> | null>(null);
  const [state, setState] = useState<CaptureState>('idle');
  const initialDiagnostics: CaptureDiagnostics = {
    sampleRate: null, channels: null, encoding: SOURCE_ENCODING,
    emittedFrameCount: 0, lastFrameByteLength: null,
  };
  const diagnosticsRef = useRef(initialDiagnostics);
  const lastDiagnosticsPublishedAt = useRef(0);
  const [diagnostics, setDiagnostics] = useState<CaptureDiagnostics>(initialDiagnostics);
  onFrameRef.current = onFrame;
  onErrorRef.current = onError;

  const reset = useCallback(() => {
    normalizer.current.reset();
    assembler.current.reset();
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    capturing.current = false;
    pending.current = null;
    if (nativeStarted.current) {
      nativeStarted.current = false;
      streamRef.current?.stop();
    }
    const web = webCapture.current;
    webCapture.current = null;
    if (web) {
      if (web.processor) {
        web.processor.port.onmessage = null;
        web.processor.disconnect();
      }
      web.source?.disconnect();
      web.gain?.disconnect();
      for (const track of web.media.getTracks()) track.stop();
      void web.context.close().catch(() => undefined);
    }
    reset();
    if (mounted.current) setState('idle');
  }, [reset]);

  const fail = useCallback((failure: CaptureState) => {
    stop();
    if (mounted.current) {
      setState(failure);
      onErrorRef.current?.(failure);
    }
  }, [stop]);

  const processBuffer = useCallback((buffer: AudioStreamBufferLike) => {
    if (!capturing.current) return;
    try {
      const frames = assembler.current.push(normalizer.current.push(buffer));
      for (const frame of frames) {
        if (!capturing.current) break;
        onFrameRef.current(frame);
      }
      if (mounted.current && capturing.current && frames.length) {
        const current = diagnosticsRef.current;
        const next = {
          sampleRate: buffer.sampleRate, channels: buffer.channels, encoding: buffer.encoding,
          emittedFrameCount: current.emittedFrameCount + frames.length,
          lastFrameByteLength: frames.at(-1)?.byteLength ?? null,
        };
        diagnosticsRef.current = next;
        const now = Date.now();
        if (current.emittedFrameCount === 0 || now - lastDiagnosticsPublishedAt.current >= 1000) {
          lastDiagnosticsPublishedAt.current = now;
          setDiagnostics(next);
        }
      }
    } catch (error) {
      fail(error instanceof PcmFormatError ? error.code : 'error');
    }
  }, [fail]);

  const { stream } = useAudioStream({
    channels: 1, encoding: SOURCE_ENCODING, sampleRate: TARGET_SAMPLE_RATE,
    onBuffer: (buffer) => processBuffer(adaptExpoBuffer(buffer, SOURCE_ENCODING)),
  });
  streamRef.current = stream;

  const startWeb = useCallback(async (epoch: number): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      fail('unsupported_audio_format');
      return false;
    }
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (epoch !== generation.current || !mounted.current) {
      for (const track of media.getTracks()) track.stop();
      return false;
    }
    let context: AudioContext;
    try {
      try {
        context = new AudioContext({
          sampleRate: TARGET_SAMPLE_RATE,
          latencyHint: 'interactive',
        });
      } catch {
        context = new AudioContext({ latencyHint: 'interactive' });
      }
    } catch {
      for (const track of media.getTracks()) track.stop();
      fail('unsupported_audio_format');
      return false;
    }
    const web: WebCapture = { media, context, source: null, processor: null, gain: null };
    webCapture.current = web;
    if (!context.audioWorklet) {
      fail('unsupported_audio_format');
      return false;
    }
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    if (epoch !== generation.current || !mounted.current) return false;
    web.source = context.createMediaStreamSource(media);
    web.processor = new AudioWorkletNode(context, 'coach-pcm-capture');
    web.gain = context.createGain();
    web.gain.gain.value = 0;
    web.processor.port.onmessage = ({ data }: MessageEvent<AudioStreamBufferLike>) => {
      if (epoch === generation.current) processBuffer(data);
    };
    web.source.connect(web.processor);
    web.processor.connect(web.gain);
    web.gain.connect(context.destination);
    await context.resume();
    return epoch === generation.current && mounted.current;
  }, [fail, processBuffer]);

  const start = useCallback((permissionAlreadyGranted = false): Promise<boolean> => {
    if (capturing.current) return Promise.resolve(true);
    if (pending.current) return pending.current;
    const epoch = ++generation.current;
    reset();
    const operation = (async () => {
      try {
        if (mounted.current) setState('requesting_permission');
        if (Platform.OS === 'web') {
          if (!await startWeb(epoch)) return false;
        } else {
          if (!permissionAlreadyGranted) {
            const permission = await requestRecordingPermissionsAsync();
            if (epoch !== generation.current || !mounted.current) return false;
            if (!permission.granted) {
              fail('permission_denied');
              return false;
            }
          }
          await setAudioModeAsync({
            allowsRecording: true, playsInSilentMode: true,
            shouldPlayInBackground: false, interruptionMode: 'mixWithOthers',
          });
          if (epoch !== generation.current || !mounted.current) return false;
          nativeStarted.current = true;
          await streamRef.current?.start();
          if (epoch !== generation.current || !mounted.current) {
            streamRef.current?.stop();
            return false;
          }
        }
        capturing.current = true;
        setState('capturing');
        return true;
      } catch (error) {
        if (epoch === generation.current && mounted.current) {
          fail(error instanceof Error && error.name === 'NotAllowedError' ? 'permission_denied' : 'error');
        }
        return false;
      }
    })();
    pending.current = operation;
    void operation.then(() => { if (pending.current === operation) pending.current = null; });
    return operation;
  }, [fail, reset, startWeb]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  return { start, stop, state, diagnostics };
}
