/**
 * ABACO — Unified Button Bar
 * --------------------------------------------------------------------
 * A single TSX component that mounts every ABACO feature button in
 * a consistent slot. Each feature is responsible for its OWN panel
 * (modal, inline, etc.) — this bar only owns placement, sizing,
 * theming and the onClick plumbing.
 *
 * Visual contract
 * ---------------
 *  - All buttons share the same 36×36 hit target (configurable via
 *    the `size` prop on each item).
 *  - Icons inherit `currentColor` — the bar sets the accent.
 *  - Spacing is driven by `--button-gap` / `--bar-padding` from
 *    `styles/theme.css`. Don't hardcode pixels here.
 *  - The bar is responsive: it collapses to a single row, never
 *    wraps mid-feature. On viewports < 800 px the variant
 *    `variant="compact"` can be requested.
 *
 * Integration contract
 * --------------------
 * The host shell passes:
 *  - `items` — declarative list of slots (upload, mic, tts, browser,
 *    pairing, update) — each is wired to the feature's existing API.
 *  - `onTrigger(slotId, payload)` — the shell's dispatcher. The
 *    button-bar NEVER talks to features directly; it only emits
 *    the user's intent. This keeps the bar replaceable.
 *
 * No `react`, no `react-dom`, no `@deepseek/*` imports — those live
 * in the host shell. This file is a pure presentational component
 * written against a minimal `JSX.IntrinsicElements`-compatible type
 * (`h`-style) so it can be transpiled standalone or inlined into any
 * host. The host adapts React.createElement → h if needed.
 */

import type { CSSProperties, MouseEvent } from './_jsx';
import { h } from './_jsx';
import { theme, cssVar } from './theme';

// ---------- Public types ---------------------------------------------------

export type FeatureSlotId =
    | 'upload'
    | 'microphone'
    | 'speaker'
    | 'browser'
    | 'phone-link'
    | 'update';

export type FeatureVariant = 'default' | 'compact';

export interface FeatureSlot {
    id: FeatureSlotId;
    /** Visible label for screen readers and tooltips. */
    label: string;
    /** Inline SVG markup (we inject `currentColor` for theming). */
    iconSvg: string;
    /** Disabled → greyed, no pointer events. */
    disabled?: boolean;
    /** Show a small attention dot in the corner (update badge, etc). */
    badge?: boolean;
    /** Force a non-default accent — otherwise the bar uses brand cyan. */
    accent?: 'cyan' | 'violet' | 'pink';
    /** Hide from layout (feature not yet available on this build). */
    hidden?: boolean;
    /** Optional aria-keyboard shortcut hint (e.g. "⌘U"). */
    shortcut?: string;
}

export interface ButtonBarProps {
    items: FeatureSlot[];
    variant?: FeatureVariant;
    className?: string;
    onTrigger: (slotId: FeatureSlotId, ev: MouseEvent) => void;
}

// ---------- Internal helpers ----------------------------------------------

const accentVar = (a: FeatureSlot['accent']): string => {
    switch (a) {
        case 'violet': return theme.accent.secondary;
        case 'pink':   return theme.accent.quaternary;
        case 'cyan':
        default:       return theme.accent.primary;
    }
};

const sizeVar = (variant: FeatureVariant): string =>
    variant === 'compact' ? cssVar('buttonSizeSm') : cssVar('buttonSize');

// ---------- Sub-components -------------------------------------------------

const renderIcon = (svg: string): string => {
    // SVGs already use currentColor; we just need to inline them.
    // We strip any width/height attributes so CSS sizing wins.
    return svg
        .replace(/\swidth="[^"]*"/g,  '')
        .replace(/\sheight="[^"]*"/g, '');
};

