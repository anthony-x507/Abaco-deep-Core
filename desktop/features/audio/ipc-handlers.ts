/**
 * IPC bridge between the Electron renderer and the Python backend.
 *
 * The handlers cover the three operations the desktop UI needs:
 *
 * 1. Render text to a local ``.aiff`` file (`POST /api/voice/tts`).
 * 2. Speak text directly through macOS's audio device (`/api/voice/tts/speak`).
 * 3. Transcribe a recorded blob (`POST /api/voice/stt`).
 * 4. List voices (`GET /api/voice/voices`).
 * 5. Inspect the pipeline (`GET /api/voice/status`).
 *
 * The module lives in `desktop/features/audio/` – it does **not**
 * import from any Electron-specific module so it can be exercised
 * under Vitest with a stubbed fetch.
 */

import type {
  TTSRequest as TTSRequestBody,
  TTSResponse,
  WhisperTranscript,
  VoiceInfo,
  VoiceStatus,
} from './types';

export type HttpFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface IPCConfig {
  baseUrl: string;
  /** Override for testing.  Defaults to the global ``fetch``. */
  fetcher?: HttpFetcher;
}

export class VoiceIPC {
  private baseUrl: string;
  private fetcher: HttpFetcher;

  constructor(config: IPCConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetcher = config.fetcher ?? ((input, init) => fetch(input, init));
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const response = await this.fetcher(`${this.baseUrl}/api/voice/voices`);
    ensureOk(response);
    const body = (await response.json()) as { ok: boolean; voices: VoiceInfo[] };
    return body.voices;
  }

  async status(): Promise<VoiceStatus> {
    const response = await this.fetcher(`${this.baseUrl}/api/voice/status`);
    ensureOk(response);
    return (await response.json()) as VoiceStatus;
  }

  async synthesize(request: TTSRequestBody): Promise<TTSResponse> {
    const response = await this.fetcher(`${this.baseUrl}/api/voice/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    ensureOk(response);
    return (await response.json()) as TTSResponse;
  }

  async speak(request: TTSRequestBody): Promise<{ ok: boolean; spoken: string }> {
    const response = await this.fetcher(`${this.baseUrl}/api/voice/tts/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    ensureOk(response);
    return (await response.json()) as { ok: boolean; spoken: string };
  }

  /**
   * Upload ``blob`` (e.g. produced by the recorder) to the backend STT
   * endpoint.  Pass extra form fields via ``meta``.
   */
  async transcribe(
    blob: Blob,
    meta: { language?: string | null; filename?: string; translateToEnglish?: boolean } = {},
  ): Promise<WhisperTranscript> {
    const form = new FormData();
    const filename = meta.filename ?? 'recording.webm';
    form.append('file', blob, filename);
    if (meta.language) {
      form.append('language', meta.language);
    }
    if (meta.translateToEnglish) {
      form.append('translate_to_english', 'true');
    }
    const response = await this.fetcher(`${this.baseUrl}/api/voice/stt`, {
      method: 'POST',
      body: form,
    });
    ensureOk(response);
    return (await response.json()) as WhisperTranscript;
  }

  /**
   * Returns the audio URL the renderer can hand to an ``<audio>``
   * element.  Kept as a method so test suites can swap the host.
   */
  audioUrl(filename: string): string {
    return `${this.baseUrl}/api/voice/audio/${encodeURIComponent(filename)}`;
  }
}

function ensureOk(response: Response): void {
  if (!response.ok) {
    let detail = '';
    try {
      // The body may not be JSON, hence the dynamic access.
      detail = (response as unknown as { detail?: string }).detail ?? '';
    } catch {
      // ignore
    }
    throw new Error(
      `voice IPC failed: ${response.status} ${response.statusText}${detail ? ` – ${detail}` : ''}`,
    );
  }
}

export const __test__ = { ensureOk };
