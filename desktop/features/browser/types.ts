/**
 * Shared types for the embedded browser feature.
 *
 * The browser feature is split into a few collaborating classes:
 *
 *   * {@link EmbeddedBrowser} — wraps an Electron `BrowserView`.
 *   * {@link TakeoverController} — toggles between agent-driven and
 *     manual user control of the view.
 *   * {@link Recorder} — observes DOM events and periodically captures
 *     screenshots into a {@link RecordingSession}.
 *   * {@link SkillGenerator} — turns a recording into a structured skill
 *     by talking to the Claude API (or, on failure, by emitting a raw
 *     fallback recording).
 *
 * All of these modules exchange plain data via the interfaces declared
 * in this file.  Keeping the contracts in one place makes it trivial to
 * mock them in unit tests without spinning up Electron.
 *
 * @module desktop/features/browser/types
 */

/**
 * A single captured browser cookie.
 *
 * Mirrors the subset of `chrome.cookies` fields we care about.  We
 * deliberately don't try to re-export Electron's full `Cookie` type
 * here so that tests can build a `Cookie` literal without needing the
 * `electron` module installed.
 */
export interface Cookie {
  /** Cookie name (e.g. `session`). */
  name: string;
  /** Cookie value. */
  value: string;
  /** Domain the cookie belongs to (`example.com`, not `.example.com`). */
  domain: string;
  /** Path on the domain (`/`). */
  path: string;
  /** Unix epoch (seconds). `null` means session cookie. */
  expirationDate: number | null;
  /** Whether the cookie requires HTTPS. */
  secure: boolean;
  /** Whether the cookie is HTTP-only. */
  httpOnly: boolean;
  /** SameSite attribute. */
  sameSite: "no_restriction" | "lax" | "strict" | "unspecified";
}

/**
 * Resolves when the requested action is complete.  `click` and `type`
 * throw when the selector cannot be resolved within `timeoutMs`.
 */
export interface ClickOptions {
  timeoutMs?: number;
  /** If true, perform a `dispatchEvent('click')` instead of a real
   *  OS-level click.  Useful when the BrowserView is hidden. */
  synthetic?: boolean;
}

export interface TypeOptions {
  timeoutMs?: number;
  /** Press Enter after typing. */
  submit?: boolean;
  /** Clear the field before typing. */
  clear?: boolean;
}

/**
 * Why the takeover state changed.  Useful for the UI panel to show a
 * hint about the next user action.
 */
export type TakeoverReason =
  | "user_request"
  | "agent_request"
  | "recording_started"
  | "recording_stopped"
  | "browser_navigated"
  | "error";

/**
 * What kind of input the recorder captured.  Mirrors the spec from the
 * task description.
 */
export type ActionType =
  | "click"
  | "type"
  | "navigate"
  | "scroll"
  | "screenshot"
  | "wait";

/**
 * One captured user action.
 */
export interface RecordedAction {
  /** ISO-8601 timestamp at which the action happened. */
  timestamp: string;
  /** URL of the page at the moment of the action. */
  url: string;
  /** Action type. */
  action_type: ActionType;
  /** CSS / XPath / aria-selector used (when applicable). */
  selector?: string;
  /** Typed text (already redacted). */
  text?: string;
  /** Absolute path to the screenshot on disk, if any. */
  screenshot_path?: string;
  /** Free-form notes (e.g. page title, focus info). */
  notes?: string;
}

/**
 * A full recording session — produced by {@link Recorder.stop}.
 */
export interface RecordingSession {
  session_id: string;
  started_at: string;
  ended_at: string;
  actions: RecordedAction[];
  final_url: string;
  title: string;
  /** Where the raw JSON of this session was persisted on disk. */
  source_path?: string;
}

/**
 * The output of {@link SkillGenerator.generate}.
 *
 * The Python side (see `core/skills/models.py`) defines the canonical
 * `Skill` shape; this TypeScript shape mirrors it so the JSON payload
 * can cross the language boundary without surprises.
 */
export interface GeneratedSkill {
  name: string;
  description: string;
  trigger_patterns: string[];
  steps: SkillStep[];
  preconditions: string[];
}

export interface SkillStep {
  action: "navigate" | "click" | "type" | "wait" | "screenshot";
  selector?: string;
  value?: string;
  /** Optional human-readable note about this step. */
  notes?: string;
}

/**
 * Result of {@link SkillGenerator.generate}.  When `ok` is false the
 * caller should surface `error` to the user and offer the raw fallback
 * (see spec — "guardar recording crudo").
 */
export type SkillGenerationResult =
  | { ok: true; skill: GeneratedSkill; model: string }
  | { ok: false; error: string; fallback_available: boolean };

/**
 * The minimum surface an Electron `BrowserView` exposes that this
 * feature needs.  Tests substitute a fake.
 */
export interface BrowserViewLike {
  webContents: {
    loadURL(url: string): Promise<void>;
    executeJavaScript(code: string): Promise<unknown>;
    capturePage(): Promise<{ toPNG(): Buffer }>;
    session: {
      cookies: {
        get(filter: { domain?: string }): Promise<Cookie[]>;
        set(cookies: Partial<Cookie>[]): Promise<void>;
        clear(): Promise<void>;
      };
    };
    on(event: "did-navigate", listener: (_e: unknown, url: string) => void): void;
    on(event: "did-finish-load", listener: () => void): void;
    on(event: "dom-ready", listener: () => void): void;
    on(event: "console-message", listener: (_e: unknown, level: number, message: string) => void): void;
    removeAllListeners(event: string): void;
  };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setAutoResize(options: { width: boolean; height: boolean }): void;
}

/**
 * Filesystem abstraction for the cookie store and recording files.
 * Injected so tests can use an in-memory map.
 */
export interface FsLike {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
}

/**
 * HTTP client abstraction for the Claude API call.  Injected so tests
 * don't need to monkeypatch `fetch`.
 */
export interface HttpLike {
  fetch(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;
}