const Button = (slot: FeatureSlot, onTrigger: ButtonBarProps['onTrigger'], sizeCss: string) => {
    const accent = accentVar(slot.accent);
    const style: CSSProperties = {
        width:        sizeCss,
        height:       sizeCss,
        borderRadius: cssVar('radiusMd'),
        color:        slot.disabled ? theme.text.muted : accent,
        background:   'transparent',
        border:       `1px solid ${slot.disabled ? theme.border.subtle : theme.border.subtle}`,
        display:      'inline-flex',
        alignItems:   'center',
        justifyContent: 'center',
        cursor:       slot.disabled ? 'not-allowed' : 'pointer',
        position:     'relative',
        transition:   `transform var(--dur-fast) var(--ease-out),
                       background-color var(--dur-fast) var(--ease-out),
                       border-color var(--dur-fast) var(--ease-out)`,
        padding:      0,
    };

    return h('button', {
        type: 'button',
        'aria-label': slot.label,
        'aria-disabled': slot.disabled ? 'true' : 'false',
        title: slot.shortcut ? `${slot.label} (${slot.shortcut})` : slot.label,
        disabled: slot.disabled,
        style,
        onClick: (ev: MouseEvent) => {
            if (slot.disabled) return;
            onTrigger(slot.id, ev);
        },
        onMouseEnter: (ev: MouseEvent) => {
            if (slot.disabled) return;
            const el = ev.currentTarget as HTMLElement;
            el.style.backgroundColor = theme.bg.tertiary;
            el.style.borderColor = theme.border.accent;
        },
        onMouseLeave: (ev: MouseEvent) => {
            const el = ev.currentTarget as HTMLElement;
            el.style.backgroundColor = 'transparent';
            el.style.borderColor = theme.border.subtle;
        },
        onMouseDown: (ev: MouseEvent) => {
            const el = ev.currentTarget as HTMLElement;
            el.style.transform = 'scale(0.94)';
        },
        onMouseUp: (ev: MouseEvent) => {
            const el = ev.currentTarget as HTMLElement;
            el.style.transform = 'scale(1)';
        },
        // Inject the SVG icon (dangerouslySetInnerHTML is the cleanest way
        // to avoid an SVG-import dance). The icon source is hard-coded
        // inside this package; never user-supplied.
        dangerouslySetInnerHTML: { __html: renderIcon(slot.iconSvg) },
    });
};

const Badge = () => h('span', {
    'aria-hidden': 'true',
    style: {
        position: 'absolute',
        top:      '4px',
        right:    '4px',
        width:    '8px',
        height:   '8px',
        borderRadius: '50%',
        backgroundColor: theme.accent.quaternary,
        boxShadow: theme.shadow.glowCyan,
        pointerEvents: 'none',
    },
});

// ---------- Main component -------------------------------------------------

export const ButtonBar = (props: ButtonBarProps) => {
    const variant = props.variant ?? 'default';
    const sizeCss = sizeVar(variant);
    const visible = props.items.filter(i => !i.hidden);

    const wrapperStyle: CSSProperties = {
        display:        'inline-flex',
        alignItems:     'center',
        gap:            theme.component.buttonGap,
        padding:        theme.component.barPadding,
        background:     theme.bg.secondary,
        borderRadius:   cssVar('radiusLg'),
        border:         `1px solid ${theme.border.subtle}`,
        boxShadow:      theme.shadow.button,
        // The bar itself never exceeds the parent — keep it tidy in
        // narrow sidebars and fullscreen alike.
        maxWidth:       '100%',
        flexWrap:       'nowrap',
        overflowX:      'auto',
    };

    return h('div', {
        role: 'toolbar',
        'aria-label': 'ABACO features',
        className: props.className,
        style: wrapperStyle,
    }, ...visible.map(slot => {
        const btn = Button(slot, props.onTrigger, sizeCss);
        return slot.badge
            ? h('span', { style: { position: 'relative', display: 'inline-flex' } }, btn, Badge())
            : btn;
    }));
};

// ---------- Convenience preset --------------------------------------------

/**
 * Default slot configuration for a fresh ABACO desktop build.
 * Host shells typically spread this and override `disabled`/`hidden`
 * per feature-flag.
 */
export const defaultSlots = (icons: Record<FeatureSlotId, string>): FeatureSlot[] => [
    { id: 'upload',     label: 'Upload file',         iconSvg: icons.upload,     shortcut: '⌘U' },
    { id: 'microphone', label: 'Voice input (STT)',   iconSvg: icons.microphone, shortcut: '⌘M' },
    { id: 'speaker',    label: 'Read aloud (TTS)',    iconSvg: icons.speaker,    accent: 'violet', shortcut: '⌘S' },
    { id: 'browser',    label: 'Open embedded browser', iconSvg: icons.browser,  accent: 'violet' },
    { id: 'phone-link', label: 'Link your phone',     iconSvg: icons['phone-link'], accent: 'pink' },
    { id: 'update',     label: 'Update available',    iconSvg: icons.update,     accent: 'pink', badge: true },
];
