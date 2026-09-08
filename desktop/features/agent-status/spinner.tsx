/**
 * ABACO — Agent Status / spinner.tsx
 * --------------------------------------------------------------------
 * A self-contained SVG spinner used while the agent is thinking.
 *
 * Why a hand-rolled SVG instead of an icon-font or a CSS-only loader?
 *  - It inherits `currentColor` from the CSS module so the spinner
 *    matches the bar's accent without prop plumbing.
 *  - The `stroke-dasharray` + rotation is GPU-cheap and respects
 *    `prefers-reduced-motion` via the CSS module (animation: none).
 *  - Zero JS animation means no jank even when the renderer is busy
 *    running the agent.
 *
 * The component is pure presentational; it does NOT decide when to
 * show — that is driven by `agent-status.tsx`.
 */

import type { CSSProperties, ReactElement } from 'react';
import type { IndicatorSubProps } from './types';

export interface SpinnerProps extends IndicatorSubProps {
    /** Forwarded onto the wrapping <svg>. */
    className?: string;
    style?: CSSProperties;
    /** Stroke width override; defaults to 2.5. */
    strokeWidth?: number;
}

/**
 * Render the spinner. Returns `null` when `reducedMotion` is true AND
 * the caller wants the static fallback — but in practice the CSS
 * module already suppresses the animation, so we just render the SVG
 * with `aria-hidden` semantics adjusted.
 */
export const Spinner = (props: SpinnerProps): ReactElement => {
    const size = props.size ?? 16;
    const stroke = props.strokeWidth ?? 2.5;
    const radius = 8;
    const circumference = 2 * Math.PI * radius;

    return (
        <svg
            className={props.className}
            style={props.style}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            role="img"
            aria-label={props.ariaLabel ?? 'Cargando'}
            data-testid="agent-status-spinner"
        >
            <title>{props.ariaLabel ?? 'Cargando'}</title>
            <circle
                cx="12"
                cy="12"
                r={radius}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${circumference * 0.75} ${circumference}`}
                strokeDashoffset={circumference * 0.125}
            />
        </svg>
    );
};
