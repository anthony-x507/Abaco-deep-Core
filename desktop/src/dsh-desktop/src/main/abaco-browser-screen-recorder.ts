/**
 * P1 — desktopCapturer screen recorder for the ABACO main window.
 *
 * Distinct from the F2 DOM action recorder (`abaco-browser-recorder.ts`): this
 * captures *pixels* via Electron's `desktopCapturer` + a hidden BrowserWindow
 * that runs `MediaRecorder`, writing a WebM under
 * `<userData>/abaco-browser/screen-recordings/`.
 *
 * The recorder window loads `about:blank` and is driven entirely through
 * `executeJavaScript` (no separate preload chunk — sandboxed preloads cannot
 * `require` relative modules, see f40e1ce). Media permission is granted on that
 * window's session for the capture call.
 *
 * @module abaco-browser-screen-recorder
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, desktopCapturer, type BrowserWindow as ElectronBrowserWindow } from 'electron'
import type {
  AbacoBrowserScreenRecordingResult,
  AbacoBrowserScreenRecordingStatus
} from '../shared/abaco-browser'

export interface AbacoBrowserScreenRecorderOptions {
  /** Absolute directory for WebM files. */
  outputDir: string
  /** The ABACO main window whose pixels should be captured when possible. */
  parent: ElectronBrowserWindow
  now?: () => Date
  log?: (message: string) => void
}

interface LiveSession {
  sessionId: string
  startedAt: string
  startedMs: number
  sourceId: string
  recorderWindow: BrowserWindow
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One screen-recording session at a time, owned by `AbacoBrowserController`.
 */
export class AbacoBrowserScreenRecorder {
  private readonly outputDir: string
  private readonly parent: ElectronBrowserWindow
  private readonly now: () => Date
  private readonly log: (message: string) => void
  private session: LiveSession | undefined
  private summary: AbacoBrowserScreenRecordingStatus = {
    recording: false,
    sessionId: '',
    startedAt: '',
    lastRecordingPath: '',
    lastError: ''
  }

  constructor(options: AbacoBrowserScreenRecorderOptions) {
    this.outputDir = options.outputDir
    this.parent = options.parent
    this.now = options.now ?? (() => new Date())
    this.log = options.log ?? ((message) => console.warn(`[abaco-browser-screen] ${message}`))
  }

  isRecording(): boolean {
    return this.session !== undefined
  }

  status(): AbacoBrowserScreenRecordingStatus {
    const live = this.session
    if (!live) return { ...this.summary }
    return {
      recording: true,
      sessionId: live.sessionId,
      startedAt: live.startedAt,
      lastRecordingPath: '',
      lastError: this.summary.lastError
    }
  }

  async start(): Promise<AbacoBrowserScreenRecordingStatus> {
    if (this.session) return this.status()
    if (this.parent.isDestroyed()) {
      throw new Error('The ABACO DEEP HARNES window is no longer available for screen recording.')
    }

    const startedAt = this.now().toISOString()
    const sessionId = startedAt.replace(/[:.]/gu, '-')
    await mkdir(this.outputDir, { recursive: true })

    const sourceId = await this.resolveSourceId()
    const recorderWindow = new BrowserWindow({
      show: false,
      width: 8,
      height: 8,
      skipTaskbar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false
      }
    })

