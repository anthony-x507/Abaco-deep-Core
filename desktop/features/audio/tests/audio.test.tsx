/**
 * Unit tests for the desktop audio feature.
 *
 * Run with:
 *
 *     cd desktop && npx vitest run src/dsh-desktop/src/features/audio
 *
 * Tests use Vitest's globals (``describe``/``it``/``expect``) so the
 * file can be copied into the existing DSH test setup without any
 * additional imports.
 */

import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AudioError,
  TTSResponse,
  WhisperTranscript,
} from '../types';
import { AudioPlayer } from '../player';
import { AudioRecorder, pickSupportedMimeType } from '../recorder';
import { VoiceIPC } from '../ipc-handlers';
import { MicButton } from '../mic-button';
import { SpeakerButton } from '../speaker-button';
import { Waveform } from '../waveform';

/* ----------------------------------------------------------------------
 * Fakes – we never touch the real network or browser audio APIs in tests.
 * ---------------------------------------------------------------------- */

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  readonly mimeType: string;

  constructor(public readonly stream: MediaStream, init?: MediaRecorderOptions) {
    this.mimeType = init?.mimeType || 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(intervalMs?: number): void {
    this.state = 'recording';
    if (typeof intervalMs === 'number') {
      // Schedule a fake dataavailable so consumers see something.
      window.setTimeout(() => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(8)], { type: this.mimeType }) });
      }, intervalMs ?? 50);
    }
  }

  stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }
}

class FakeAnalyserNode {
  fftSize = 1024;
  getByteTimeDomainData(_target: Uint8Array): void {
    /* no-op */
  }
}

class FakeMediaStreamAudioSourceNode {
  connect(_target: FakeAnalyserNode): void {
    /* no-op */
  }
}

class FakeAudioContext {
  close(): Promise<void> {
    return Promise.resolve();
  }
  createAnalyser(): FakeAnalyserNode {
    return new FakeAnalyserNode();
  }
  createMediaStreamSource(_stream: MediaStream): FakeMediaStreamAudioSourceNode {
    return new FakeMediaStreamAudioSourceNode();
  }
}

function installMediaRecorderFakes(): void {
  (globalThis as unknown as { MediaRecorder: typeof FakeMediaRecorder }).MediaRecorder =
    FakeMediaRecorder as unknown as typeof MediaRecorder;
  (MediaRecorder as unknown as { isTypeSupported: (s: string) => boolean }).isTypeSupported = (
    _s: string,
  ) => true;
  (globalThis as unknown as { AudioContext: typeof FakeAudioContext }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
}

function fakeJsonResponse(body: unknown, ok = true, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeFakeFetcher(mapping: Record<string, (init?: RequestInit) => Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [key, handler] of Object.entries(mapping)) {
      if (url.includes(key)) {
        return handler(init);
      }
    }
    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;
}

function makeFakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: () => undefined }],
  } as unknown as MediaStream;
}

