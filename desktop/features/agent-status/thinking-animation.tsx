/**
 * ABACO — Agent Status / thinking-animation.tsx
 * --------------------------------------------------------------------
 * Three dots that bounce in sequence to signal "AGENTE TRABAJANDO".
 *
 * The animation lives entirely in `styles.module.css` (`.dot` /
 * `.dot:nth-child(n)`) so this component is presentational.  Each
 * dot has a staggered `animation-delay`, producing the classic
 * "..."-after-a-label feel.
 *
 * Accessibility:
 *  - The wrapper is a `<span>` with `aria-hidden="true"` because the
 *    surrounding label already conveys the meaning to assistive tech.
 *  - When `reducedMotion` is true we render a static ellipsis character
 *    instead, which the CSS module keeps unanimated.
 */

import type { CSSProperties, ReactElement } from 'react';
import type { IndicatorSubProps } from './types';

export interface ThinkingAnimationProps extends IndicatorSubProps {
    className?: string;
    style?: CSSProperties;
    /** Number of dots to render. Defaults to 3. */
    count?: 1 | 2 | 3;
}

/**
 * Render N animated dots.  The visible dots are driven by CSS, so the
 * only state this component owns is the count of dots.
 */
export const ThinkingAnimation = (
    props: ThinkingAnimationProps,
): ReactElement => {
    const count = props.count ?? 3;
    const dots: ReactElement[] = [];
    for (let i = 0; i < count; i += 1) {
        dots.push(
            <span
                key={i}
                className={props.className ? `${props.className}__dot` : undefined}
                data-testid={`agent-status-dot-${i}`}
            />,
        );
    }

    return (
        <span
            className={props.className}
            style={props.style}
            aria-hidden="true"
            data-testid="agent-status-thinking-dots"
            data-reduced-motion={props.reducedMotion ? 'true' : 'false'}
        >
            {props.reducedMotion
                ? // Static fallback for reduced-motion users.
                  <span className={props.className ? `${props.className}__static` : undefined}>
                    {'\u2026'}
                </span>
                : dots}
        </span>
    );
};
