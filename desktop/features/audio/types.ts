/**
 * Shared types for the desktop audio feature.
 *
 * The audio feature mirrors the contracts exposed by
 * `core/voice/...` on the backend.  Keeping the types here lets the
 * React components, the IPC layer and the unit tests agree on a single
 * shape without importing from a non-TS package.
 *
 * Module placement: `desktop/features/audio/types.ts` (sibling of
 * `desktop/brand` and `desktop/src`).  Nothing here depends on
 * Electron, React or any I/O – it is pure data and is safe to use in
 * any context (renderer, preload, tests).
 */

/**
 * Microphone recording configuration.  All fields have a sensible
 * default so the caller can pass an empty object.
 */
export interface RecorderConfig {
  /** MIME type passed to MediaRecorder; defaults to webm/opus. */
  mimeType?: string;
  /** Capture interval in ms for AnalyserNode-based waveform updates. */
  frameIntervalMs?: number;
  /** Maximum duration in milliseconds before auto-stop. */
  maxDurationMs?: number;
}

/**
 * Result returned by `transcribeAudio` when the backend finishes STT.
 * Shape mirrors `core.voice.models.WhisperResult` (Python dataclass).
 */
export interface WhisperTranscript {
  ok: boolean;
  text: string;
  language: string;
  durationSeconds: number;
  /** Per-segment timing in seconds. */
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  modelUsed: string;
  inferenceSeconds: number;
}

/** Body for `POST /api/voice/tts`. */
export interface TTSRequest {
  text: string;
  voice: string;
  rate: number;
  /** Optional override; backend generates a UUID when omitted. */
  outputFilename?: string;
}

/** Response from `POST /api/voice/tts`. */
export interface TTSResponse {
  ok: boolean;
  audioPath: string;
  /** Relative URL the renderer can hand to an <audio> element. */
  audioUrl: string;
  voice: string;
  rate: number;
  text: string;
  bytes: number;
}

/**
 * Single voice entry as returned by `GET /api/voice/voices`.
 * Mirrors `core.voice.models.VoiceInfo.as_dict()`.
 */
export interface VoiceInfo {
  name: string;
  /** ISO 639-1 code, e.g. ``"es"`` / ``"en"``. */
  language: string;
  /** Full locale tag, e.g. ``"es_MX"``. */
  locale: string;
  sampleText: string;
}

/** Status payload from `GET /api/voice/status`. */
export interface VoiceStatus {
  ok: boolean;
  pipeline: {
    whisperBinary: string;
    modelPath: string;
    sayBinary: string;
    recorderAvailable: boolean;
    playerAvailable: boolean;
    stats: {
      sttRuns: number;
      ttsRuns: number;
      lastLanguage: string;
    };
  };
  binaryAvailable: {
    binaryExists: boolean;
    binaryPath: string;
    modelExists: boolean;
    modelPath: string;
  };
}

/** State enum for the recorder hook/component. */
export type RecorderState = 'idle' | 'recording' | 'processing' | 'error';

/** State enum for the player hook/component. */
export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** Error codes raised by the recorder/player hooks. */
export type AudioErrorCode =
  | 'permission_denied'
  | 'browser_unsupported'
  | 'network'
  | 'mic_busy'
  | 'playback_failed'
  | 'whisper_unavailable'
  | 'whisper_model_missing'
  | 'unknown';

export interface AudioError {
  code: AudioErrorCode;
  message: string;
  cause?: unknown;
}