beforeEach(() => {
  installMediaRecorderFakes();
  FakeMediaRecorder.instances = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ----------------------------------------------------------------------
 * recorder.ts
 * ---------------------------------------------------------------------- */

describe('pickSupportedMimeType', () => {
  it('returns the preferred type when supported', () => {
    expect(pickSupportedMimeType('audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
  });
});

describe('AudioRecorder', () => {
  it('start/stop yields a blob with collected chunks', async () => {
    const recorder = new AudioRecorder({ frameIntervalMs: 0, maxDurationMs: 0 });
    const stream = makeFakeStream();
    await recorder.start({ stream });
    const instance = FakeMediaRecorder.instances[0];
    expect(instance.state).toBe('recording');
    expect(stream.getTracks().length).toBeGreaterThan(0);
    const stopPromise = recorder.stop();
    instance.ondataavailable?.({ data: new Blob([new Uint8Array(4)]) });
    instance.stop();
    const result = await stopPromise;
    expect(result.blob).not.toBeNull();
    expect(result.blob?.size).toBeGreaterThan(0);
  });

  it('emits an error when getUserMedia rejects', async () => {
    const recorder = new AudioRecorder();
    (navigator as unknown as { mediaDevices: { getUserMedia: typeof vi.fn } }).mediaDevices = {
      getUserMedia: vi.fn().mockRejectedValue(new Error('denied')),
    };
    const onError = vi.fn<(error: AudioError) => void>();
    await expect(
      recorder.start({ onError }),
    ).rejects.toMatchObject({ code: 'permission_denied' });
    expect(onError).toHaveBeenCalled();
  });

  it('subscribe receives state transitions', async () => {
    const recorder = new AudioRecorder({ maxDurationMs: 0 });
    const stream = makeFakeStream();
    const seen: string[] = [];
    recorder.subscribe((state) => seen.push(state));
    await recorder.start({ stream });
    const instance = FakeMediaRecorder.instances[0];
    instance.stop();
    await recorder.stop();
    expect(seen).toEqual(['recording', 'processing', 'idle']);
  });
});

/* ----------------------------------------------------------------------
 * player.ts
 * ---------------------------------------------------------------------- */

describe('AudioPlayer', () => {
  it('load() resolves and stores the URL', async () => {
    const audio = {
      src: '',
      pause: () => undefined,
      play: () => Promise.resolve(),
      load: () => undefined,
      addEventListener: (_event: string, _handler: EventListener) => undefined,
      removeEventListener: (_event: string, _handler: EventListener) => undefined,
      removeAttribute: (_attr: string) => undefined,
      preload: '',
      currentTime: 0,
      error: null,
    } as unknown as HTMLAudioElement;
    const player = new AudioPlayer(audio);
    const fakeLoad = vi.fn();
    Object.defineProperty(audio, 'load', { value: fakeLoad });
    Object.defineProperty(audio, 'addEventListener', {
      value: (event: string, handler: EventListener) => {
        if (event === 'canplay') {
          (handler as unknown as EventListener)(new Event('canplay'));
        }
      },
    });
    await player.load('/api/voice/audio/test.aiff');
    expect(audio.src).toContain('test.aiff');
  });

  it('play() throws when no URL is loaded', async () => {
    const player = new AudioPlayer();
    const onError = vi.fn<(e: AudioError) => void>();
    await expect(
      player.play({ onError }),
    ).rejects.toMatchObject({ code: 'playback_failed' });
    expect(onError).toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------------------
 * ipc-handlers.ts
 * ---------------------------------------------------------------------- */

describe('VoiceIPC', () => {
  const base = 'http://localhost:8765';
  const transcript: WhisperTranscript = {
    ok: true,
    text: 'Hola mundo',
    language: 'es',
    durationSeconds: 1.5,
    segments: [{ start: 0, end: 1, text: 'Hola mundo' }],
    modelUsed: 'base',
    inferenceSeconds: 0.4,
  };
  const ttsResponse: TTSResponse = {
    ok: true,
    audioPath: '/tmp/reply.aiff',
    audioUrl: '/api/voice/audio/reply.aiff',
    voice: 'es_Mexico',
    rate: 200,
    text: 'Hola',
    bytes: 1234,
  };

  it('transcribe uploads a FormData with the blob', async () => {
    const fetcher = vi.fn(
      async (_input: string, init?: RequestInit) => fakeJsonResponse(transcript),
    );
    const ipc = new VoiceIPC({ baseUrl: base, fetcher: fetcher as unknown as typeof fetch });
    const blob = new Blob([new Uint8Array(4)], { type: 'audio/webm' });
    const response = await ipc.transcribe(blob, { language: 'es' });
    expect(response.text).toBe('Hola mundo');
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('synthesize posts JSON and parses the response', async () => {
    const fetcher = vi.fn(async (_input: string) => fakeJsonResponse(ttsResponse));
    const ipc = new VoiceIPC({ baseUrl: base, fetcher: fetcher as unknown as typeof fetch });
    const response = await ipc.synthesize({
      text: 'Hola',
      voice: 'es_Mexico',
      rate: 200,
    });
    expect(response.audioPath).toBe('/tmp/reply.aiff');
  });

  it('listVoices returns the array', async () => {
    const voices = [
      { name: 'Monica', language: 'es', locale: 'es_ES', sampleText: 'x' },
    ];
    const fetcher = vi.fn(async (_input: string) =>
      fakeJsonResponse({ ok: true, voices }),
    );
    const ipc = new VoiceIPC({ baseUrl: base, fetcher: fetcher as unknown as typeof fetch });
    const result = await ipc.listVoices();
    expect(result[0]?.name).toBe('Monica');
  });

  it('propagates HTTP errors', async () => {
    const fetcher = vi.fn(async (_input: string) =>
      fakeJsonResponse({}, false, 503),
    );
    const ipc = new VoiceIPC({ baseUrl: base, fetcher: fetcher as unknown as typeof fetch });
    await expect(ipc.listVoices()).rejects.toThrow(/503/);
  });
});

/* ----------------------------------------------------------------------
 * React components
 * ---------------------------------------------------------------------- */

describe('MicButton', () => {
  it('toggles recording and fires onTranscript when transcription succeeds', async () => {
    const ipc = new VoiceIPC({
      baseUrl: 'http://localhost:8765',
      fetcher: makeFakeFetcher({
        '/api/voice/stt': () =>
          fakeJsonResponse({
            ok: true,
            text: 'Hola',
            language: 'es',
            durationSeconds: 1,
            segments: [],
            modelUsed: 'base',
            inferenceSeconds: 0.2,
          }),
      }) as unknown as typeof fetch,
    });
    const onTranscript = vi.fn<(text: string, language: string) => void>();
    render(<MicButton ipc={ipc} onTranscript={onTranscript} language="es" />);
    const button = screen.getByRole('button', { name: /Iniciar grabación/ });
    await act(async () => {
      fireEvent.click(button);
      // Allow the start() promise to resolve.
      await Promise.resolve();
    });
    const instance = FakeMediaRecorder.instances[0];
    act(() => {
      instance.ondataavailable?.({ data: new Blob([new Uint8Array(16)]) });
    });
    await act(async () => {
      instance.stop();
      const stopBtn = await screen.findByRole('button', { name: /Detener grabación/ });
      fireEvent.click(stopBtn);
    });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Hola', 'es'));
  });

  it('routes errors through onError when recording fails', async () => {
    const onError = vi.fn<(error: AudioError) => void>();
    (navigator as unknown as { mediaDevices: { getUserMedia: () => Promise<never> } }).mediaDevices = {
      getUserMedia: () => Promise.reject(new Error('nope')),
    };
    const ipc = new VoiceIPC({ baseUrl: 'http://localhost:0', fetcher: (() => Promise.reject(new Error('unused'))) as unknown as typeof fetch });
    render(<MicButton ipc={ipc} onError={onError} />);
    const button = screen.getByRole('button');
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalled();
  });
});

describe('SpeakerButton', () => {
  it('renders disabled when no URL is given', () => {
    render(<SpeakerButton audioUrl={null} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('shows the play label when an audio URL is provided', async () => {
    // Patch the Audio() instance that the player spawns so .load() resolves.
    const original = globalThis.HTMLAudioElement;
    const fakeAudio = function (): HTMLAudioElement {
      const audio = document.createElement('audio');
      audio.addEventListener = ((event: string, handler: EventListener) => {
        if (event === 'canplay') {
          (handler as unknown as EventListener)(new Event('canplay'));
        }
        return undefined;
      }) as unknown as HTMLAudioElement['addEventListener'];
      return audio;
    } as unknown as typeof Audio;
    (globalThis as unknown as { HTMLAudioElement?: typeof Audio }).HTMLAudioElement = fakeAudio;
    try {
      render(<SpeakerButton audioUrl="/api/voice/audio/test.aiff" />);
      const button = screen.getByRole('button', { name: /Reproducir respuesta/ });
      expect(button).not.toBeDisabled();
      expect(button.getAttribute('data-state')).toBeTruthy();
    } finally {
      (globalThis as unknown as { HTMLAudioElement?: typeof original }).HTMLAudioElement =
        original;
    }
  });
});

describe('Waveform', () => {
  it('renders bars for each frame', () => {
    const frames = [
      { peak: 0.1, frameSize: 1024, elapsedMs: 0 },
      { peak: 0.4, frameSize: 1024, elapsedMs: 50 },
      { peak: 0.8, frameSize: 1024, elapsedMs: 100 },
    ];
    const { container } = render(<Waveform frames={frames} />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(3);
  });

  it('clamps to maxBars', () => {
    const frames = Array.from({ length: 100 }, (_, i) => ({
      peak: i / 100,
      frameSize: 1024,
      elapsedMs: i * 10,
    }));
    const { container } = render(<Waveform frames={frames} maxBars={8} />);
    expect(container.querySelectorAll('rect').length).toBe(8);
  });
});
