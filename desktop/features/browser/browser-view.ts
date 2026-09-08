/**
 * `EmbeddedBrowser` — thin wrapper over Electron's `BrowserView`.
 *
 * The wrapper exists for three reasons:
 *
 *   1. **Testability** — the rest of the feature (recorder, takeover,
 *      skill generator) only ever talks to `EmbeddedBrowser`, never to
 *      raw `BrowserView`.  Tests substitute a fake.
 *
 *   2. **Persistence hooks** — every navigation automatically
 *      snapshots cookies to the on-disk cookie store so login sessions
 *      survive restarts.
 *
 *   3. **Selector translation** — `click(selector)` and `type(...)` map
 *      high-level selectors (`"#submit"`, `"button.primary"`) onto the
 *      `executeJavaScript` payloads the renderer actually receives.  We
 *      keep that translation in one place so the recorder sees the same
 *      selectors the agent uses.
 *
 * @module desktop/features/browser/browser-view
 */

import { domainOf, type CookieStore } from "./session-cookies.js";
import type {
  BrowserViewLike,
  ClickOptions,
  Cookie,
  TypeOptions,
} from "./types.js";

/**
 * Result of a navigation: when the navigation completes we expose the
 * final URL and the page title to subscribers (the recorder, the UI
 * panel, …).
 */
export interface NavigationResult {
  url: string;
  title: string;
}

/** Listener signature for navigation events. */
export type NavigationListener = (result: NavigationResult) => void;

export interface EmbeddedBrowserOptions {
  /** Pre-built BrowserView (Electron) or a fake (tests). */
  view: BrowserViewLike;
  /** Where to persist cookies. */
  cookieStore: CookieStore;
  /** Initial URL; loaded asynchronously on `start`. */
  initialUrl?: string;
  /**
   * When true, automatically mirror `session.cookies` back to disk
   * after every navigation.  Defaults to true.
   */
  autoPersistCookies?: boolean;
}

/**
 * Thin, opinionated wrapper around a `BrowserView`.
 */
export class EmbeddedBrowser {
  readonly view: BrowserViewLike;
  readonly cookieStore: CookieStore;
  private readonly autoPersistCookies: boolean;
  private currentUrl = "";
  private currentTitle = "";
  private readonly navListeners = new Set<NavigationListener>();
  private started = false;

  constructor(options: EmbeddedBrowserOptions) {
    this.view = options.view;
    this.cookieStore = options.cookieStore;
    this.autoPersistCookies = options.autoPersistCookies ?? true;

    this.view.webContents.on("did-navigate", (_e, url: string) => {
      void this.handleNavigated(url);
    });
    this.view.webContents.on("did-finish-load", () => {
      void this.refreshTitle();
    });
  }

  /**
   * Begin loading the initial URL (if any) and wire up state.
   * Idempotent.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.cookieStore && this.autoPersistCookies) {
      await this.cookieStore.listDomains();
    }
    if (this.initialUrl) {
      await this.navigate(this.initialUrl);
    }
  }

  /**
   * Navigate to `url`.  Resolves when the page has loaded (Electron's
   * `did-finish-load`).  On the way in, cookies for the target domain
   * are pushed back into the BrowserView's session.
   */
  async navigate(url: string): Promise<void> {
    const domain = domainOf(url);
    if (domain) {
      const stored = await this.cookieStore.load(domain);
      if (stored.length > 0) {
        try {
          await this.view.webContents.session.cookies.set(stored);
        } catch {
          /* Setting cookies for a domain we're not yet navigated to
             can fail on some Electron versions; we just ignore — the
             store will catch up after navigation completes. */
        }
      }
    }
    await this.view.webContents.loadURL(url);
  }

  /**
   * Click on `selector` (CSS) inside the page.
   *
   * We use `executeJavaScript` rather than Electron's input injection
   * because it works on hidden views and matches what the recorder
   * sees.  When the selector cannot be resolved we throw.
   */
  async click(selector: string, opts: ClickOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 5_000;
    const synthetic = opts.synthetic ?? true;
    const code = `
      (function () {
        const sel = ${JSON.stringify(selector)};
        const t0 = performance.now();
        const deadline = t0 + ${timeoutMs};
        function find() {
          const el = document.querySelector(sel);
          if (el) return el;
          if (performance.now() >= deadline) return null;
          return new Promise((resolve) =>
            setTimeout(() => resolve(find()), 50)
          );
        }
        return Promise.resolve(find()).then((el) => {
          if (!el) {
            throw new Error("selector not found: " + sel);
          }
          ${synthetic ? "el.dispatchEvent(new MouseEvent('click', { bubbles: true }));" : "el.click();"}
          return { ok: true, tag: el.tagName };
        });
      })();
    `;
    await this.view.webContents.executeJavaScript(code);
  }

