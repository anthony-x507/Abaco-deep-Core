/**
 * `panel.tsx` — the main browser control panel.
 *
 * The layout follows the mockup from the task spec:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  URL: https://github.com/...                 │
 *   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐  │
 *   │  │  ←   │ │  →   │ │ ⟳    │ │ ⌂   │  │
 *   │  └────────┘ └────────┘ └────────┘ └──────┘  │
 *   │  [📍 Tomar control]  [● Grabar]  [⚙ Settings]│
 *   │                                              │
 *   │  ┌──────────────────────────────────────┐    │
 *   │  │     BrowserView area                  │   │
 *   │  └──────────────────────────────────────┘    │
 *   │                                              │
 *   │  Modo actual: AGENTE | Cambiar a USUARIO     │
 *   └──────────────────────────────────────────────┘
 *
 * The panel is the host shell's "outer" surface — it owns the URL bar
 * and the mode toggle.  The actual web contents are rendered by the
 * host's `BrowserView` (managed by `EmbeddedBrowser`); this component
 * only talks to it through the preload bridge.
 *
 * The panel delegates to the `SkillModal` (see `skill-modal.tsx`)
 * whenever a recording ends, so the user can review and persist the
 * generated skill.
 *
 * @module desktop/features/browser/panel
 */

import * as React from "react";
import type {
  AbacoBrowserBridge,
  BrowserIPC,
  RecordingResult,
  Skill,
} from "./preload-bridge.js";
import { SkillModal, type SkillSaveOutcome } from "./skill-modal.js";

/* ---------------------------------------------------------------- *
 * Window globals                                                  *
 * ---------------------------------------------------------------- */

declare global {
  interface Window {
    abacoBrowser: AbacoBrowserBridge;
  }
}

export type PanelMode = "agent" | "manual";

export type PanelStatus =
  | { kind: "idle" }
  | { kind: "navigating"; url: string }
  | { kind: "recording"; sessionId: string; startedAt: string }
  | { kind: "generating"; sessionId: string }
  | { kind: "error"; message: string };

export interface BrowserPanelProps {
  /** Injected for tests; defaults to `window.abacoBrowser`. */
  bridge?: BrowserIPC;
  /** Initial URL loaded on mount. */
  initialUrl?: string;
  /** Where the "BrowserView area" placeholder should render.  When
   *  omitted the panel renders its own empty viewport rectangle so
   *  the layout is visible in tests / Storybook. */
  viewport?: React.ReactNode;
  /** Called whenever the user wants to open the settings dialog.
   *  When omitted the "Settings" button is hidden. */
  onOpenSettings?: () => void;
  /** Initial takeover mode.  Defaults to `"agent"`. */
  initialMode?: PanelMode;
  /** Optional className for the root element. */
  className?: string;
}

/* ---------------------------------------------------------------- *
 * Helpers                                                          *
 * ---------------------------------------------------------------- */

function cx(...parts: Array<string | undefined | false | null>): string {
  return parts.filter(Boolean).join(" ");
}

function shortId(id: string): string {
  if (!id) return "";
  return id.length > 8 ? id.slice(0, 8) : id;
}

/* ---------------------------------------------------------------- *
 * Component                                                        *
 * ---------------------------------------------------------------- */

/**
 * The main browser control panel.
 */
