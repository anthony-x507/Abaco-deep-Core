# ABACO — desktop/features/

> Integration glue that lets the existing **DSH Desktop** shell pick
> up the new ABACO features without losing the navy / cyan / violet
> brand.

This package is **pure presentation**: it owns the buttons, the
icons, and the shared color tokens. It does **not** implement the
features themselves — those live in sibling subagent outputs:

```
desktop/features/
├── README.md              ← you are here
├── shell-integration.md   ← how it all hooks up
├── button-bar.tsx         ← the unified toolbar
├── theme.ts               ← TS palette mirror
├── _jsx.ts                ← host-agnostic h() shim
├── styles/
│   └── theme.css          ← CSS variables (single source)
├── icons/
│   ├── upload.svg
│   ├── microphone.svg
│   ├── speaker.svg
│   ├── browser.svg
│   ├── phone-link.svg
│   └── update.svg
│
├── upload/                ← implemented by another subagent
├── audio/                 ← (STT + TTS) by another subagent
├── browser/               ← embedded webview by another subagent
├── pairing/               ← phone QR modal by another subagent
└── updater/               ← OTA flow by another subagent
```

## Goals

1. **Keep the ABACO branding consistent.** Every color, radius,
   shadow, and motion duration is a CSS variable in
   `styles/theme.css`. Components reference tokens, never literals.
2. **Stay additive.** No file outside `desktop/features/` is
   modified by this package. The host shell wires features in with
   a single import.
3. **Stay responsive.** The button bar must look correct from
   800×600 to fullscreen. The `compact` variant covers narrow
   layouts.
4. **Stay dependency-free.** No `react`, no `@deepseek/*`, no
   external icon library. SVGs are inline.

## The six buttons

| Slot          | Icon       | Color    | Lives where in the shell                |
|---------------|------------|----------|-----------------------------------------|
| `upload`      | 📎 paperclip | cyan   | composer (next to the text input)       |
| `microphone`  | 🎙 mic     | cyan     | composer                                |
| `speaker`     | 🔊 megaphone | violet | agent message bubble (per-message TTS)  |
| `browser`     | 🌐 globe   | violet   | sidebar footer                          |
| `phone-link`  | 📱 phone   | pink     | sidebar footer                          |
| `update`      | 🔄 loop    | pink     | sidebar footer / top-bar status         |

Existing buttons (`send`, `stop`, `regenerate`, etc.) are **not**
touched. The bar is additive.

## Quick start

```tsx
import { ButtonBar, defaultSlots } from '../../features/button-bar';
// `?raw` works in Vite; otherwise import as text/url.
import uploadSvg     from '../../features/icons/upload.svg?raw';
import microphoneSvg from '../../features/icons/microphone.svg?raw';
import speakerSvg    from '../../features/icons/speaker.svg?raw';
import browserSvg    from '../../features/icons/browser.svg?raw';
import phoneLinkSvg  from '../../features/icons/phone-link.svg?raw';
import updateSvg     from '../../features/icons/update.svg?raw';

// Import the theme exactly once, near the app root.
import '../../features/styles/theme.css';

const onTrigger = (id) => featureRouter.dispatch(id);

export const ComposerActions = () => h(ButtonBar, {
    items: defaultSlots({
        upload:      uploadSvg,
        microphone:  microphoneSvg,
        speaker:     speakerSvg,
        browser:     browserSvg,
        'phone-link':phoneLinkSvg,
        update:      updateSvg,
    }),
    onTrigger,
});
```

For the agent bubble (only the speaker button):

```tsx
const ttsOnly: FeatureSlot[] = [
    { id: 'speaker', label: 'Read aloud', iconSvg: speakerSvg, accent: 'violet' },
];
```

For the sidebar footer (compact):

```tsx
h(ButtonBar, {
    items: sidebarSlots,
    variant: 'compact',
    onTrigger,
});
```

## Re-skinning

You should be able to change every color in the desktop app by
editing only:

1. `styles/theme.css` — `:root { --bg-*, --accent-* … }`
2. `theme.ts`        — mirror literal (for inline `style` props)
3. `icons/*.svg`     — switch `currentColor` only; never hardcode

If a feature wants to override a token, it does so via a CSS class
that re-binds the variable, not by inlining a hex code.

## Accessibility

* All buttons are real `<button type="button">` elements.
* Each has `aria-label`, `title` (with shortcut), and `disabled`
  support.
* `prefers-reduced-motion: reduce` zeroes the animation durations
  globally.

## What this package does NOT do

* It does **not** import the existing `@deepseek/*` UI packages.
* It does **not** own state — the host shell is the source of truth
  for "what is the user doing right now".
* It does **not** open modals, start recordings, or launch the
  browser — that's the feature router's job.
* It does **not** ship audio codecs, QR generators, or update
  channels — those live with each feature.

## Tests / smoke check

There is no build step required. The `.tsx` file uses an explicit
`h(...)` factory (`_jsx.ts`) so it can be linted with
`tsc --noEmit` standalone. To validate the icons render, open any
SVG directly in a browser — the path data is hand-authored.

## See also

* `shell-integration.md` — wiring diagram, host-file map, and
  accessibility/responsive rules.
* `desktop/brand/` — the canonical logo and palette source.