  /**
   * Type `text` into `selector`.  Optionally clears first and presses
   * Enter at the end.
   */
  async type(selector: string, text: string, opts: TypeOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 5_000;
    const submit = opts.submit ?? false;
    const clear = opts.clear ?? true;
    const code = `
      (function () {
        const sel = ${JSON.stringify(selector)};
        const txt  = ${JSON.stringify(text)};
        const t0 = performance.now();
        const deadline = t0 + ${timeoutMs};
        function find() {
          const el = document.querySelector(sel);
          if (el) return el;
          if (performance.now() >= deadline) return null;
          return new Promise((resolve) =>
            setTimeout(() => resolve(find()), 50)
          );
        }
        return Promise.resolve(find()).then((el) => {
          if (!el) throw new Error("selector not found: " + sel);
          if (${clear}) { el.value = ""; }
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(
            el.constructor.prototype, "value"
          )?.set;
          if (setter) setter.call(el, txt);
          else el.value = txt;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          if (${submit}) {
            el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
            const form = el.closest("form");
            if (form) form.submit();
          }
          return { ok: true };
        });
      })();
    `;
    await this.view.webContents.executeJavaScript(code);
  }

  /**
   * Capture the current view as a PNG.
   */
  async screenshot(): Promise<Buffer> {
    const img = await this.view.webContents.capturePage();
    return img.toPNG();
  }

  /**
   * Return the cookies the BrowserView currently knows about for
   * `domain`.
   */
  async getCookies(domain?: string): Promise<Cookie[]> {
    return this.view.webContents.session.cookies.get({
      domain: domain ?? "",
    });
  }

  /**
   * Push `cookies` into the BrowserView's session, then mirror the new
   * state to disk.
   */
  async setCookies(cookies: Cookie[]): Promise<void> {
    await this.view.webContents.session.cookies.set(cookies);
    if (this.autoPersistCookies) {
      // Group by domain and persist each group.
      const byDomain = new Map<string, Cookie[]>();
      for (const c of cookies) {
        const k = (c.domain || "").replace(/^\.+/, "");
        const list = byDomain.get(k) ?? [];
        list.push(c);
        byDomain.set(k, list);
      }
      for (const [domain, list] of byDomain) {
        await this.cookieStore.save(domain, list);
      }
    }
  }

  /**
   * Register a navigation listener.  Returns an unsubscribe function.
   */
  onNavigation(listener: NavigationListener): () => void {
    this.navListeners.add(listener);
    return () => this.navListeners.delete(listener);
  }

  /**
   * The URL the page is currently showing.
   */
  get url(): string {
    return this.currentUrl;
  }

  /**
   * The title the page is currently showing.
   */
  get title(): string {
    return this.currentTitle;
  }

  /**
   * Resize the view.  Called by the UI shell when the panel is
   * resized.
   */
  setBounds(b: { x: number; y: number; width: number; height: number }): void {
    this.view.setBounds(b);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async handleNavigated(url: string): Promise<void> {
    this.currentUrl = url;
    await this.refreshTitle();
    if (this.autoPersistCookies) {
      const domain = domainOf(url);
      if (domain) {
        try {
          const cookies = await this.getCookies(domain);
          if (cookies.length > 0) {
            await this.cookieStore.save(domain, cookies);
          }
        } catch {
          /* best effort */
        }
      }
    }
    const result: NavigationResult = { url, title: this.currentTitle };
    for (const listener of this.navListeners) {
      try {
        listener(result);
      } catch {
        /* listener errors must not break navigation */
      }
    }
  }

  private async refreshTitle(): Promise<void> {
    try {
      const t = (await this.view.webContents.executeJavaScript(
        "document.title || ''",
      )) as string;
      this.currentTitle = String(t ?? "");
    } catch {
      this.currentTitle = "";
    }
  }
}