export const BrowserPanel: React.FC<BrowserPanelProps> = ({
  bridge,
  initialUrl = "https://example.com",
  viewport,
  onOpenSettings,
  initialMode = "agent",
  className,
}) => {
  const effective =
    bridge ??
    (typeof window !== "undefined"
      ? ((window as unknown as { abacoBrowser: BrowserIPC }).abacoBrowser)
      : undefined);

  const [url, setUrl] = React.useState(initialUrl);
  const [mode, setMode] = React.useState<PanelMode>(initialMode);
  const [currentUrl, setCurrentUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [status, setStatus] = React.useState<PanelStatus>({ kind: "idle" });
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<string[]>([]);
  const [future, setFuture] = React.useState<string[]>([]);
  const [pendingSkill, setPendingSkill] = React.useState<{
    skill: Skill;
    recording: RecordingResult;
  } | null>(null);

  // Sync with the bridge on mount.
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
        setMode(m as PanelMode);
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

  /* ----------------------------- URL bar ----------------------------- */

  const onGo = React.useCallback(
    async (target?: string) => {
      if (!effective || busy) return;
      const next = (target ?? url).trim();
      if (!next) return;
      setBusy(true);
      setStatus({ kind: "navigating", url: next });
      try {
        await effective.navigate(next);
        // Push the previous URL into the back stack.
        setHistory((h) => (currentUrl ? [...h, currentUrl] : h));
        setFuture([]);
        await refreshCurrent();
        setStatus({ kind: "idle" });
        if (target) setUrl(target);
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [effective, url, busy, currentUrl, refreshCurrent],
  );

  const onBack = React.useCallback(async () => {
    if (!effective || busy) return;
    if (history.length === 0) return;
    const previous = history[history.length - 1] as string;
    const remaining = history.slice(0, -1);
    setHistory(remaining);
    setFuture((f) => (currentUrl ? [currentUrl, ...f] : f));
    await onGo(previous);
  }, [effective, busy, history, currentUrl, onGo]);

  const onForward = React.useCallback(async () => {
    if (!effective || busy) return;
    if (future.length === 0) return;
    const nextUrl = future[0] as string;
    const remaining = future.slice(1);
    setFuture(remaining);
    setHistory((h) => (currentUrl ? [...h, currentUrl] : h));
    await onGo(nextUrl);
  }, [effective, busy, future, currentUrl, onGo]);

  const onReload = React.useCallback(async () => {
    if (!effective || busy || !currentUrl) return;
    setBusy(true);
    try {
      await effective.navigate(currentUrl);
      await refreshCurrent();
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [effective, busy, currentUrl, refreshCurrent]);

  const onHome = React.useCallback(async () => {
    await onGo(initialUrl);
  }, [onGo, initialUrl]);

  /* --------------------------- Takeover ------------------------------ */

  const onSwitchMode = React.useCallback(async () => {
    if (!effective || busy) return;
    const next: PanelMode = mode === "agent" ? "manual" : "agent";
    setBusy(true);
    try {
      await effective.takeOver(next);
      const current = await effective.getMode();
      setMode(current as PanelMode);
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [effective, mode, busy]);

  /* --------------------------- Recording ----------------------------- */

  const stopAndGenerate = React.useCallback(
    async (sessionId: string) => {
      if (!effective) return;
      setStatus({ kind: "generating", sessionId });
      try {
        const recording = await effective.stopRecording(sessionId);
        const skill = await effective.generateSkill(recording);
        setPendingSkill({ skill, recording });
        setStatus({ kind: "idle" });
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      }
    },
    [effective],
  );

  const onToggleRecording = React.useCallback(async () => {
    if (!effective || busy) return;
    setBusy(true);
    try {
      if (status.kind === "recording") {
        await stopAndGenerate(status.sessionId);
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
  }, [effective, busy, status, stopAndGenerate]);

  /* --------------------------- Skill modal --------------------------- */

  const onSkillSave = React.useCallback(
    async (skill: Skill): Promise<SkillSaveOutcome> => {
      if (!effective) {
        return { ok: false, error: "bridge unavailable" };
      }
      try {
        const ok = await effective.saveSkill(skill);
        return ok ? { ok: true } : { ok: false, error: "skill store rejected the payload" };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    [effective],
  );

  const onSkillModalClose = React.useCallback(() => {
    setPendingSkill(null);
  }, []);

  /* ----------------------------- Render ------------------------------ */

  if (!effective) {
    return (
      <div
        className={cx("abaco-browser-panel", className)}
        data-testid="browser-panel-error"
      >
        abacoBrowser bridge not available
      </div>
    );
  }

  const isRecording = status.kind === "recording";

  return (
    <div
      className={cx("abaco-browser-panel", className)}
      data-mode={mode}
      data-status={status.kind}
      data-testid="browser-panel"
    >
      {/* URL bar */}
      <form
        className="abaco-browser-panel__row abaco-browser-panel__row--url"
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
          placeholder="https://github.com/…"
        />
      </form>

      {/* Navigation buttons */}
      <div
        className="abaco-browser-panel__row abaco-browser-panel__row--nav"
        role="toolbar"
        aria-label="Navegación"
      >
        <button
          type="button"
          className="abaco-browser-panel__btn"
          data-testid="browser-back"
          aria-label="Atrás"
          onClick={() => void onBack()}
          disabled={busy || history.length === 0}
          title="Atrás"
        >
          ←
        </button>
        <button
          type="button"
          className="abaco-browser-panel__btn"
          data-testid="browser-forward"
          aria-label="Adelante"
          onClick={() => void onForward()}
          disabled={busy || future.length === 0}
          title="Adelante"
        >
          →
        </button>
        <button
          type="button"
          className="abaco-browser-panel__btn"
          data-testid="browser-reload"
          aria-label="Recargar"
          onClick={() => void onReload()}
          disabled={busy || !currentUrl}
          title="Recargar"
        >
          ⟳
        </button>
        <button
          type="button"
          className="abaco-browser-panel__btn"
          data-testid="browser-home"
          aria-label="Inicio"
          onClick={() => void onHome()}
          disabled={busy}
          title="Inicio"
        >
          ⌂
        </button>
      </div>

      {/* Action buttons */}
      <div
        className="abaco-browser-panel__row abaco-browser-panel__row--actions"
        role="toolbar"
        aria-label="Acciones"
      >
        <button
          type="button"
          className={cx(
            "abaco-browser-panel__btn",
            "abaco-browser-panel__btn--takeover",
            mode === "manual" && "is-manual",
          )}
          data-testid="browser-takeover"
          onClick={() => void onSwitchMode()}
          disabled={busy}
        >
          📍 {mode === "agent" ? "Tomar control" : "Devolver al agente"}
        </button>
        <button
          type="button"
          className={cx(
            "abaco-browser-panel__btn",
            "abaco-browser-panel__btn--record",
            isRecording && "is-recording",
          )}
          data-testid="browser-record"
          onClick={() => void onToggleRecording()}
          disabled={busy}
        >
          {isRecording ? "■ Detener grabación" : "● Grabar"}
        </button>
        {onOpenSettings ? (
          <button
            type="button"
            className="abaco-browser-panel__btn abaco-browser-panel__btn--settings"
            data-testid="browser-settings"
            onClick={onOpenSettings}
            disabled={busy}
            title="Settings"
          >
            ⚙ Settings
          </button>
        ) : null}
      </div>

      {/* BrowserView area */}
      <div
        className="abaco-browser-panel__viewport"
        data-testid="browser-viewport"
        role="region"
        aria-label="BrowserView"
      >
        {viewport ?? (
          <div
            className="abaco-browser-panel__viewport-placeholder"
            data-testid="browser-viewport-placeholder"
          >
            <span>BrowserView area</span>
            <small>URL: {currentUrl || "(vacío)"}</small>
            <small>Título: {title || "(vacío)"}</small>
          </div>
        )}
      </div>

      {/* Status line */}
      <div
        className="abaco-browser-panel__status"
        data-testid="browser-status"
        role="status"
      >
        <StatusLine status={status} />
      </div>

      {/* Mode footer */}
      <div
        className="abaco-browser-panel__mode"
        data-testid="browser-mode"
        aria-live="polite"
      >
        <span className="abaco-browser-panel__mode-label">Modo actual:</span>
        <strong
          className={cx(
            "abaco-browser-panel__mode-value",
            mode === "agent"
              ? "abaco-browser-panel__mode-value--agent"
              : "abaco-browser-panel__mode-value--manual",
          )}
          data-mode-value={mode}
        >
          {mode === "agent" ? "AGENTE" : "USUARIO"}
        </strong>
        <span className="abaco-browser-panel__mode-sep">|</span>
        <button
          type="button"
          className="abaco-browser-panel__mode-toggle"
          data-testid="browser-mode-toggle"
          onClick={() => void onSwitchMode()}
          disabled={busy}
        >
          Cambiar a {mode === "agent" ? "USUARIO" : "AGENTE"}
        </button>
      </div>

      {/* Skill modal (only rendered while a recording has been
          generated into a pending skill). */}
      {pendingSkill ? (
        <SkillModal
          skill={pendingSkill.skill}
          recording={pendingSkill.recording}
          onSave={onSkillSave}
          onClose={onSkillModalClose}
        />
      ) : null}
    </div>
  );
};

/* ---------------------------------------------------------------- *
 * Status line                                                      *
 * ---------------------------------------------------------------- */

const StatusLine: React.FC<{ status: PanelStatus }> = ({ status }) => {
  switch (status.kind) {
    case "idle":
      return <>Listo.</>;
    case "navigating":
      return <>Navegando a {status.url}…</>;
    case "recording":
      return <>Grabando sesión {shortId(status.sessionId)}…</>;
    case "generating":
      return <>Generando skill para {shortId(status.sessionId)}…</>;
    case "error":
      return <>⚠ {status.message}</>;
  }
};

export default BrowserPanel;
