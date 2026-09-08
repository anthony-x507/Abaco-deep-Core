/**
 * ABACO — Agent Status / agent-status.tsx
 * --------------------------------------------------------------------
 * The "AGENTE TRABAJANDO" indicator. Reads an `AgentStatusInfo` snapshot
 * and renders a compact pill that overlays the chat surface while the
 * agent is busy. The host shell drives the `status` prop from the
 * agent runtime's event stream (SSE / WebSocket).
 *
 * Visual states (one per `AgentStatus` value):
 *
 *   idle       → hidden (data-visible="false")
 *   thinking   → ⟳  AGENTE TRABAJANDO  ● ● ●
 *   streaming  → ▮▮▮▮▮▯▯▯▯▯  GENERANDO RESPUESTA
 *   tool_use   → ⚙  USANDO HERRAMIENTA · read_file
 *   done       → ✓  LISTO  (auto-hide after `doneHoldMs`)
 *   error      → ⚠  ERROR · mensaje corto
 *
 * All visuals are derived from `data-accent` / `data-visible` so the
 * CSS module owns animation timing — the React side just sets the
 * attributes.
 */

import * as React from 'react';
import {
    AgentStatusBarProps,
    describeStatus,
    prefersReducedMotion,
    clampProgress,
} from './types';
import { Spinner } from './spinner';
import { ThinkingAnimation } from './thinking-animation';

const FADE_OUT_MS = 320;
const HIDE_AFTER_MS = 240;

