/**
 * Browser-side recorder wrapper.
 *
 * Wraps the `MediaRecorder` API so React components have a single,
 * testable object that:
 *
 * 1. Requests microphone access on `start()`.
 * 2. Streams chunks into a `Blob` until `stop()` is called.
 * 3. Emits frame-level amplitude samples for the `Waveform`
 *    component (driven by `AnalyserNode`).
 * 4. Surfaces a typed `AudioError` on any failure path so the UI can
 *    react with the right message (`permission_denied`, etc.).
 *
 * The module deliberately avoids React imports: it can be used in
 * React components, plain Node tests, or the preload script.
 */

import type {
  AudioError,
  RecorderConfig,
  RecorderState,
} from './types';

const DEFAULT_MIME_TYPE = 'audio/webm;codecs=opus';
const DEFAULT_FRAME_INTERVAL_MS = 50;
const DEFAULT_MAX_DURATION_MS = 60_000;

export interface AmplitudeFrame {
  /** Normalised 0..1 peak amplitude of the latest analyser frame. */
  peak: number;
  /** Number of AnalyserNode samples averaged to compute the peak. */
  frameSize: number;
  /** Monotonic timestamp (ms since `start()` was called). */
  elapsedMs: number;
}

export interface RecorderStartOptions {
  /** Optional override for the underlying MediaStream. */
  stream?: MediaStream;
  /** Called ~every `frameIntervalMs` ms while recording. */
  onFrame?: (frame: AmplitudeFrame) => void;
  /** Called when an internal error surfaces. */
  onError?: (error: AudioError) => void;
  /** Called when the underlying MediaRecorder raises an `error` event. */
  onStateChange?: (state: RecorderState) => void;
}

export interface RecorderResult {
  /** Recorded audio as a Blob; ``null`` while recording is in progress. */
  blob: Blob | null;
  /** MIME type actually negotiated with the browser. */
  mimeType: string;
  /** Wall-clock duration of the recording. */
  durationMs: number;
  /** All analyser frames captured during the session. */
  frames: AmplitudeFrame[];
}

const noop = (): void => undefined;

export class AudioRecorder {
  private state: RecorderState = 'idle';
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rafHandle: number | null = null;
  private startedAt = 0;
  private frameIntervalMs: number;
  private maxDurationMs: number;
  private mimeType: string;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private frames: AmplitudeFrame[] = [];
  private listeners: Array<(state: RecorderState) => void> = [];

  constructor(config: RecorderConfig = {}) {
    this.mimeType = config.mimeType ?? DEFAULT_MIME_TYPE;
    this.frameIntervalMs = config.frameIntervalMs ?? DEFAULT_FRAME_INTERVAL_MS;
    this.maxDurationMs = config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  }

  /** Current recorder state. */
  getState(): RecorderState {
    return this.state;
  }

