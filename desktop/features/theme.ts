/**
 * ABACO — Theme Module
 * --------------------------------------------------------------------
 * TypeScript mirror of `styles/theme.css`. Use this when authoring
 * React/TSX components that need to reference palette tokens via
 * the `style` prop (e.g. `style={{ color: theme.accent.primary }}`)
 * rather than CSS classes. Keep the two files in sync — when CSS
 * adds a token, mirror it here as a typed const.
 *
 * NO `any`, NO runtime side effects, NO DOM access — this is a pure
 * data module so it can be imported from any context (main, renderer,
 * preload, web) without circular-dependency concerns.
 */

export const theme = {
    bg: {
        primary:   '#0B1020',
        secondary: '#16204A',
        tertiary:  '#1E2A5C',
        overlay:   'rgba(11, 16, 32, 0.78)',
    },
    accent: {
        primary:    '#22D3EE',   // cyan
        secondary:  '#7C3AED',   // violet
        tertiary:   '#A78BFA',
        quaternary: '#F472B6',
        /** Reusable cyan→violet brand gradient (matches logo.svg). */
        gradient:   'linear-gradient(135deg, #22D3EE 0%, #7C3AED 100%)',
    },
    text: {
        primary:   '#F8FAFC',
        secondary: '#CBD5E1',
        muted:     '#94A3B8',
        inverse:   '#0B1020',
    },
    border: {
        subtle:  'rgba(255, 255, 255, 0.10)',
        strong:  'rgba(255, 255, 255, 0.18)',
        accent:  'rgba(34, 211, 238, 0.45)',
    },
    shadow: {
        elevated:  '0 8px 32px rgba(0, 0, 0, 0.40)',
        button:    '0 2px 8px  rgba(0, 0, 0, 0.25)',
        glowCyan:  '0 0 12px  rgba(34, 211, 238, 0.45)',
        glowViolet:'0 0 12px  rgba(124, 58, 237, 0.45)',
    },
    radius: {
        sm:    6,
        md:    8,
        lg:    12,
        pill:  999,
    },
    space: {
        s1: 4,
        s2: 8,
        s3: 12,
        s4: 16,
        s5: 24,
        s6: 32,
    },
    font: {
        display: "'SF Pro Display', -apple-system, system-ui, sans-serif",
        body:    "'SF Pro Text',    -apple-system, system-ui, sans-serif",
        mono:    "'JetBrains Mono', 'SF Mono', Menlo, monospace",
    },
    motion: {
        easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fast:    120,
        base:    200,
        slow:    320,
    },
    component: {
        buttonSize:    36,
        buttonSizeSm:  30,
        buttonGap:     8,
        barPadding:    12,
    },
} as const;

export type ABACOTheme = typeof theme;

/* --------------------------------------------------------------------
 * CSS-variable resolver — drop these into `style` props for one-offs
 * that don't deserve a dedicated class. Prefer CSS classes for
 * anything reusable.
 * ------------------------------------------------------------------ */
export const cssVar = (name: keyof typeof cssVarMap): string => cssVarMap[name];

const cssVarMap = {
    bgPrimary:       'var(--bg-primary)',
    bgSecondary:     'var(--bg-secondary)',
    bgTertiary:      'var(--bg-tertiary)',
    accentPrimary:   'var(--accent-primary)',
    accentSecondary: 'var(--accent-secondary)',
    textPrimary:     'var(--text-primary)',
    textSecondary:   'var(--text-secondary)',
    textMuted:       'var(--text-muted)',
    borderSubtle:    'var(--border-subtle)',
    borderAccent:    'var(--border-accent)',
    buttonSize:      'var(--button-size)',
    radiusMd:        'var(--radius-md)',
} as const;

export type CSSVarName = keyof typeof cssVarMap;
