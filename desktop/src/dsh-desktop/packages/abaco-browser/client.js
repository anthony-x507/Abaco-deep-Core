window.__ModuleLoader__.load({
  id: 'abaco-browser',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ── Target slot ────────────────────────────────────────────────────────
    // `sidebar.footer.action` is the stock sidebar's own footer seat, verified
    // in the mounted harness:
    //   • @deepseek-ai/dsh-client-ui-sidebar/lib/client.js declares it in the
    //     `slots.register({ name: 'sidebar', children: { ... } })` entry as
    //     `'sidebar.footer.action': { kind: 'list', scope: 'root' }` and renders
    //     it from SidebarRoot's foot as
    //     `renderSlot('sidebar.footer.action', { wide })`.
    //   • the package's contract (lib/types/client/contract/slots.d.ts) types the
    //     occupant props as `SidebarFooterActionOwnerProps = { wide: boolean }`,
    //     i.e. the foot hands each action only the column fold state.
    //   • @deepseek-ai/dsh-client-ui-cordis already occupies it (`id:
    //     'cordis-panel'`), which is why the register call below is a plain list
    //     occupant: registering a second entry on a list slot is the supported
    //     path, replacing an occupant is not.
    // The launcher is a desktop-only affordance: on a Harness page served to a
    // plain browser `window.dshAbacoBrowser` does not exist and the button
    // renders nothing.
    const SLOT = 'sidebar.footer.action'
    const OCCUPANT_ID = 'abaco-browser'
    const STYLE_ID = 'abaco-browser-launcher-style'

    // ── Bridge ─────────────────────────────────────────────────────────────
    // The preload of the main window is the only place that can reach
    // `ipcRenderer`; the client plugin speaks to the overlay exclusively
    // through this frozen-by-contextBridge global.
    function browserBridge() {
      if (typeof window === 'undefined') return undefined
      const bridge = window.dshAbacoBrowser
      if (!bridge || typeof bridge.open !== 'function' || typeof bridge.isOpen !== 'function') {
        return undefined
      }
      return bridge
    }

    // ── Copy (plain navigator-language sniff, matching abaco-agent-status) ──
    const COPY = {
      es: { label: 'Navegador', open: 'Abrir el navegador integrado', close: 'Cerrar el navegador integrado' },
      en: { label: 'Browser', open: 'Open the integrated browser', close: 'Close the integrated browser' },
    }

    function activeCopy() {
      const lang = typeof navigator !== 'undefined' && navigator.language
        ? String(navigator.language).toLowerCase()
        : ''
      return lang.indexOf('es') === 0 ? COPY.es : COPY.en
    }

    // ── Launcher ───────────────────────────────────────────────────────────
    // Mirrors the footprint of the shell's own footer occupants: a full-width
    // row with icon + label while the column is wide, a 36px circle in the rail
    // (the `wide` prop is the only thing the foot gives an occupant).
    function BrowserLauncherButton(props) {
      const bridge = browserBridge()
      const [open, setOpen] = React.useState(false)

      React.useEffect(() => {
        if (!bridge) return undefined
        let alive = true
        const refresh = () => {
          bridge.isOpen().then(
            (value) => { if (alive) setOpen(value === true) },
            () => {},
          )
        }
        refresh()
        // The overlay is a sibling view, so the Harness window loses focus while
        // it is up and gets it back when the overlay closes (including closes
        // made from the browser's own chrome bar) — re-sync there.
        window.addEventListener('focus', refresh)
        return () => {
          alive = false
          window.removeEventListener('focus', refresh)
        }
      }, [bridge])

      if (!bridge) return null

      const copy = activeCopy()
      const label = open ? copy.close : copy.open
      const toggle = () => {
        // Always ask main first: the overlay may have been closed from its own
        // chrome bar since this button last rendered.
        bridge.isOpen().then(
          (value) => {
            const isOpenNow = value === true
            setOpen(!isOpenNow)
            if (isOpenNow) return bridge.close()
            // P1: open the layout details column when available so chat stays
            // visible beside the browser. We do not occupy the single `details`
            // slot (that would shadow DetailsPanel); main uses a geometric
            // right strip (300–520 DIP) unless reportPanelHostBounds is used.
            try {
              const layout = typeof window !== 'undefined' ? window.__abacoBrowserLayout : undefined
              if (layout && typeof layout.openDetails === 'function') layout.openDetails()
            } catch (_) {}
            return bridge.open()
          },
          (error) => console.error('[abaco-browser] unable to toggle the browser overlay', error),
        )
      }

      return h(
        'div',
        { className: 'abaco-browser-launcher', 'data-abaco-browser-launcher': open ? 'open' : 'closed' },
        h(
          'button',
          {
            type: 'button',
            className: 'abaco-browser-launcher-button',
            title: label,
            'aria-label': label,
            'aria-pressed': open ? 'true' : 'false',
            onClick: toggle,
          },
          h('span', {
            className: 'abaco-browser-launcher-icon',
            'aria-hidden': 'true',
            dangerouslySetInnerHTML: { __html: globeIcon },
          }),
          props && props.wide
            ? h('span', { className: 'abaco-browser-launcher-label' }, copy.label)
            : null,
        ),
      )
    }

    // ── Icon (inline, currentColor so both themes work) ────────────────────
    const globeIcon = [
      '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">',
      '<circle cx="8" cy="8" r="5.6" stroke="currentColor" stroke-width="1.3"/>',
      '<path d="M2.4 8h11.2M8 2.4c1.5 1.6 2.3 3.5 2.3 5.6S9.5 12 8 13.6C6.5 12 5.7 10.1 5.7 8S6.5 4 8 2.4Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
      '</svg>',
    ].join('')

    // ── Style (shell tokens first, ABACO accent for the open state) ────────
    function injectStyle() {
      if (!document || document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'abaco-browser'
      style.textContent = `
        .abaco-browser-launcher {
          flex: 0 1 auto;
          min-width: 0;
          display: flex;
          align-items: center;
        }
        .abaco-browser-launcher-button {
          width: calc(100% + 4px);
          height: 42px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin: 0 -2px;
          padding: 0 10px 0 8px;
          color: var(--dsw-alias-label-primary, inherit);
          font-family: inherit;
          font-size: 14px;
          background: transparent;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          overflow: hidden;
        }
        .abaco-browser-launcher-button:hover,
        .abaco-browser-launcher[data-abaco-browser-launcher='open'] .abaco-browser-launcher-button {
          color: var(--abaco-accent-1, #38bdf8);
          background: var(--dsw-alias-interactive-bg-hover, rgba(56, 189, 248, 0.12));
        }
        .abaco-browser-launcher-icon {
          flex: none;
          display: inline-flex;
          align-items: center;
        }
        .abaco-browser-launcher-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        [data-dsh-sidebar-wide='false'] .abaco-browser-launcher-button {
          justify-content: center;
          width: 36px;
          height: 36px;
          padding: 0;
          border-radius: 50%;
        }
        [data-dsh-sidebar-wide='false'] .abaco-browser-launcher-label {
          display: none;
        }
      `
      document.head.appendChild(style)
    }

    // ── Slot injection ─────────────────────────────────────────────────────
    // `slots` mounts the footer launcher. `layout` is optional: when present we
    // stash `ctx.layout` so open can call `openDetails()` and reveal the details
    // column beside chat. We deliberately do NOT register into the single
    // `details` slot — that would shadow ui-conversation's DetailsPanel — so
    // panel geometry stays on the main-process geometric right strip
    // (clamped 300–520 DIP, default 420).
    const inject = ['slots', 'layout']

    function apply(ctx) {
      injectStyle()
      try {
        if (ctx.layout) window.__abacoBrowserLayout = ctx.layout
      } catch (_) {}
      ctx.slots.inject(SLOT, () =>
        ctx.slots.register(
          { name: SLOT, id: OCCUPANT_ID, order: 0, label: 'ABACO browser' },
          BrowserLauncherButton,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
