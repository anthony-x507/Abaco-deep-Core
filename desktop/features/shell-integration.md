# ABACO Desktop — Shell Integration

> How the existing DSH Desktop shell picks up the new ABACO features
> (upload, STT, TTS, browser, phone pairing, updater) without losing
> the navy / cyan / violet brand.

```
┌──────────────────────────────────────────────────────────────────────┐
│                       DSH DESKTOP — EXISTING                          │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │  <ConversationPane>      <Sidebar>        <StatusBar>          │   │
│ │  ─ chat history          ─ nav            ─ connection         │   │
│ │  ─ composer (input)      ─ usage          ─ update badge       │   │
│ │  ─ existing buttons      ─ settings       ─ brand mark         │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│                          ↓   host wires features   ↓                 │
│                                                                      │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │                     ABACO — desktop/features/                   │   │
│ │                                                                  │   │
│ │   button-bar.tsx ─── renders every slot                         │   │
│ │   theme.ts       ─── TS palette mirror                          │   │
│ │   styles/theme.css── single source of CSS variables            │   │
│ │   icons/*.svg    ─── 24×24 inline (currentColor)                │   │
│ │   _jsx.ts        ─── host-agnostic h() factory                  │   │
│ │                                                                  │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                          ↑                                           │
│                          │  onTrigger(slotId, ev)                    │
│                          │                                           │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │                  FEATURE IMPLEMENTATIONS                        │   │
│ │  upload/    audio/    browser/    pairing/    updater/          │   │
│ │  (file pick)(STT/TTS) (web view)  (QR modal)  (OTA flow)        │   │
│ └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## 1 · Where each thing lives in the host shell

| Concern                | File (existing shell)                                | What changes                                          |
|------------------------|------------------------------------------------------|-------------------------------------------------------|
| Chat composer          | `packages/dsh-desktop-client-ui/.../Composer.tsx`    | Add `<ButtonBar>` slot at the right edge of the input |
| Agent message bubble   | `packages/dsh-desktop-client-ui/.../Message.tsx`     | Add `<ButtonBar>` with only `speaker` enabled         |
| Sidebar footer         | `packages/dsh-desktop-client-ui/.../Sidebar.tsx`     | Add `<ButtonBar variant="compact">` for `browser`, `phone-link`, `update` |
| Top-bar status         | `packages/dsh-desktop-client-ui/.../TopBar.tsx`      | The `update` badge already lives here — `ButtonBar` reuses the same signal |
| Renderer theme         | `packages/abaco-theme/client.js`                     | Must `import './features/styles/theme.css'` once      |
| Brand occupants        | `packages/abaco-brand/client.js`                     | No change — the brand package only owns the splash/logo |

> The host shell is **not** modified by this package — every
> integration is opt-in via a single import.

## 2 · Wiring the dispatch

`button-bar.tsx` doesn't know what an "upload" is. It only emits:

```ts
onTrigger(slotId: FeatureSlotId, ev: MouseEvent)
```

The host registers a single dispatcher (typically in
`src/renderer/feature-router.ts`):

```ts
import { ButtonBar, defaultSlots } from '../../features/button-bar';
import uploadIcon     from '../../features/icons/upload.svg?raw';
import microphoneIcon from '../../features/icons/microphone.svg?raw';
import speakerIcon    from '../../features/icons/speaker.svg?raw';
import browserIcon    from '../../features/icons/browser.svg?raw';
import phoneLinkIcon  from '../../features/icons/phone-link.svg?raw';
import updateIcon     from '../../features/icons/update.svg?raw';

const slots = defaultSlots({
    upload:      uploadIcon,
    microphone:  microphoneIcon,
    speaker:     speakerIcon,
    browser:     browserIcon,
    'phone-link':phoneLinkIcon,
    update:      updateIcon,
});

const onTrigger = (id) => featureRouter.dispatch(id);
```

`featureRouter` is owned by the host (not by `desktop/features/`)
and forwards to the existing feature packages:

| `id`         | routed to                                  |
|--------------|--------------------------------------------|
| `upload`     | `desktop/features/upload/`                 |
| `microphone` | `desktop/features/audio/` (STT channel)     |
| `speaker`    | `desktop/features/audio/` (TTS channel)     |
| `browser`    | `desktop/features/browser/`                |
| `phone-link` | `desktop/features/pairing/` (QR modal)     |
| `update`     | `desktop/features/updater/` (OTA launcher)  |

## 3 · Visual placement

```
┌─ Composer (chat input) ──────────────────────────────────┐
│  [ textarea ────────────────────── ] [🎙][📎][→ send]    │
│                                          ↑     ↑           │
│                            microphone  upload   (existing)  │
└───────────────────────────────────────────────────────────┘

┌─ Agent message bubble ────────────────────────────────────┐
│   assistant: …lorem ipsum dolor sit amet…      [🔊]        │
│                                                  ↑         │
│                                              speaker (TTS) │
└───────────────────────────────────────────────────────────┘

┌─ Sidebar footer ──────────────────────────────────────────┐
│   …                                                          │
│   [🌐 browser] [📱 phone] [🔄 update•]                      │
└───────────────────────────────────────────────────────────┘
```

## 4 · Theming — single source

All colors come from `styles/theme.css` and `theme.ts`. There are
exactly three places to change when re-skinning:

1. `styles/theme.css` — `:root { --bg-primary, --accent-* … }`
2. `theme.ts`        — mirror object literal
3. `icons/*.svg`     — use `currentColor`; never hardcode hex

If you find yourself reaching for `#22D3EE` anywhere outside
those three locations, push it back into a CSS variable.

## 5 · Responsive rules

| Viewport          | Layout                                                         |
|-------------------|----------------------------------------------------------------|
| `≥ 1280px`        | Full bar, 36 px buttons, generous padding.                     |
| `1024–1280px`     | Full bar, 36 px buttons, tighter padding via `compact` variant.|
| `800–1024px`      | Bar moves under the input row; `compact` variant.              |
| `< 800px`         | `compact` only; if still tight, `overflow-x: auto` scrolls.   |

The bar never wraps mid-feature. Either it fits, or it scrolls —
this is intentional so the layout stays predictable at every
viewport.

## 6 · Accessibility

* Each button is a real `<button type="button">` with an
  `aria-label` and a tooltip (`title`) that includes the
  shortcut hint.
* Disabled buttons set `aria-disabled="true"` and are skipped by
  the Tab order if you also set the native `disabled` attribute.
* Focus ring: rely on the host's global `:focus-visible` rule; we
  don't override it.
* `prefers-reduced-motion`: the motion durations collapse to `0ms`
  via the media query in `theme.css`.

## 7 · File map (created by this package)

```
desktop/features/
├── README.md                       # how to integrate
├── shell-integration.md            # this file
├── button-bar.tsx                  # the bar component
├── theme.ts                        # TS palette mirror
├── _jsx.ts                         # host-agnostic h() shim
├── styles/
│   └── theme.css                   # CSS variables
└── icons/
    ├── upload.svg
    ├── microphone.svg
    ├── speaker.svg
    ├── browser.svg
    ├── phone-link.svg
    └── update.svg
```

Feature implementations (`upload/`, `audio/`, `browser/`,
`pairing/`, `updater/`) are built by sibling subagents and are
**not** part of this package.
