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
    const NOTIFY_SLOT = 'conversation.input.left'
    const NOTIFY_ID = 'abaco-browser-record-notify'

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
      es: { label: 'Navegador', open: 'Abrir navegador', close: 'Cerrar navegador' },
      en: { label: 'Browser', open: 'Open browser', close: 'Close browser' },
    }

    function activeCopy() {
      const lang = typeof navigator !== 'undefined' && navigator.language
        ? String(navigator.language).toLowerCase()
        : ''
      return lang.indexOf('es') === 0 ? COPY.es : COPY.en
    }

    // ── Details-column measurement (P1) ────────────────────────────────────
    // The `details` slot is `kind: 'single'` and already occupied by chat's
    // DetailsPanel, so this plugin must not register a second occupant.
    // AppFrame is the `display:grid` whose last track is the details column
    // (`sidebar px | 1fr | details px`). We measure that track and report it
    // through `reportPanelHostBounds` so the WebContentsViews sit on those
    // pixels instead of a guessed right strip.
    function findShellFrame() {
      if (typeof document === 'undefined') return null
      const marked = document.querySelector(
        '[data-details-collapsed], [data-sidebar-collapsed], [data-dragging]',
      )
      if (marked) return marked
      const nodes = document.querySelectorAll('div')
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i]
        const columns = getComputedStyle(el).gridTemplateColumns
        if (columns && columns.split(' ').length >= 3 && el.childElementCount >= 3) {
          return el
        }
      }
      return null
    }

    // P1 viewport lock — keep host reports inside the same clamp main applies
    // (width 360–520, height ≤ 720, aspect ≈ 0.45–0.85).
    const PANEL_MIN_W = 360
    const PANEL_MAX_W = 520
    const PANEL_MAX_H = 720
    const PANEL_MIN_ASPECT = 0.45
    const PANEL_MAX_ASPECT = 0.85
    const PANEL_CHROME_H = 44

    function clampPanelHostReport(bounds) {
      let width = Math.round(bounds.width)
      let height = Math.round(bounds.height)
      width = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, width))
      const room = Math.max(0, Math.round(bounds.contentHeightHint != null
        ? bounds.contentHeightHint - bounds.y
        : height))
      const maxH = Math.min(room, Math.max(0, room), PANEL_MAX_H)
      height = Math.min(height, maxH, PANEL_MAX_H)
      if (height > 0 && width > 0) {
        const aspect = width / height
        if (aspect < PANEL_MIN_ASPECT) height = Math.floor(width / PANEL_MIN_ASPECT)
        else if (aspect > PANEL_MAX_ASPECT) height = Math.floor(width / PANEL_MAX_ASPECT)
        height = Math.max(PANEL_CHROME_H, Math.min(height, PANEL_MAX_H, room || PANEL_MAX_H))
      }
      return {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width,
        height,
      }
    }

    function measureDetailsColumn() {
      const frame = findShellFrame()
      if (!frame) return null
      const rect = frame.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const columns = getComputedStyle(frame).gridTemplateColumns
      const tracks = columns ? columns.split(/\s(?![^(]*\))/u) : []
      const last = tracks[tracks.length - 1]
      const detailsPx = last ? Number.parseFloat(last) : Number.NaN
      if (!Number.isFinite(detailsPx) || detailsPx < 8) return null
      return clampPanelHostReport({
        x: Math.round(rect.left + rect.width - detailsPx),
        y: Math.round(rect.top),
        width: Math.round(detailsPx),
        height: Math.round(rect.height),
        contentHeightHint: Math.round(rect.height + rect.top),
      })
    }

    function reportHostBounds(bridge) {
      if (!bridge || typeof bridge.reportPanelHostBounds !== 'function') return
      const bounds = measureDetailsColumn()
      if (!bounds) return
      bridge.reportPanelHostBounds(bounds).catch(() => {})
    }

    function openDetailsColumn() {
      try {
        const layout = typeof window !== 'undefined' ? window.__abacoBrowserLayout : undefined
        if (layout && typeof layout.openDetails === 'function') layout.openDetails()
      } catch (_) {}
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
        let observer
        const refresh = () => {
          bridge.isOpen().then(
            (value) => { if (alive) setOpen(value === true) },
            () => {},
          )
        }
        const dock = () => {
          openDetailsColumn()
          window.requestAnimationFrame(() => {
            reportHostBounds(bridge)
            const host = findShellFrame()
            if (!host || typeof ResizeObserver === 'undefined') return
            if (observer) observer.disconnect()
            observer = new ResizeObserver(() => reportHostBounds(bridge))
            observer.observe(host)
          })
        }
        refresh()
        // The overlay is a sibling view, so the Harness window loses focus while
        // it is up and gets it back when the overlay closes (including closes
        // made from the browser's own chrome bar) — re-sync there.
        window.addEventListener('focus', refresh)
        const offOpened = typeof bridge.onOpened === 'function' ? bridge.onOpened(() => {
          if (!alive) return
          setOpen(true)
          dock()
        }) : undefined
        const offClosed = typeof bridge.onClosed === 'function' ? bridge.onClosed(() => {
          if (!alive) return
          setOpen(false)
          if (observer) observer.disconnect()
          observer = undefined
        }) : undefined
        bridge.isOpen().then((value) => {
          if (alive && value === true) dock()
        }, () => {})
        return () => {
          alive = false
          window.removeEventListener('focus', refresh)
          if (typeof offOpened === 'function') offOpened()
          if (typeof offClosed === 'function') offClosed()
          if (observer) observer.disconnect()
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
            openDetailsColumn()
            window.requestAnimationFrame(() => reportHostBounds(bridge))
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
            ? h('span', { className: 'abaco-browser-launcher-label' }, open ? copy.close : copy.open)
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

    // ── Screen-recording → agent notice (P1) ────────────────────────────────
    // `conversation.input.left` is a session-scoped list slot whose occupants
    // receive `inputActions` (`setDraft` + `submit`). A hidden occupant is
    // enough: when main pushes `screen-recording-stopped`, we write a user
    // message and submit it so the agent is asked to turn the clip into a
    // skill. Nothing is rendered.
    function ScreenRecordingNotifier(props) {
      const inputActions = props && props.inputActions
      React.useEffect(() => {
        const live = browserBridge()
        if (!live || typeof live.onScreenRecordingStopped !== 'function') return undefined
        return live.onScreenRecordingStopped((result) => {
          if (!result || typeof result !== 'object') return
          let text = ''
          if (typeof result.skillMarkdown === 'string' && result.skillMarkdown.trim().length > 0) {
            text = result.skillMarkdown
          } else {
            const seconds =
              typeof result.durationMs === 'number' ? Math.round(result.durationMs / 1000) : 0
            const lines = [
              result.kind === 'f2-actions'
                ? 'A browser action recording just finished.'
                : 'A screen recording of the ABACO window just finished.',
              result.notice ? String(result.notice) : '',
              result.path ? `Saved to: ${result.path}` : '',
              seconds > 0 ? `Duration: ${seconds}s.` : '',
              'Please learn and save this skill into your active catalog (do not only look at the file on disk).',
            ].filter((line) => line.length > 0)
            text = lines.join('\n')
          }
          if (!text) return
          // D4 — disk-only is FAIL; always inject into the active agent turn.
          if (inputActions && typeof inputActions.setDraft === 'function') {
            inputActions.setDraft(text)
          }
          if (inputActions && typeof inputActions.submit === 'function') {
            inputActions.submit()
          }
        })
      }, [inputActions])
      return null
    }

    // ── Slot injection ─────────────────────────────────────────────────────
    // `slots` mounts the footer launcher and the notifier. `layout` is
    // optional: when present we stash `ctx.layout` so open can call
    // `openDetails()` and reveal the details column beside chat. We
    // deliberately do NOT register into the single `details` slot — that
    // would shadow ui-conversation's DetailsPanel.
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
      ctx.slots.inject(NOTIFY_SLOT, () =>
        ctx.slots.register(
          { name: NOTIFY_SLOT, id: NOTIFY_ID, order: 1000, label: 'ABACO browser recording notice' },
          ScreenRecordingNotifier,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
