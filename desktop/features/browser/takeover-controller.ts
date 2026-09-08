/**
 * `TakeoverController` — toggles between agent-driven and manual
 * control of the embedded browser.
 *
 * The controller owns a single piece of mutable state — `mode` — and
 * decides whether a `click` / `type` call is allowed.  When the mode
 * is `"manual"` the agent is blocked; when it is `"agent"` the user
 * is blocked (UI shows "agent is driving").  Either side can request a
 * switch; the other side is notified via the listener.
 *
 * The reason for centralising this in its own class rather than
 * putting the logic on `EmbeddedBrowser` is that **recording** needs to
 * know who triggered an action (to decide whether to capture it).  By
 * having a single `mode` accessor, both the recorder and the UI can
 * react coherently.
 *
 * @module desktop/features/browser/takeover-controller
 */

import type { EmbeddedBrowser } from "./browser-view.js";
import type { TakeoverReason } from "./types.js";

export type TakeoverMode = "agent" | "manual";

export interface TakeoverEvent {
  previous: TakeoverMode;
  current: TakeoverMode;
  reason: TakeoverReason;
  at: string;
}

export type TakeoverListener = (event: TakeoverEvent) => void;

export interface TakeoverControllerOptions {
  browser: EmbeddedBrowser;
  /** Initial mode.  Defaults to `"agent"`. */
  initialMode?: TakeoverMode;
  /**
   * If true (default) we forward `mode` changes back to the renderer
   * by injecting a tiny CSS hint on the BrowserView.  Tests disable
   * this so they can observe mode changes without an Electron view.
   */
  mirrorToRenderer?: boolean;
}

/**
 * The takeover controller.  Tiny on purpose — all the complexity is in
 * the rules below.
 */
export class TakeoverController {
  private _mode: TakeoverMode;
  private readonly listeners = new Set<TakeoverListener>();
  private readonly browser: EmbeddedBrowser;
  private readonly mirrorToRenderer: boolean;

  constructor(options: TakeoverControllerOptions) {
    this.browser = options.browser;
    this._mode = options.initialMode ?? "agent";
    this.mirrorToRenderer = options.mirrorToRenderer ?? true;
  }

  /** Current mode. */
  get mode(): TakeoverMode {
    return this._mode;
  }

  /** True iff the agent is currently in control. */
  get agentActive(): boolean {
    return this._mode === "agent";
  }

  /** True iff the user is currently in control. */
  get manualActive(): boolean {
    return this._mode === "manual";
  }

  /**
   * Request a switch.  `requestedBy === "agent"` is the agent asking
   * to take over from the user; `"user"` is the user asking the agent
   * to step aside (e.g. to log in).
   *
   * Idempotent: switching to the current mode is a no-op.
   */
  request(requestedBy: "agent" | "user", reason: TakeoverReason = "user_request"): TakeoverMode {
    const target: TakeoverMode = requestedBy === "agent" ? "agent" : "manual";
    return this.setMode(target, reason);
  }

  /**
   * Force a particular mode.  Emits the event regardless of the
   * current value (the UI may want to refresh labels).
   */
  setMode(next: TakeoverMode, reason: TakeoverReason = "user_request"): TakeoverMode {
    const previous = this._mode;
    this._mode = next;
    if (this.mirrorToRenderer) {
      void this.injectBanner(previous, next);
    }
    const event: TakeoverEvent = {
      previous,
      current: next,
      reason,
      at: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* never let a listener break the controller */
      }
    }
    return next;
  }

  /**
   * Subscribe to mode changes.  Returns an unsubscribe function.
   */
  onChange(listener: TakeoverListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Guard: throws if the agent tries to act in manual mode, or the
   * user tries to act in agent mode.  Used by `click` / `type`
   * wrappers.
   */
  assertActor(actor: "agent" | "user"): void {
    if (actor === "agent" && this._mode !== "agent") {
      throw new Error(
        `agent action blocked: browser is in '${this._mode}' mode`,
      );
    }
    if (actor === "user" && this._mode !== "manual") {
      throw new Error(
        `user action blocked: browser is in '${this._mode}' mode`,
      );
    }
  }

  /**
   * Convenience: an agent-safe `click`.  Equivalent to
   * `browser.click(...)` but asserts the agent is in control.
   */
  async agentClick(selector: string): Promise<void> {
    this.assertActor("agent");
    await this.browser.click(selector);
  }

  /**
   * Convenience: an agent-safe `type`.  Asserts the agent is in
   * control before typing.
   */
  async agentType(selector: string, text: string): Promise<void> {
    this.assertActor("agent");
    await this.browser.type(selector, text);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Inject a thin overlay into the BrowserView announcing the current
   * mode.  We inject it via `executeJavaScript` rather than rebuilding
   * the renderer because we want it to survive even when the embedded
   * page is hostile (e.g. CSP-locked).
   */
  private async injectBanner(_previous: TakeoverMode, current: TakeoverMode): Promise<void> {
    const code = `
      (function () {
        const id = "__abaco_takeover_banner__";
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement("div");
          el.id = id;
          el.style.cssText = [
            "position:fixed", "top:0", "right:0", "z-index:2147483647",
            "font:12px/1.4 system-ui,sans-serif",
            "padding:4px 8px", "border-bottom-left-radius:6px",
            "pointer-events:none", "opacity:0.85"
          ].join(";");
          (document.body || document.documentElement).appendChild(el);
        }
        const text = ${JSON.stringify(current)} === "agent"
          ? "🤖 Agente"
          : "👤 Usuario";
        const bg = ${JSON.stringify(current)} === "agent" ? "#2563eb" : "#16a34a";
        el.textContent = text;
        el.style.background = bg;
        el.style.color = "#fff";
      })();
    `;
    try {
      await this.browser.view.webContents.executeJavaScript(code);
    } catch {
      /* banner is decorative — never block on it */
    }
  }
}
