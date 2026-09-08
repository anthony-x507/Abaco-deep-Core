/**
 * `ui-panel.tsx` — the small React panel rendered alongside the
 * embedded browser view.
 *
 * The panel exposes:
 *
 *   * a URL input + Go button,
 *   * the current mode + a "Tomar control / Devolver al agente" toggle,
 *   * a "Grabar / Detener grabación" button,
 *   * the latest status line ("Recording…", "Skill saved", etc).
 *
 * It is intentionally written as a function component with no global
 * state — everything that matters lives in the bridge so the panel can
 * be re-mounted freely (HMR, route changes, …).
 *
 * @module desktop/features/browser/ui-panel
 */

import * as React from "react";
import type { AbacoBrowserBridge } from "./preload-bridge.js";

declare global {
  interface Window {
    abacoBrowser: AbacoBrowserBridge;
  }
}

export type UiMode = "agent" | "manual";
export type UiStatus =
  | { kind: "idle" }
  | { kind: "recording"; sessionId: string; startedAt: string }
  | { kind: "generating"; sessionId: string }
  | { kind: "skill-saved"; skillId: string; name: string }
  | { kind: "error"; message: string };

export interface BrowserPanelProps {
  /** Injected for tests; defaults to `window.abacoBrowser`. */
  bridge?: AbacoBrowserBridge;
  /** Initial URL. */
  initialUrl?: string;
  /** Override the panel's CSS class. */
  className?: string;
}

/**
 * The browser control panel.
 */
export const BrowserPanel: React.FC<BrowserPanelProps> = ({
  bridge,
  initialUrl = "https://example.com",
  className,
}) => {
  const effective = bridge ?? (typeof window !== "undefined" ? window.abacoBrowser : undefined);

  const [url, setUrl] = React.useState(initialUrl);
  const [mode, setMode] = React.useState<UiMode>("agent");
  const [currentUrl, setCurrentUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [status, setStatus] = React.useState<UiStatus>({ kind: "idle" });
  const [busy, setBusy] = React.useState(false);

  // Sync the panel with the bridge on mount.
  React.useEffect(() => {
    if (!effective) return;
    let cancelled = false;
    void (async () => {
      try {
        const [m, u, t] = await Promise.all([
          effective.getMode(),
          effective.getCurrentUrl(),
          effective.getCurrentTitle(),
        ]);
        if (cancelled) return;
        setMode(m);
        setCurrentUrl(u);
        setTitle(t);
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effective]);

  const refreshCurrent = React.useCallback(async () => {
    if (!effective) return;
    const [u, t] = await Promise.all([
      effective.getCurrentUrl(),
      effective.getCurrentTitle(),
    ]);
    setCurrentUrl(u);
    setTitle(t);
  }, [effective]);

  const onGo = React.useCallback(async () => {
    if (!effective || busy) return;
    setBusy(true);
    try {
      await effective.navigate(url);
      await refreshCurrent();
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [effective, url, busy, refreshCurrent]);

  const onToggleTakeover = React.useCallback(async () => {
    if (!effective || busy) return;
    setBusy(true);
    try {
      const next: "agent" | "user" = mode === "agent" ? "user" : "agent";
      await effective.requestTakeover(next);
      const newMode = await effective.getMode();
      setMode(newMode);
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [effective, mode, busy]);

  const onToggleRecording = React.useCallback(async () => {
    if (!effective || busy) return;
    setBusy(true);
    try {
      if (status.kind === "recording") {
        const summary = await effective.stopRecording();
        setStatus({ kind: "generating", sessionId: summary.session_id });
        try {
          const skill = await effective.generateSkill(summary.session_id);
          setStatus({
            kind: "skill-saved",
            skillId: skill.skill_id,
            name: skill.name,
          });
        } catch (err) {
          // The Python side may also refuse; we offer the raw fallback.
          await effective.saveRawRecording(summary.session_id);
          setStatus({
            kind: "error",
            message: `Skill generation failed (${(err as Error).message}); raw recording saved.`,
          });
        }
      } else {
        const sessionId = await effective.startRecording();
        setStatus({
          kind: "recording",
          sessionId,
          startedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [effective, busy, status]);

  if (!effective) {
    return (
      <div className={cx("abaco-browser-panel", className)} data-testid="browser-panel-error">
        abacoBrowser bridge not available
      </div>
    );
  }

  return (
    <div
      className={cx("abaco-browser-panel", className)}
      data-mode={mode}
      data-status={status.kind}
      data-testid="browser-panel"
    >
      <form
        className="abaco-browser-panel__row"
        onSubmit={(e) => {
          e.preventDefault();
          void onGo();
        }}
      >
        <input
          aria-label="URL"
          className="abaco-browser-panel__url"
          data-testid="browser-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="abaco-browser-panel__go"
          data-testid="browser-go"
          disabled={busy}
        >
          Go
        </button>
      </form>

      <div className="abaco-browser-panel__row" data-testid="browser-current">
        <span className="abaco-browser-panel__label">URL actual:</span>
        <span className="abaco-browser-panel__value">{currentUrl || "(vacío)"}</span>
        <span className="abaco-browser-panel__label">Título:</span>
        <span className="abaco-browser-panel__value">{title || "(vacío)"}</span>
      </div>

      <div className="abaco-browser-panel__row">
        <button
          type="button"
          className="abaco-browser-panel__takeover"
          data-testid="browser-takeover"
          onClick={onToggleTakeover}
          disabled={busy}
        >
          {mode === "agent" ? "Tomar control" : "Devolver al agente"}
        </button>

        <button
          type="button"
          className={
            "abaco-browser-panel__record" +
            (status.kind === "recording" ? " is-recording" : "")
          }
          data-testid="browser-record"
          onClick={onToggleRecording}
          disabled={busy}
        >
          {status.kind === "recording" ? "Detener grabación" : "Grabar"}
        </button>
      </div>

      <div className="abaco-browser-panel__status" data-testid="browser-status" role="status">
        <StatusLine status={status} />
      </div>
    </div>
  );
};

const StatusLine: React.FC<{ status: UiStatus }> = ({ status }) => {
  switch (status.kind) {
    case "idle":
      return <>Listo.</>;
    case "recording":
      return <>Grabando sesión {status.sessionId.slice(0, 8)}…</>;
    case "generating":
      return <>Generando skill para {status.sessionId.slice(0, 8)}…</>;
    case "skill-saved":
      return <>Skill “{status.name}” guardado ({status.skillId.slice(0, 8)}).</>;
    case "error":
      return <>⚠ {status.message}</>;
  }
};

function cx(...parts: Array<string | undefined | false | null>): string {
  return parts.filter(Boolean).join(" ");
}

export default BrowserPanel;
