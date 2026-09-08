/**
 * ABACO — Agent Status (types)
 * --------------------------------------------------------------------
 * TypeScript contracts for the "AGENTE TRABAJANDO" indicator. Every
 * state the indicator can render is enumerated here so the host shell
 * can drive the component from a single typed value.
 *
 * The shape is intentionally narrow: the indicator is presentational,
 * it does NOT decide when the agent is thinking — that decision lives
 * in the agent runtime (SSE/WebSocket stream parser). The host shell
 * passes an `AgentStatusInfo` snapshot and this component renders it.
 */

/** All states the indicator can render. */
export type AgentStatus =
    | 'idle'
    | 'thinking'
    | 'streaming'
    | 'tool_use'
    | 'done'
    | 'error';

/** Where the bar should anchor itself in the viewport. */
export type AgentStatusPosition = 'bottom' | 'top';

/**
 * Visual variant for the bar surface. `solid` is the default chrome;
 * `glass` is a translucent surface used when the bar overlays content
 * (e.g. over the chat scroll).
 */
export type AgentStatusVariant = 'solid' | 'glass';

/** Snapshot of what the agent is currently doing. */
export interface AgentStatusInfo {
    /** Current state — drives the visible label and the animations. */
    status: AgentStatus;

    /** Name of the tool being executed when `status === 'tool_use'`. */
    toolName?: string;

    /** Streaming progress (0..1) when `status === 'streaming'`. */
    progress?: number;

    /** Short message shown when `status === 'error'`. */
    errorMessage?: string;

    /** ISO timestamp captured when the current state began. */
    startedAt?: string;

    /** Pre-computed elapsed time in ms (host may supply its own). */
    elapsedMs?: number;
}

/** Props for the main `AgentStatusBar` component. */
export interface AgentStatusBarProps {
    status: AgentStatusInfo;
    position?: AgentStatusPosition;
    variant?: AgentStatusVariant;
    className?: string;

    /**
     * How long the `done` state stays visible before fading out.
     * Defaults to 1200 ms — long enough to read, short enough to feel
     * responsive. Set to `0` to disable the hold.
     */
    doneHoldMs?: number;

    /**
     * Optional callback fired AFTER the `done` hold finishes and the
     * bar has fully faded out. The host can use this to clear the
     * status back to `idle` in its own state.
     */
    onDoneHidden?: () => void;

    /**
     * If true, the bar renders even when `status === 'idle'` (useful
     * for layout debugging). Defaults to false.
     */
    showWhenIdle?: boolean;
}

/** Props shared by every micro-animation in the indicator. */
export interface IndicatorSubProps {
    /** Accent colour — overrides the per-state default. */
    color?: string;
    /** Pixel size for square indicators (spinner/check). */
    size?: number;
    /** Whether the user requested reduced motion. */
    reducedMotion?: boolean;
    /** Aria-label for screen readers. */
    ariaLabel?: string;
}

/**
 * Internal type: maps a status to the descriptor that should be
 * rendered (icon glyph + label text). Centralised so i18n and unit
 * tests have a single source of truth.
 */
export interface StatusDescriptor {
    /** Icon glyph to render (svg key in the component, not a char). */
    icon: 'spinner' | 'progress' | 'wrench' | 'check' | 'error' | 'none';
    /** User-facing label. */
    label: string;
    /** Accent token used by CSS to colourise the bar. */
    accent: 'thinking' | 'streaming' | 'tool' | 'done' | 'error';
}

/** Resolves an `AgentStatusInfo` into a render-ready descriptor. */
export const describeStatus = (info: AgentStatusInfo): StatusDescriptor => {
    switch (info.status) {
        case 'thinking':
            return { icon: 'spinner', label: 'AGENTE TRABAJANDO', accent: 'thinking' };
        case 'streaming':
            return { icon: 'progress', label: 'GENERANDO RESPUESTA', accent: 'streaming' };
        case 'tool_use':
            return {
                icon: 'wrench',
                label: info.toolName
                    ? `USANDO HERRAMIENTA · ${info.toolName}`
                    : 'USANDO HERRAMIENTA',
                accent: 'tool',
            };
        case 'done':
            return { icon: 'check', label: 'LISTO', accent: 'done' };
        case 'error':
            return {
                icon: 'error',
                label: info.errorMessage ? `ERROR · ${info.errorMessage}` : 'ERROR',
                accent: 'error',
            };
        case 'idle':
        default:
            return { icon: 'none', label: '', accent: 'thinking' };
    }
};

/** Clamp helper used by the progress bar — keeps the UI from exploding. */
export const clampProgress = (value: number | undefined): number => {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
};

/**
 * Detects whether the host environment prefers reduced motion. Safe to
 * call during SSR — falls back to `false`.
 */
export const prefersReducedMotion = (): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};