    // Trusted-app media grant so getUserMedia(desktop) can run in this window.
    recorderWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media' || permission === 'display-capture')
    })
    recorderWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
      return permission === 'media' || permission === 'display-capture'
    })

    try {
      await recorderWindow.loadURL('about:blank')
      await recorderWindow.webContents.executeJavaScript(buildStartRecorderSource(sourceId), true)
    } catch (error) {
      if (!recorderWindow.isDestroyed()) recorderWindow.destroy()
      this.summary = {
        recording: false,
        sessionId: '',
        startedAt: '',
        lastRecordingPath: this.summary.lastRecordingPath,
        lastError: describe(error)
      }
      throw new Error(`Screen recording failed to start: ${describe(error)}`)
    }

    this.session = {
      sessionId,
      startedAt,
      startedMs: Date.now(),
      sourceId,
      recorderWindow
    }
    this.summary = {
      recording: true,
      sessionId,
      startedAt,
      lastRecordingPath: '',
      lastError: ''
    }
    return this.status()
  }

  async stop(): Promise<AbacoBrowserScreenRecordingResult> {
    const live = this.session
    if (!live) {
      throw new Error('The ABACO browser screen recorder is not recording.')
    }
    this.session = undefined

    const durationMs = Math.max(0, Date.now() - live.startedMs)
    const outPath = join(this.outputDir, `${live.sessionId}.webm`)

    let base64 = ''
    try {
      if (!live.recorderWindow.isDestroyed()) {
        const result = (await live.recorderWindow.webContents.executeJavaScript(
          buildStopRecorderSource(),
          true
        )) as { ok?: boolean; base64?: string; error?: string; mimeType?: string }
        if (!result || result.ok !== true || typeof result.base64 !== 'string') {
          throw new Error(result?.error || 'MediaRecorder did not return a WebM payload.')
        }
        base64 = result.base64
      } else {
        throw new Error('The screen-recorder window was destroyed before stop.')
      }
    } catch (error) {
      this.destroyWindow(live.recorderWindow)
      this.summary = {
        recording: false,
        sessionId: live.sessionId,
        startedAt: live.startedAt,
        lastRecordingPath: '',
        lastError: describe(error)
      }
      return {
        ok: false,
        path: '',
        sessionId: live.sessionId,
        durationMs,
        mimeType: 'video/webm',
        byteLength: 0,
        notice: `Screen recording failed to save: ${describe(error)}`
      }
    }

    this.destroyWindow(live.recorderWindow)

    try {
      const bytes = Buffer.from(base64, 'base64')
      await writeFile(outPath, bytes)
      this.summary = {
        recording: false,
        sessionId: live.sessionId,
        startedAt: live.startedAt,
        lastRecordingPath: outPath,
        lastError: ''
      }
      return {
        ok: true,
        path: outPath,
        sessionId: live.sessionId,
        durationMs,
        mimeType: 'video/webm',
        byteLength: bytes.byteLength,
        notice: `Screen recording saved (${bytes.byteLength} bytes, ${durationMs} ms): ${outPath}`
      }
    } catch (error) {
      this.summary = {
        recording: false,
        sessionId: live.sessionId,
        startedAt: live.startedAt,
        lastRecordingPath: '',
        lastError: describe(error)
      }
      return {
        ok: false,
        path: '',
        sessionId: live.sessionId,
        durationMs,
        mimeType: 'video/webm',
        byteLength: 0,
        notice: `Screen recording failed to write: ${describe(error)}`
      }
    }
  }

  /** Abort without persisting — used when the parent window is destroyed. */
  async abort(): Promise<void> {
    const live = this.session
    if (!live) return
    this.session = undefined
    try {
      if (!live.recorderWindow.isDestroyed()) {
        await live.recorderWindow.webContents.executeJavaScript(
          `(() => { try { window.__abacoScreenRecorder?.stop?.(); } catch (_) {} return true })()`,
          true
        )
      }
    } catch {
      // best-effort
    }
    this.destroyWindow(live.recorderWindow)
    this.summary = {
      recording: false,
      sessionId: live.sessionId,
      startedAt: live.startedAt,
      lastRecordingPath: '',
      lastError: 'aborted'
    }
  }

  private destroyWindow(win: BrowserWindow): void {
    try {
      if (!win.isDestroyed()) win.destroy()
    } catch {
      // ignore
    }
  }

  private async resolveSourceId(): Promise<string> {
    try {
      const mediaId = this.parent.getMediaSourceId()
      if (typeof mediaId === 'string' && mediaId.length > 0) return mediaId
    } catch {
      // Older Electron builds may not expose getMediaSourceId; fall through.
    }
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 1, height: 1 }
    })
    if (sources.length === 0) {
      throw new Error('desktopCapturer returned no sources — screen recording is unavailable.')
    }
    const parentTitle = this.parent.getTitle()
    const match =
      sources.find((source) => source.name === parentTitle) ??
      sources.find((source) => source.id.startsWith('window:')) ??
      sources[0]
    return match!.id
  }
}

/** Page script: start MediaRecorder against a desktopCapturer source id. */
function buildStartRecorderSource(sourceId: string): string {
  return `(() => {
  const sourceId = ${JSON.stringify(sourceId)};
  return new Promise((resolve, reject) => {
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    };
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      const stopPromise = new Promise((stopResolve, stopReject) => {
        recorder.onerror = () => stopReject(new Error('MediaRecorder error'));
        recorder.onstop = async () => {
          try {
            for (const track of stream.getTracks()) track.stop();
            const blob = new Blob(chunks, { type: mimeType });
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const step = 0x8000;
            for (let i = 0; i < bytes.length; i += step) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
            }
            stopResolve({ ok: true, base64: btoa(binary), mimeType: blob.type || 'video/webm' });
          } catch (error) {
            stopReject(error);
          }
        };
      });
      window.__abacoScreenRecorder = {
        stop: () => new Promise((resolveStop, rejectStop) => {
          if (recorder.state === 'inactive') {
            resolveStop({ ok: false, error: 'MediaRecorder is already inactive.' });
            return;
          }
          stopPromise.then(resolveStop, rejectStop);
          try { recorder.stop(); } catch (error) { rejectStop(error); }
        })
      };
      recorder.start(1000);
      resolve(true);
    }, (error) => reject(error));
  });
})()`
}

function buildStopRecorderSource(): string {
  return `(() => {
  const api = window.__abacoScreenRecorder;
  if (!api || typeof api.stop !== 'function') {
    return Promise.resolve({ ok: false, error: 'Screen recorder was not started in this window.' });
  }
  return api.stop();
})()`
}
