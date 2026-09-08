/**
 * Preload bridge — the small surface area exposed to the renderer
 * (UI panel) via Electron's `contextBridge`.
 *
 * The renderer never touches Electron APIs directly.  Instead it talks
 * to `window.abacoBrowser`, which is built here.  All IPC channels go
 * through `ipcRenderer.invoke` so the main process can enforce the
 * agent / manual mode policy before acting.
 *
 * @module desktop/features/browser/preload-bridge
 */

import type { IpcRenderer } from "electron";

/**
 * The API surface exposed to the renderer.
 *
 * Keep it intentionally small — every method here is a privilege the
 * renderer can ask for.  In particular, `navigate`, `click` and
 * `type` go through the takeover controller in the main process.
 */
export interface AbacoBrowserBridge {
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  screenshot(): Promise<string>; // base64 data URL
  getCurrentUrl(): Promise<string>;
  getCurrentTitle(): Promise<string>;
  requestTakeover(actor: "agent" | "user"): Promise<void>;
  getMode(): Promise<"agent" | "manual">;
  startRecording(): Promise<string>; // session id
  stopRecording(): Promise<RecordingSummary>;
  saveRawRecording(sessionId: string): Promise<string>; // path
  generateSkill(sessionId: string): Promise<SkillSummary>;
  listSkills(): Promise<SkillSummary[]>;
  listRecordings(): Promise<RecordingSummary[]>;
}

export interface RecordingSummary {
  session_id: string;
  started_at: string;
  ended_at: string;
  final_url: string;
  title: string;
  source_path?: string;
  action_count: number;
}

export interface SkillSummary {
  skill_id: string;
  name: string;
  description: string;
  trigger_patterns: string[];
  version: number;
  created_at: string;
  source_recording_id: string;
  generated_by_model: string;
}

export type BridgeChannel =
  | "abaco:browser:navigate"
  | "abaco:browser:click"
  | "abaco:browser:type"
  | "abaco:browser:screenshot"
  | "abaco:browser:current"
  | "abaco:browser:takeover"
  | "abaco:browser:mode"
  | "abaco:browser:recording:start"
  | "abaco:browser:recording:stop"
  | "abaco:browser:recording:save-raw"
  | "abaco:browser:recording:list"
  | "abaco:browser:skill:generate"
  | "abaco:browser:skill:list";

/**
 * Build the bridge that will be installed on `window.abacoBrowser`.
 *
 * @param ipc — Electron's `ipcRenderer`, or a fake for tests.
 */
export function buildBridge(ipc: IpcRenderer): AbacoBrowserBridge {
  return {
    navigate: (url) => ipc.invoke("abaco:browser:navigate", { url }),
    click: (selector) => ipc.invoke("abaco:browser:click", { selector }),
    type: (selector, text) =>
      ipc.invoke("abaco:browser:type", { selector, text }),
    screenshot: () => ipc.invoke("abaco:browser:screenshot"),
    getCurrentUrl: () => ipc.invoke("abaco:browser:current", { field: "url" }),
    getCurrentTitle: () =>
      ipc.invoke("abaco:browser:current", { field: "title" }),
    requestTakeover: (actor) =>
      ipc.invoke("abaco:browser:takeover", { actor }),
    getMode: () => ipc.invoke("abaco:browser:mode"),
    startRecording: () => ipc.invoke("abaco:browser:recording:start"),
    stopRecording: () => ipc.invoke("abaco:browser:recording:stop"),
    saveRawRecording: (sessionId) =>
      ipc.invoke("abaco:browser:recording:save-raw", { sessionId }),
    generateSkill: (sessionId) =>
      ipc.invoke("abaco:browser:skill:generate", { sessionId }),
    listSkills: () => ipc.invoke("abaco:browser:skill:list"),
    listRecordings: () => ipc.invoke("abaco:browser:recording:list"),
  };
}

/**
 * The function Electron calls in the preload script.  Returns a
 * strongly-typed object so the renderer can `import { abacoBrowser }`
 * via TypeScript declaration merging.
 */
export function installBridge(
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => void },
  ipc: IpcRenderer,
): AbacoBrowserBridge {
  const bridge = buildBridge(ipc);
  contextBridge.exposeInMainWorld("abacoBrowser", bridge);
  return bridge;
}
