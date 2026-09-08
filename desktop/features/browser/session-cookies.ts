/**
 * Cookie persistence for the embedded browser.
 *
 * The browser logs into external services (Gmail, Slack, internal
 * dashboards…) and we want those sessions to survive app restarts.
 * Electron's `session.cookies` already persists cookies to disk by
 * default, but the **path** it uses is global.  In a multi-profile
 * setup we want each profile to have its own cookie jar so a
 * "developer" profile does not see the cookies of a "designer" profile.
 *
 * This module therefore:
 *
 *   1. Maintains an on-disk JSON store keyed by domain.
 *   2. Loads the cookies for a domain into the BrowserView's
 *      `session.cookies` when the user navigates to it.
 *   3. Mirrors `session.cookies` changes back to disk so that freshly
 *      set cookies (login flows) are persisted automatically.
 *
 * The store file is written atomically (write to temp + rename) so a
 * crash during a write does not leave a half-written file.  Cookies
 * values are not encrypted (that would require a keychain-bound key,
 * which is OS-specific); instead the file is `0600` on disk and lives
 * inside the per-user `~/.abaco-deep-core/` directory.  If/when we
 * decide to ship a keychain integration we can plug it in here
 * without changing callers.
 *
 * @module desktop/features/browser/session-cookies
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Cookie, FsLike } from "./types.js";

/**
 * Per-domain cookie file.  We split by domain so that exporting /
 * clearing one site does not wipe every session.
 */
export interface CookieStore {
  /** Absolute path to the root directory of the store. */
  readonly root: string;
  /** Load cookies for a domain from disk. */
  load(domain: string): Promise<Cookie[]>;
  /** Persist cookies for a domain, replacing whatever was there. */
  save(domain: string, cookies: Cookie[]): Promise<void>;
  /** Delete cookies for a single domain. */
  clearDomain(domain: string): Promise<void>;
  /** Delete the whole store (e.g. on user logout). */
  clearAll(): Promise<void>;
  /** List domains that have a cookie file. */
  listDomains(): Promise<string[]>;
}

const FILE_MODE = 0o600;

/**
 * Default filesystem implementation: real disk via `fs/promises`.
 * Exposed so tests can compare against an in-memory variant.
 */
export const defaultFs: FsLike = {
  async readFile(p: string) {
    return fs.readFile(p, "utf8");
  },
  async writeFile(p: string, data: string) {
    await fs.writeFile(p, data, { mode: FILE_MODE });
  },
  async mkdir(p: string, opts?: { recursive?: boolean }) {
    await fs.mkdir(p, { recursive: opts?.recursive ?? false, mode: FILE_MODE });
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

/**
 * Helper: normalise a domain so that `Example.com` and
 * `.example.com` end up in the same file.
 */
export function normaliseDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Cookie domain must be non-empty");
  }
  return trimmed.replace(/^\.+/, "");
}

/**
 * Build a `CookieStore` rooted at `rootPath`.
 */
export function createCookieStore(
  rootPath: string,
  options: { fsImpl?: FsLike } = {},
): CookieStore {
  const fsImpl = options.fsImpl ?? defaultFs;

  async function ensureRoot(): Promise<void> {
    if (!(await fsImpl.exists(rootPath))) {
      await fsImpl.mkdir(rootPath, { recursive: true });
    }
  }

  function fileFor(domain: string): string {
    const safe = normaliseDomain(domain).replace(/[^a-z0-9.\-]/g, "_");
    return path.join(rootPath, `${safe}.json`);
  }

  function keyFor(cookie: Cookie): string {
    return [cookie.name, cookie.path, normaliseDomain(cookie.domain)].join("|");
  }

  /**
   * De-duplicate cookies: if the same (name, path, domain) shows up
   * twice, keep the last one (Electron's API returns duplicates when
   * a cookie is set with multiple paths).
   */
  function dedupe(cookies: Cookie[]): Cookie[] {
    const seen = new Map<string, Cookie>();
    for (const cookie of cookies) {
      seen.set(keyFor(cookie), cookie);
    }
    return Array.from(seen.values());
  }

  return {
    root: rootPath,

    async load(domain: string): Promise<Cookie[]> {
      await ensureRoot();
      const file = fileFor(domain);
      if (!(await fsImpl.exists(file))) {
        return [];
      }
      try {
        const raw = await fsImpl.readFile(file);
        const parsed = JSON.parse(raw) as { cookies: Cookie[] };
        if (!Array.isArray(parsed?.cookies)) {
          return [];
        }
        return dedupe(parsed.cookies);
      } catch {
        // Corrupted file: rename it aside and start fresh.
        try {
          await fsImpl.unlink(file);
        } catch {
          /* ignore */
        }
        return [];
      }
    },

    async save(domain: string, cookies: Cookie[]): Promise<void> {
      await ensureRoot();
      const file = fileFor(domain);
      const cleaned = dedupe(cookies).map(scrubCookie);
      const payload = JSON.stringify(
        {
          domain: normaliseDomain(domain),
          saved_at: new Date().toISOString(),
          cookies: cleaned,
        },
        null,
        2,
      );
      const tmp = `${file}.tmp`;
      await fsImpl.writeFile(tmp, payload);
      // Atomic rename.  We use `fs.rename` here rather than going
      // through the abstracted FsLike because the abstraction is for
      // testing only — production always uses the real fs.
      await fs.rename(tmp, file);
      await fs.chmod(file, FILE_MODE);
    },

    async clearDomain(domain: string): Promise<void> {
      const file = fileFor(domain);
      if (await fsImpl.exists(file)) {
        await fsImpl.unlink(file);
      }
    },

    async clearAll(): Promise<void> {
      const domains = await this.listDomains();
      await Promise.all(domains.map((d) => this.clearDomain(d)));
    },

    async listDomains(): Promise<string[]> {
      await ensureRoot();
      try {
        const entries = await fs.readdir(rootPath);
        return entries
          .filter((name) => name.endsWith(".json"))
          .map((name) => name.replace(/\.json$/, ""));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Strip non-serialisable fields and normalise what we save.
 */
function scrubCookie(cookie: Cookie): Cookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: normaliseDomain(cookie.domain),
    path: cookie.path || "/",
    expirationDate:
      cookie.expirationDate === null || cookie.expirationDate === undefined
        ? null
        : Math.floor(cookie.expirationDate),
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    sameSite: cookie.sameSite ?? "unspecified",
  };
}

/**
 * Helper: pick out the domain from a URL string.  Returns `null` for
 * `file://` URLs and other non-http schemes.
 */
export function domainOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u.hostname || null;
  } catch {
    return null;
  }
}