export const AgentStatusBar: React.FC<AgentStatusBarProps> = (props) => {
    const { status, position = 'bottom', variant = 'solid' } = props;
    const [visible, setVisible] = React.useState<boolean>(false);
    const [fadingOut, setFadingOut] = React.useState<boolean>(false);
    const [reducedMotion, setReducedMotion] = React.useState<boolean>(false);
    const [elapsed, setElapsed] = React.useState<number>(status.elapsedMs ?? 0);

    const descriptor = React.useMemo(() => describeStatus(status), [status]);

    // Detect reduced-motion preference on mount.
    React.useEffect(() => {
        setReducedMotion(prefersReducedMotion());
    }, []);

    // Elapsed-time ticker — updates every 250 ms while the bar is busy.
    React.useEffect(() => {
        if (status.status === 'idle') {
            setElapsed(0);
            return;
        }
        const start = status.startedAt ? Date.parse(status.startedAt) : Date.now();
        const tick = () => {
            if (Number.isFinite(start)) {
                setElapsed(Date.now() - start);
            } else {
                setElapsed((prev) => prev + 250);
            }
        };
        tick();
        const id = window.setInterval(tick, 250);
        return () => window.clearInterval(id);
    }, [status.status, status.startedAt]);

    // Visibility transitions. `idle` is hidden immediately; `done` waits
    // `doneHoldMs` (default 1200ms) before fading out.
    React.useEffect(() => {
        if (status.status === 'idle') {
            setVisible(false);
            setFadingOut(false);
            return;
        }

        if (status.status === 'done') {
            const holdMs = props.doneHoldMs ?? 1200;
            setVisible(true);
            setFadingOut(false);
            const fadeTimer = window.setTimeout(() => {
                setFadingOut(true);
            }, holdMs);
            const hideTimer = window.setTimeout(() => {
                setVisible(false);
                setFadingOut(false);
                props.onDoneHidden?.();
            }, holdMs + FADE_OUT_MS + HIDE_AFTER_MS);
            return () => {
                window.clearTimeout(fadeTimer);
                window.clearTimeout(hideTimer);
            };
        }

        // thinking / streaming / tool_use / error → show immediately.
        setVisible(true);
        setFadingOut(false);
        return undefined;
    }, [status.status, status.startedAt, props.doneHoldMs]);

    if (props.showWhenIdle !== true && status.status === 'idle') {
        return null;
    }

    if (!visible && !fadingOut && status.status !== 'idle') {
        // Mid-transition: render with the hidden attribute so the
        // CSS module can run its fade-out animation.
    }

    const showBar = visible || fadingOut || status.status !== 'idle';
    const dataVisible = showBar ? 'true' : 'false';

    const formatElapsed = (ms: number): string => {
        if (ms < 1000) return `${ms} ms`;
        const s = Math.floor(ms / 1000);
        if (s < 60) return `${s} s`;
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${m}m ${rem}s`;
    };

    const iconNode = renderIcon(descriptor.icon, {
        reducedMotion,
        accent: accentVar(descriptor.accent),
        ariaLabel: descriptor.label,
    });

    return (
        <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="agent-status-bar"
            data-status={status.status}
            data-accent={descriptor.accent}
            data-visible={dataVisible}
            data-position={position}
            data-variant={variant}
            className={`agent-status-root ${props.className ?? ''}`.trim()}
        >
            {iconNode}
            <span
                className="agent-status-label"
                data-overflow={descriptor.label.length > 48 ? 'true' : 'false'}
            >
                {descriptor.label}
            </span>
            {status.status === 'streaming' ? renderProgress(status.progress, descriptor.accent) : null}
            {status.status === 'thinking' ? (
                <ThinkingAnimation
                    className="agent-status-dots"
                    reducedMotion={reducedMotion}
                    ariaLabel="pensando"
                />
            ) : null}
            {status.elapsedMs !== undefined || status.startedAt ? (
                <span className="agent-status-elapsed">{formatElapsed(elapsed)}</span>
            ) : null}
        </div>
    );
};

interface IconOpts {
    reducedMotion: boolean;
    accent: string;
    ariaLabel: string;
}

function accentVar(name: string): string {
    switch (name) {
        case 'thinking':
            return 'var(--agent-status-thinking)';
        case 'tool':
            return 'var(--agent-status-tool)';
        case 'streaming':
            return 'var(--agent-status-streaming)';
        case 'done':
            return 'var(--agent-status-done)';
        case 'error':
            return 'var(--agent-status-error)';
        default:
            return 'var(--agent-status-thinking)';
    }
}

function renderIcon(kind: string, opts: IconOpts): React.ReactNode {
    switch (kind) {
        case 'spinner':
            return <Spinner size={16} ariaLabel={opts.ariaLabel} reducedMotion={opts.reducedMotion} color={opts.accent} />;
        case 'progress':
            return (
                <svg
                    className="agent-status-glyph"
                    viewBox="0 0 24 24"
                    role="img"
                    aria-label={opts.ariaLabel}
                    data-testid="agent-status-progress"
                >
                    <circle cx="12" cy="12" r="9" />
                </svg>
            );
        case 'wrench':
            return (
                <svg
                    className="agent-status-glyph"
                    viewBox="0 0 24 24"
                    role="img"
                    aria-label={opts.ariaLabel}
                    data-testid="agent-status-wrench"
                >
                    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z" />
                </svg>
            );
        case 'check':
            return (
                <svg
                    className="agent-status-glyph"
                    viewBox="0 0 24 24"
                    role="img"
                    aria-label={opts.ariaLabel}
                    data-testid="agent-status-check"
                >
                    <path d="M5 12.5l4 4 10-10" />
                </svg>
            );
        case 'error':
            return (
                <svg
                    className="agent-status-glyph"
                    viewBox="0 0 24 24"
                    role="img"
                    aria-label={opts.ariaLabel}
                    data-testid="agent-status-error"
                >
                    <path d="M12 7v6m0 4h.01M2 20l10-18 10 18z" />
                </svg>
            );
        case 'none':
        default:
            return null;
    }
}

function renderProgress(progress: number | undefined, accent: string): React.ReactNode {
    const value = clampProgress(progress);
    const widthPct = `${Math.max(2, value * 100)}%`;
    const indeterminate = progress === undefined;
    return (
        <div
            className="agent-status-progressTrack"
            role="progressbar"
            aria-label="Progreso de generación"
            aria-valuenow={Math.round(value * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className="agent-status-progressFill"
                data-indeterminate={indeterminate ? 'true' : 'false'}
                style={{
                    width: indeterminate ? '38%' : widthPct,
                    background: accentVar(accent),
                }}
            />
        </div>
    );
}

export default AgentStatusBar;