  /** Subscribe to state transitions. Returns an unsubscribe function. */
  subscribe(listener: (state: RecorderState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== listener);
    };
  }

  /**
   * Begin recording.
   *
   * Resolves with the underlying stream when the recorder is ready.
   * Throws `AudioError` if the browser does not support the API or the
   * user denies microphone access.
   */
  async start(options: RecorderStartOptions = {}): Promise<MediaStream> {
    const onFrame = options.onFrame ?? noop;
    const onError = options.onError ?? noop;
    if (this.state === 'recording') {
      throw makeError('mic_busy', 'a recording is already in progress');
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      const err = makeError(
        'browser_unsupported',
        'MediaRecorder is not available in this environment',
      );
      onError(err);
      throw err;
    }
    try {
      this.stream =
        options.stream ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
    } catch (cause) {
      const err = makeError(
        'permission_denied',
        'microphone access was denied',
        cause,
      );
      onError(err);
      throw err;
    }

    const supported = pickSupportedMimeType(this.mimeType);
    try {
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: supported,
      });
    } catch (cause) {
      const err = makeError(
        'browser_unsupported',
        `MediaRecorder could not negotiate mime type ${supported}`,
        cause,
      );
      this.releaseStream();
      onError(err);
      throw err;
    }

    this.chunks = [];
    this.frames = [];
    this.startedAt = nowMs();
    this.mediaRecorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.mediaRecorder.addEventListener('error', (event: Event) => {
      const err = makeError(
        'mic_busy',
        `MediaRecorder error: ${(event as ErrorEvent).message ?? 'unknown'}`,
        event,
      );
      onError(err);
      this.transitionTo('error');
    });
    this.mediaRecorder.addEventListener('stop', () => {
      this.transitionTo('idle');
    });
    this.mediaRecorder.start(this.frameIntervalMs);

    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      source.connect(this.analyser);
      this.scheduleFrame(onFrame);
    } catch (cause) {
      // Analyser is optional; failures here do not break recording.
      // The waveform simply won't update.
      // eslint-disable-next-line no-console
      console.warn('AudioContext unavailable; waveform disabled', cause);
    }

    this.transitionTo('recording');
    if (this.maxDurationMs > 0) {
      window.setTimeout(() => {
        if (this.state === 'recording') {
          void this.stop();
        }
      }, this.maxDurationMs);
    }
    return this.stream;
  }

  /**
   * Stop the active recording.  Returns the recorded blob plus the
   * analyser frames captured during the session.
   */
  async stop(): Promise<RecorderResult> {
    if (this.state !== 'recording' || !this.mediaRecorder) {
      return {
        blob: null,
        mimeType: this.mimeType,
        durationMs: 0,
        frames: [],
      };
    }

    this.transitionTo('processing');
    const stopped = new Promise<void>((resolve) => {
      const recorder = this.mediaRecorder!;
      recorder.addEventListener('stop', () => resolve(), { once: true });
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        resolve();
      }
    });
    await stopped;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.audioContext) {
      await this.audioContext.close().catch(noop);
      this.audioContext = null;
    }
    this.analyser = null;

    const mimeType = this.mediaRecorder.mimeType || this.mimeType;
    const blob = new Blob(this.chunks, { type: mimeType });
    const durationMs = Math.max(0, nowMs() - this.startedAt);
    this.chunks = [];

    this.releaseStream();
    this.transitionTo('idle');
    return {
      blob,
      mimeType,
      durationMs,
      frames: this.frames.slice(),
    };
  }

  /** Release the underlying media stream (idempotent). */
  releaseStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  private transitionTo(next: RecorderState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  private scheduleFrame(onFrame: (frame: AmplitudeFrame) => void): void {
    const analyser = this.analyser;
    if (!analyser) {
      return;
    }
    const sample = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (this.state !== 'recording' || !this.analyser) {
        return;
      }
      this.analyser.getByteTimeDomainData(sample);
      let peak = 0;
      for (let i = 0; i < sample.length; i += 1) {
        const sampleValue = (sample[i] ?? 128) - 128;
        const abs = Math.abs(sampleValue);
        if (abs > peak) {
          peak = abs;
        }
      }
      const frame: AmplitudeFrame = {
        peak: peak / 128,
        frameSize: sample.length,
        elapsedMs: Math.max(0, nowMs() - this.startedAt),
      };
      this.frames.push(frame);
      onFrame(frame);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }
}

/**
 * Pick the best supported MIME type for the current browser.  WebKit
 * (Safari) refuses ``audio/webm``; the function falls back to the
 * first format MediaRecorder is willing to advertise.
 */
export function pickSupportedMimeType(preferred: string): string {
  if (typeof MediaRecorder === 'undefined') {
    return preferred;
  }
  if (MediaRecorder.isTypeSupported(preferred)) {
    return preferred;
  }
  const fallbacks = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
  ];
  for (const candidate of fallbacks) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

export function makeError(
  code: AudioError['code'],
  message: string,
  cause?: unknown,
): AudioError {
  return { code, message, cause };
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export const __test__ = {
  defaultMimeType: DEFAULT_MIME_TYPE,
  defaultFrameIntervalMs: DEFAULT_FRAME_INTERVAL_MS,
  defaultMaxDurationMs: DEFAULT_MAX_DURATION_MS,
};
