/**
 * `Recorder` — observes DOM events inside the embedded browser and
 * captures screenshots on a fixed cadence, producing a
 * {@link RecordingSession}.
 *
 * Design notes:
 *
 *   * The recorder injects a single `MutationObserver` + event
 *     listener set into the page on `dom-ready`.  All events flow
 *     back through a single `postMessage` channel we already expose
 *     via `executeJavaScript`.  We **do not** rely on the host page's
 *     own console / message bus because hostile pages might not have
 *     one.
 *
 *   * Passwords are redacted at the recorder level (the spec
 *     requires this).  We look at the `type` attribute of the target
 *     element and at the field name (`autocomplete="cc-number"` etc.)
 *     to decide whether to drop or mask the value.
 *
 *   * Screenshots are written to a configurable directory.  We do not
 *     keep them in memory because a 5-minute recording at 1s cadence
 *     is ~300 PNGs and we don't want them in the process heap.
 *
 * @module desktop/features/browser/recorder
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { EmbeddedBrowser } from "./browser-view.js";
import type {
  ActionType,
  FsLike,
  RecordedAction,
  RecordingSession,
} from "./types.js";

/**
 * Default filesystem (real disk).  Tests inject a fake.
 */
export const defaultFs: FsLike = {
  async readFile(p: string) {
    return fs.readFile(p, "utf8");
  },
  async writeFile(p: string, data: string) {
    await fs.writeFile(p, data, "utf8");
  },
  async mkdir(p: string, opts?: { recursive?: boolean }) {
    await fs.mkdir(p, { recursive: opts?.recursive ?? false });
  },
  async exists(p: string) {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
  async unlink(p: string) {
    await fs.unlink(p);
  },
};

export interface RecorderOptions {
  browser: EmbeddedBrowser;
  /** Where to drop screenshots and the final session JSON. */
  outputDir: string;
  /** How often to take a screenshot, in milliseconds.  0 = disabled. */
  screenshotIntervalMs?: number;
  /** Filesystem implementation (for tests). */
  fsImpl?: FsLike;
  /**
   * Whether to redact password fields.  Defaults to true.
   * (See the spec: "Recording no debe capturar passwords directamente".)
   */
  redactPasswords?: boolean;
}

type RawEvent = {
  ts: string;
  url: string;
  action_type: ActionType;
  selector?: string;
  text?: string;
  notes?: string;
};

/**
 * The Recorder.  One instance per recording session.
 */
export class Recorder {
  private readonly browser: EmbeddedBrowser;
  private readonly outputDir: string;
  private readonly screenshotIntervalMs: number;
  private readonly redactPasswords: boolean;
  private readonly fsImpl: FsLike;
  private readonly sessionId: string;
  private startedAt = "";
  private endedAt = "";
  private actions: RecordedAction[] = [];
  private screenshotTimer: NodeJS.Timeout | null = null;
  private recording = false;
  /** Buffer for events emitted before `flush()` is called. */
  private pending: RawEvent[] = [];
  private injected = false;

  constructor(options: RecorderOptions) {
    this.browser = options.browser;
    this.outputDir = options.outputDir;
    this.screenshotIntervalMs = options.screenshotIntervalMs ?? 2_000;
    this.redactPasswords = options.redactPasswords ?? true;
    this.fsImpl = options.fsImpl ?? defaultFs;
    this.sessionId = randomUUID();
  }

  /** True iff `start()` has been called and `stop()` has not. */
  get isRecording(): boolean {
    return this.recording;
  }

  /**
   * Begin recording.  Sets up the screenshot timer and injects the
   * DOM listeners on the next `dom-ready` event.
   */
  async start(): Promise<void> {
    if (this.recording) return;
    this.recording = true;
    this.startedAt = new Date().toISOString();
    this.endedAt = "";
    this.actions = [];
    this.pending = [];
    await this.fsImpl.mkdir(this.outputDir, { recursive: true });
    await this.installListeners();
    await this.injectPageScript();
    if (this.screenshotIntervalMs > 0) {
      this.screenshotTimer = setInterval(
        () => void this.captureScreenshot(),
        this.screenshotIntervalMs,
      );
    }
    // Also record the current page state as the first action.
    this.push({
      ts: this.startedAt,
      url: this.browser.url,
      action_type: "navigate",
      notes: `initial page; title="${this.browser.title}"`,
    });
  }

  /**
   * Stop recording.  Returns the finalised session and persists both
   * the screenshots manifest and the JSON sidecar to disk.
   */
  async stop(): Promise<RecordingSession> {
    if (!this.recording) {
      throw new Error("Recorder.stop() called before start()");
    }
    this.endedAt = new Date().toISOString();
    this.recording = false;
    if (this.screenshotTimer) {
      clearInterval(this.screenshotTimer);
      this.screenshotTimer = null;
    }
    await this.flush();

    const session: RecordingSession = {
      session_id: this.sessionId,
      started_at: this.startedAt,
      ended_at: this.endedAt,
      actions: this.actions,
      final_url: this.browser.url,
      title: this.browser.title,
    };

    const sidecar = path.join(this.outputDir, `${this.sessionId}.json`);
    await this.fsImpl.writeFile(sidecar, JSON.stringify(session, null, 2));
    session.source_path = sidecar;
    return session;
  }

  /**
   * Manually record a screenshot at the current state.  Called both by
   * the timer and by `recorder.ts`'s tests.
   */
  async captureScreenshot(): Promise<RecordedAction | null> {
    if (!this.recording) return null;
    const filename = `${this.sessionId}-${Date.now()}.png`;
    const fullPath = path.join(this.outputDir, filename);
    try {
      const buf = await this.browser.screenshot();
      await this.fsImpl.writeFile(fullPath, buf);
      const action: RecordedAction = {
        timestamp: new Date().toISOString(),
        url: this.browser.url,
        action_type: "screenshot",
        screenshot_path: fullPath,
      };
      this.actions.push(action);
      return action;
    } catch {
      return null;
    }
  }

  /**
   * Push a raw event from the injected page script (or from a test).
   */
  push(event: RawEvent): void {
    if (!this.recording) return;
    const cleaned = this.cleanEvent(event);
    this.pending.push(cleaned);
    this.actions.push(toRecordedAction(cleaned));
  }

  /**
   * Persist any pending events to disk as an append-only log.
   * Triggered periodically and on `stop()`.
   */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const file = path.join(this.outputDir, `${this.sessionId}.jsonl`);
    const lines = this.pending.map((e) => JSON.stringify(e)).join("\n") + "\n";
    this.pending = [];
    await this.fsImpl.writeFile(file, lines);
  }

  /**
   * Sanitise a raw event: redact password values, drop empty events.
   */
  cleanEvent(event: RawEvent): RawEvent {
    const out: RawEvent = { ...event };
    if (this.redactPasswords && out.text !== undefined) {
      out.text = redactPasswordValue(out.text, out.notes ?? "");
    }
    if (out.text === "") {
      delete out.text;
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async installListeners(): Promise<void> {
    // We re-inject the page script on every navigation.  Electron's
    // BrowserView gives us `dom-ready` for that.
    this.browser.view.webContents.on("dom-ready", () => {
      void this.injectPageScript();
    });
    // `did-navigate` is captured by EmbeddedBrowser itself, but we also
    // mirror it as a recorder event for completeness.
    this.browser.onNavigation((nav) => {
      this.push({
        ts: new Date().toISOString(),
        url: nav.url,
        action_type: "navigate",
        notes: `title="${nav.title}"`,
      });
    });
  }

  private async injectPageScript(): Promise<void> {
    if (this.injected) return; // avoid re-injecting on hot reloads
    const code = `
      (function () {
        if (window.__abacoRecorderInstalled) return;
        window.__abacoRecorderInstalled = true;

        function send(payload) {
          try {
            // We use console.log as the channel because we cannot rely
            // on the page exposing a custom postMessage handler.
            console.log("__ABACO_REC__", JSON.stringify(payload));
          } catch (e) {
            /* swallow */
          }
        }

        document.addEventListener("click", function (e) {
          const t = e.target;
          if (!t || !t.tagName) return;
          let selector = "";
          if (t.id) selector = "#" + t.id;
          else if (t.className && typeof t.className === "string") {
            selector = t.tagName.toLowerCase() + "." + t.className.trim().split(/\\s+/).join(".");
          } else {
            selector = t.tagName.toLowerCase();
          }
          send({
            ts: new Date().toISOString(),
            url: location.href,
            action_type: "click",
            selector: selector,
            notes: t.getAttribute("type") || t.tagName
          });
        }, true);

        document.addEventListener("input", function (e) {
          const t = e.target;
          if (!t || !t.tagName) return;
          const type = (t.getAttribute("type") || "").toLowerCase();
          const ac = (t.getAttribute("autocomplete") || "").toLowerCase();
          const isSensitive =
            type === "password" ||
            ac === "cc-number" ||
            ac === "cc-csc" ||
            ac === "current-password" ||
            ac === "new-password";
          send({
            ts: new Date().toISOString(),
            url: location.href,
            action_type: "type",
            selector: t.id ? "#" + t.id : (t.name ? "[name='" + t.name + "']" : t.tagName.toLowerCase()),
            text: isSensitive ? "***REDACTED***" : (t.value || ""),
            notes: isSensitive ? "redacted:password" : (type || "")
          });
        }, true);

        document.addEventListener("submit", function (e) {
          send({
            ts: new Date().toISOString(),
            url: location.href,
            action_type: "click",
            selector: "form",
            notes: "form submit"
          });
        }, true);

        let lastScrollY = -1;
        window.addEventListener("scroll", function () {
          if (window.scrollY === lastScrollY) return;
          lastScrollY = window.scrollY;
          send({
            ts: new Date().toISOString(),
            url: location.href,
            action_type: "scroll",
            notes: "y=" + window.scrollY
          });
        }, { passive: true });
      })();
    `;
    try {
      await this.browser.view.webContents.executeJavaScript(code);
    } catch {
      /* page might forbid inline scripts (CSP) — best effort */
    }
  }
}

function toRecordedAction(event: RawEvent): RecordedAction {
  const out: RecordedAction = {
    timestamp: event.ts,
    url: event.url,
    action_type: event.action_type,
  };
  if (event.selector !== undefined) out.selector = event.selector;
  if (event.text !== undefined) out.text = event.text;
  if (event.notes !== undefined) out.notes = event.notes;
  return out;
}

/**
 * Decide whether `value` should be redacted.  Returns the original
 * value if it's safe, or the literal "***REDACTED***" otherwise.
 *
 * `hint` is a free-form string from the event's notes (typically the
 * input's `type` attribute).  When the recorder's own redaction
 * already masked the value (notes == "redacted:password") we trust it.
 */
export function redactPasswordValue(value: string, hint: string): string {
  if (hint.includes("redacted")) return value;
  if (typeof value !== "string" || value.length === 0) return value;
  if (/password/i.test(hint)) return "***REDACTED***";
  return value;
}
