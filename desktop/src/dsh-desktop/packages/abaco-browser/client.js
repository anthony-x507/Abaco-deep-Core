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
    const DOCK_STYLE_ID = 'abaco-browser-dock-style'
    const NOTIFY_SLOT = 'conversation.input.left'
    const NOTIFY_ID = 'abaco-browser-record-notify'
    const DOCK_ATTR = 'data-abaco-browser-dock'
    const DEFAULT_DOCK_W = 400
    const MIN_DOCK_W = 360
    const MAX_DOCK_W = 520

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

    // ── Details-column measurement (P1 hard-dock) ──────────────────────────
    // AppFrame only gives the details track width when `detailsSession` is
    // non-blank (`detailsSession === void 0 ? 0 : panels.details`). openDetails()
    // can set panels.details=360 while the column stays 0px on blank sessions —
    // measure then fails and main used to fall back to a floating right strip
    // OVER full-width chat. We force a CSS dock reserve so chat 1fr shrinks,
    // measure the detailsCol DOM rect, and only reportHostBounds when the
    // composer does not intersect the monitor (anti-overlap).
    function findShellFrame() {
      if (typeof document === 'undefined') return null
      const marked = document.querySelector(
        '[data-details-collapsed], [data-sidebar-collapsed], [data-dragging], [data-abaco-browser-dock]',
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

    function findDetailsCol(frame) {
      if (!frame) return null
      const byClass = frame.querySelector('[class*="detailsCol"]')
      if (byClass) return byClass
      // AppFrame children: sidebarCol, CenterColumn, DetailsColumn, overlay…
      const kids = frame.children
      if (kids && kids.length >= 3) {
        // Prefer the last non-overlay child with a sensible width after dock.
        for (let i = kids.length - 1; i >= 0; i -= 1) {
          const kid = kids[i]
          if (kid && kid.getAttribute && kid.getAttribute('data-shell-overlay') != null) continue
          const r = kid.getBoundingClientRect()
          if (r.width >= 8) return kid
        }
      }
      return null
    }

    function findComposerRect() {
      if (typeof document === 'undefined') return null
      const selectors = [
        '[data-testid="composer"]',
        '[class*="composer"]',
        '[class*="Composer"]',
        'textarea',
        '[contenteditable="true"]',
      ]
      for (let i = 0; i < selectors.length; i += 1) {
        const el = document.querySelector(selectors[i])
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.width > 40 && r.height > 8) {
          return { x: r.left, y: r.top, width: r.width, height: r.height }
        }
      }
      return null
    }

    function rectsOverlap(a, b) {
      if (!a || !b || a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
      return !(
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y
      )
    }

    // Docked column fills host height — no max-720 / aspect card clamps here.
    const PANEL_MIN_W = MIN_DOCK_W
    const PANEL_MAX_W = MAX_DOCK_W

    function clampPanelHostReport(bounds) {
      let width = Math.round(bounds.width)
      width = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, width))
      const height = Math.max(0, Math.round(bounds.height))
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
      const frameRect = frame.getBoundingClientRect()
      if (frameRect.width <= 0 || frameRect.height <= 0) return null

      const detailsEl = findDetailsCol(frame)
      if (detailsEl) {
        const r = detailsEl.getBoundingClientRect()
        if (r.width >= 8 && r.height >= 8) {
          return clampPanelHostReport({
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height,
          })
        }
      }

      // Fallback: last grid track (minmax-safe split).
      const columns = getComputedStyle(frame).gridTemplateColumns
      const tracks = columns ? columns.split(/\s(?![^(]*\))/u) : []
      const last = tracks[tracks.length - 1]
      const detailsPx = last ? Number.parseFloat(last) : Number.NaN
      if (!Number.isFinite(detailsPx) || detailsPx < 8) return null
      return clampPanelHostReport({
        x: frameRect.left + frameRect.width - detailsPx,
        y: frameRect.top,
        width: detailsPx,
        height: frameRect.height,
      })
    }

    function injectDockStyle() {
      if (!document || document.getElementById(DOCK_STYLE_ID)) return
      const style = document.createElement('style')
      style.id = DOCK_STYLE_ID
      style.dataset.plugin = 'abaco-browser'
      // !important beats AppFrame's inline gridTemplateColumns when details=0
      // on blank sessions, so chat (1fr) actually shrinks and the monitor is a
      // real right column — never a floating overlay over the composer.
      style.textContent = `
        [${DOCK_ATTR}='open'] {
          grid-template-columns:
            var(--abaco-browser-sidebar-w, 280px)
            minmax(0, 1fr)
            var(--abaco-browser-details-w, ${DEFAULT_DOCK_W}px) !important;
        }
        [${DOCK_ATTR}='open'] [class*="detailsCol"] {
          min-width: 0;
          overflow: hidden;
        }
      `
      document.head.appendChild(style)
    }

    let dockOpenedByUs = false

    function applyDockReserve() {
      injectDockStyle()
      const frame = findShellFrame()
      if (!frame) return false
      let sidebarW = 280
      const columns = getComputedStyle(frame).gridTemplateColumns
      const tracks = columns ? columns.split(/\s(?![^(]*\))/u) : []
      if (tracks.length >= 1) {
        const side = Number.parseFloat(tracks[0])
        if (Number.isFinite(side) && side >= 0) sidebarW = Math.round(side)
      }
      // If sidebar is collapsed (0), keep 0 so we do not invent a left column.
      const detailsW = DEFAULT_DOCK_W
      frame.style.setProperty('--abaco-browser-sidebar-w', `${sidebarW}px`)
      frame.style.setProperty('--abaco-browser-details-w', `${detailsW}px`)
      frame.setAttribute(DOCK_ATTR, 'open')
      // Clear collapsed marker so border/CSS treat the column as present.
      if (frame.getAttribute('data-details-collapsed') != null) {
        frame.removeAttribute('data-details-collapsed')
      }
      return true
    }

    function clearDockReserve() {
      const frame = findShellFrame()
      if (frame) {
        frame.removeAttribute(DOCK_ATTR)
        frame.style.removeProperty('--abaco-browser-sidebar-w')
        frame.style.removeProperty('--abaco-browser-details-w')
      }
      // Also clear any other marked frames (safety if findShellFrame drifts).
      if (typeof document !== 'undefined') {
        const all = document.querySelectorAll(`[${DOCK_ATTR}]`)
        for (let i = 0; i < all.length; i += 1) {
          all[i].removeAttribute(DOCK_ATTR)
          all[i].style.removeProperty('--abaco-browser-sidebar-w')
          all[i].style.removeProperty('--abaco-browser-details-w')
        }
      }
    }

    function openDetailsColumn() {
      try {
        const layout = typeof window !== 'undefined' ? window.__abacoBrowserLayout : undefined
        if (layout && typeof layout.openDetails === 'function') {
          layout.openDetails()
          dockOpenedByUs = true
        }
      } catch (_) {}
    }

    function closeDetailsColumnIfWeOpened() {
      if (!dockOpenedByUs) return
      try {
        const layout = typeof window !== 'undefined' ? window.__abacoBrowserLayout : undefined
        if (layout && typeof layout.closeDetails === 'function') layout.closeDetails()
      } catch (_) {}
      dockOpenedByUs = false
    }

    function reportHostBounds(bridge) {
      if (!bridge || typeof bridge.reportPanelHostBounds !== 'function') return false
      const bounds = measureDetailsColumn()
      if (!bounds) return false
      const composer = findComposerRect()
      // Measuring a track the composer still crosses = do not report / paint.
      if (composer && rectsOverlap(bounds, composer)) return false
      bridge.reportPanelHostBounds(bounds).catch(() => {})
      return true
    }

    function waitForDockReady(bridge, opts) {
      const timeoutMs = (opts && opts.timeoutMs) || 800
      const started = Date.now()
      return new Promise((resolve) => {
        const tick = () => {
          applyDockReserve()
          openDetailsColumn()
          const bounds = measureDetailsColumn()
          const composer = findComposerRect()
          const ok =
            bounds &&
            bounds.width >= 8 &&
            !(composer && rectsOverlap(bounds, composer))
          if (ok) {
            reportHostBounds(bridge)
            resolve(true)
            return
          }
          if (Date.now() - started >= timeoutMs) {
            // Last attempt: still report only if anti-overlap holds.
            reportHostBounds(bridge)
            resolve(Boolean(measureDetailsColumn()))
            return
          }
          window.requestAnimationFrame(() => {
            setTimeout(tick, 32)
          })
        }
        tick()
      })
    }

    function forcePanelPlacement(bridge) {
      if (!bridge || typeof bridge.setPlacement !== 'function') return Promise.resolve()
      return bridge.setPlacement('panel').catch(() => {})
    }

    // ── Skill handoff text (shared by slot notifier + bridge fallback) ─────
    function skillTextFromResult(result) {
      if (!result || typeof result !== 'object') return ''
      if (typeof result.skillMarkdown === 'string' && result.skillMarkdown.trim().length > 0) {
        return result.skillMarkdown
      }
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
      return lines.join('\n')
    }

    function submitSkillToChat(text, inputActions) {
      if (!text) return false
      let submitted = false
      if (inputActions && typeof inputActions.setDraft === 'function') {
        inputActions.setDraft(text)
      }
      if (inputActions && typeof inputActions.submit === 'function') {
        inputActions.submit()
        submitted = true
      }
      return submitted
    }

    // Last-known inputActions from the slot occupant (bridge fallback uses it).
    let lastInputActions = null

    // ── Launcher ───────────────────────────────────────────────────────────
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
        const dockAndObserve = () => {
          applyDockReserve()
          openDetailsColumn()
          window.requestAnimationFrame(() => {
            reportHostBounds(bridge)
            const host = findShellFrame()
            if (!host || typeof ResizeObserver === 'undefined') return
            if (observer) observer.disconnect()
            observer = new ResizeObserver(() => {
              applyDockReserve()
              reportHostBounds(bridge)
            })
            observer.observe(host)
          })
        }
        refresh()
        window.addEventListener('focus', refresh)
        const offOpened = typeof bridge.onOpened === 'function' ? bridge.onOpened(() => {
          if (!alive) return
          setOpen(true)
          dockAndObserve()
        }) : undefined
        const offClosed = typeof bridge.onClosed === 'function' ? bridge.onClosed(() => {
          if (!alive) return
          setOpen(false)
          if (observer) observer.disconnect()
          observer = undefined
          clearDockReserve()
          closeDetailsColumnIfWeOpened()
        }) : undefined
        bridge.isOpen().then((value) => {
          if (alive && value === true) dockAndObserve()
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
        bridge.isOpen().then(
          async (value) => {
            const isOpenNow = value === true
            setOpen(!isOpenNow)
            if (isOpenNow) {
              await bridge.close()
              clearDockReserve()
              closeDetailsColumnIfWeOpened()
              return
            }
            // Abrir navegador → panel only (overlay not reachable from launcher).
            applyDockReserve()
            openDetailsColumn()
            await forcePanelPlacement(bridge)
            await waitForDockReady(bridge, { timeoutMs: 800 })
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
    // skill. Nothing is rendered. Empty catch / disk-only = FAIL.
    function ScreenRecordingNotifier(props) {
      const inputActions = props && props.inputActions
      React.useEffect(() => {
        if (inputActions) lastInputActions = inputActions
        const live = browserBridge()
        if (!live || typeof live.onScreenRecordingStopped !== 'function') return undefined
        return live.onScreenRecordingStopped((result) => {
          const text = skillTextFromResult(result)
          // D-B / D4 — always inject into the active agent turn (not disk-only).
          const ok = submitSkillToChat(text, inputActions || lastInputActions)
          if (!ok && text) {
            console.error('[abaco-browser] skill handoff could not submit to chat (no inputActions)')
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
    // Prohibido: assigning window.__abaco_ctx (full ctx stash)
    const inject = ['slots', 'layout']

    function apply(ctx) {
      injectStyle()
      injectDockStyle()
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

      // Bridge-level fallback: if the slot occupant misses the event (unmounted
      // blank session, etc.), still push Grabar→Parar skill markdown into chat.
      try {
        const bridge = browserBridge()
        if (bridge && typeof bridge.onScreenRecordingStopped === 'function' && !window.__abacoBrowserSkillHandoffBound) {
          window.__abacoBrowserSkillHandoffBound = true
          bridge.onScreenRecordingStopped((result) => {
            const text = skillTextFromResult(result)
            if (!text) return
            // Prefer live slot actions; if missing, try a late DOM-driven no-op log.
            if (!submitSkillToChat(text, lastInputActions)) {
              console.warn('[abaco-browser] bridge skill handoff waiting for inputActions')
            }
          })
        }
      } catch (_) {}
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
