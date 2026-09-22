window.__ModuleLoader__.load({
  id: 'abaco-agent-status',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ── Target slot ────────────────────────────────────────────────────────
    // `conversation.session.header.actions` is a session-scope LIST slot of
    // the stock ConversationSessionHeader (dsh-client-ui-conversation). The
    // slots contract states header actions "derive their state from standard
    // Session props", so each occupant receives the session standard kit:
    //   useSession / sessionId / useProjection / useConversation / useInput /
    //   inputActions / useChat / useTrajectory / useSessions / useWorkspaces /
    //   useSessionPendingInteraction (verified against the runtime slot
    //   catalog in @deepseek-ai/dsh-cordis-client-runner and the render
    //   machinery's materializeStandardBinding in @deepseek-ai/
    //   dsh-client-ui-renderer). The Agent running bit is exactly
    //   SessionSnapshot.running — the live Agent running-state the Session
    //   controller mirrors (`handleSessionStatus(sessionId, running)`), the
    //   same signal the shipped composer reads via useSession((s) => s.running).
    // Composer watermark pulse hooks the SAME `useSession((s) => s.running)`
    // bit: idle → low static opacity; running/streaming → opacity pulse 2000ms.
    const SLOT = 'conversation.session.header.actions'
    const OCCUPANT_ID = 'abaco-agent-status'
    const STYLE_ID = 'abaco-agent-status-style'
    const WATERMARK_ATTR = 'data-abaco-chat-watermark'
    const COMPOSER_HOST_ATTR = 'data-abaco-composer-watermark-host'
    // Official ABACO HARNESS mark, served by scripts/install-brand-assets.mjs
    // into dsh-web-frontend/dist as /abaco-logo-new.png (transparent edges).
    const WATERMARK_SRC = '/abaco-logo-new.png'
    const COMPOSER_HOST_SELECTORS = [
      '[data-composer-card]',
      '[data-composer-seat]',
      '[data-testid="composer"]',
      '[class*="composer"]',
    ]

    // ── Copy (plain navigator-language sniff; the theme owns no locale seat) ──
    const COPY = {
      es: { agent: 'AGENTE TRABAJANDO', subagent: 'SUBAGENTE TRABAJANDO' },
      en: { agent: 'AGENT WORKING', subagent: 'SUBAGENT WORKING' },
    }

    function activeCopy() {
      const lang = typeof navigator !== 'undefined' && navigator.language
        ? String(navigator.language).toLowerCase()
        : ''
      return lang.indexOf('es') === 0 ? COPY.es : COPY.en
    }

    function findComposerHost() {
      if (typeof document === 'undefined') return null
      for (let i = 0; i < COMPOSER_HOST_SELECTORS.length; i += 1) {
        const found = document.querySelector(COMPOSER_HOST_SELECTORS[i])
        if (found) return found
      }
      return null
    }

    function ensureWatermarkElement(host) {
      if (!host) return null
      let el = host.querySelector('[' + WATERMARK_ATTR + ']')
      if (!el) {
        const style = window.getComputedStyle(host)
        if (style.position === 'static') {
          host.style.position = 'relative'
        }
        if (!host.style.isolation) {
          host.style.isolation = 'isolate'
        }
        host.setAttribute(COMPOSER_HOST_ATTR, 'true')
        el = document.createElement('div')
        el.setAttribute(WATERMARK_ATTR, 'idle')
        el.className = 'abaco-chat-watermark'
        el.setAttribute('aria-hidden', 'true')
        host.insertBefore(el, host.firstChild)
      }
      return el
    }

    function syncWatermark(running) {
      const host = findComposerHost()
      const el = ensureWatermarkElement(host)
      if (!el) return false
      el.setAttribute(WATERMARK_ATTR, running ? 'working' : 'idle')
      el.classList.toggle('is-working', !!running)
      return true
    }

    // Syncs a 70% pointer-events:none logo behind the composer writing surface.
    // Pulses only while SessionSnapshot.running is true (real agent-working
    // signal — not a free-running timer).
    function ChatWatermark({ useSession }) {
      const running = useSession((s) => s.running) ?? false
      React.useEffect(() => {
        let cancelled = false
        const apply = () => {
          if (!cancelled) syncWatermark(running)
        }
        apply()
        let frame = 0
        const Observer = typeof MutationObserver === 'function' ? MutationObserver : null
        const observer = Observer
          ? new Observer(() => {
              if (frame || cancelled) return
              frame = requestAnimationFrame(() => {
                frame = 0
                apply()
              })
            })
          : null
        if (observer && document.documentElement) {
          observer.observe(document.documentElement, { childList: true, subtree: true })
        }
        return () => {
          cancelled = true
          if (frame) cancelAnimationFrame(frame)
          if (observer) observer.disconnect()
        }
      }, [running])
      React.useEffect(() => {
        return () => {
          if (typeof document === 'undefined') return
          document.querySelectorAll('[' + WATERMARK_ATTR + ']').forEach((node) => {
            node.remove()
          })
          document.querySelectorAll('[' + COMPOSER_HOST_ATTR + ']').forEach((node) => {
            node.removeAttribute(COMPOSER_HOST_ATTR)
          })
        }
      }, [])
      return null
    }

    // ── Pill ────────────────────────────────────────────────────────────────
    // Reads the standard useSession selector (always present in session
    // scope). Renders nothing while idle so the pill appears exactly while the
    // agent is working and disappears when it finishes.
    function AgentWorkingPill({ useSession }) {
      const running = useSession((s) => s.running) ?? false
      const subagent = useSession((s) => s.subagent) ?? null
      if (!running) return null
      const copy = activeCopy()
      const label = subagent ? copy.subagent : copy.agent
      return h(
        'div',
        {
          className: 'abaco-agent-status',
          role: 'status',
          'aria-live': 'polite',
          'data-abaco-agent-status': 'working',
          title: label,
        },
        h('span', { className: 'abaco-agent-status-spinner', 'aria-hidden': 'true' }),
        h('span', { className: 'abaco-agent-status-label' }, label),
      )
    }

    // Guard leaf: never call a hook conditionally. If the standard seat is
    // ever missing (out-of-contract mount), degrade silently to nothing.
    function AgentStatusEntry(props) {
      const useSession = props && props.useSession
      if (typeof useSession !== 'function') return null
      return h(
        React.Fragment,
        null,
        h(ChatWatermark, { useSession }),
        h(AgentWorkingPill, { useSession }),
      )
    }

    // ── Style (ABACO navy/cyan tokens from abaco-theme, with fallbacks) ────
    function injectStyle() {
      if (!document || document.getElementById(STYLE_ID)) return
      const s = document.createElement('style')
      s.id = STYLE_ID
      s.dataset.plugin = 'abaco-agent-status'
      s.textContent = [
        '.abaco-agent-status {',
        '  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;',
        '  border-radius: 999px; background: rgba(56, 189, 248, 0.12);',
        '  border: 1px solid rgba(56, 189, 248, 0.4); color: var(--abaco-accent-1, #38BDF8);',
        "  font-family: var(--abaco-font-sans, 'SF Pro Text', -apple-system, system-ui, sans-serif);",
        '  font-size: var(--abaco-fs-xs, 11px); font-weight: 600; letter-spacing: 0.06em;',
        '  text-transform: uppercase; white-space: nowrap; user-select: none;',
        '  animation: abaco-agent-status-pop var(--abaco-dur-state, 200ms) var(--abaco-ease-out, ease-out);',
        '}',
        '.abaco-agent-status-spinner {',
        '  flex: none; width: 10px; height: 10px; border-radius: 50%;',
        '  border: 2px solid rgba(56, 189, 248, 0.25);',
        '  border-top-color: var(--abaco-accent-1, #38BDF8);',
        '  animation: abaco-agent-status-spin 0.9s linear infinite;',
        '}',
        '.abaco-agent-status-label { line-height: 1; }',
        '@keyframes abaco-agent-status-spin { to { transform: rotate(360deg); } }',
        '@keyframes abaco-agent-status-pop {',
        '  from { opacity: 0; transform: translateY(-2px) scale(0.96); }',
        '  to { opacity: 1; transform: none; }',
        '}',
        '/* Official ABACO HARNESS mark, 70% of the composer writing surface. */',
        '.abaco-chat-watermark, [' + WATERMARK_ATTR + '] {',
        '  position: absolute; left: 50%; top: 50%; width: 70%; height: 70%;',
        '  transform: translate(-50%, -50%); z-index: -1; pointer-events: none;',
        '  user-select: none; -webkit-user-drag: none;',
        "  background-image: url('" + WATERMARK_SRC + "');",
        '  background-repeat: no-repeat; background-position: center;',
        '  background-size: contain; opacity: 0.07;',
        '  filter: saturate(0.9) brightness(1);',
        '  transition: opacity 180ms ease, filter 180ms ease;',
        '}',
        '.abaco-chat-watermark.is-working, [' + WATERMARK_ATTR + '="working"] {',
        '  animation: abaco-chat-watermark-pulse 2000ms ease-in-out infinite;',
        '}',
        '@keyframes abaco-chat-watermark-pulse {',
        '  0%, 100% { opacity: 0.06; filter: saturate(0.85) brightness(0.96); }',
        '  50% { opacity: 0.16; filter: saturate(1.15) brightness(1.18); }',
        '}',
      ].join('\n')
      document.head.appendChild(s)
    }

    // ── Slot injection ─────────────────────────────────────────────────────
    const inject = ['slots']

    function apply(ctx) {
      injectStyle()
      ctx.slots.inject(SLOT, () =>
        ctx.slots.register(
          { name: SLOT, id: OCCUPANT_ID, order: 0, label: 'ABACO agent status' },
          AgentStatusEntry,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
