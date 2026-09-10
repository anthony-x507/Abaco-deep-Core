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
    const SLOT = 'conversation.session.header.actions'
    const OCCUPANT_ID = 'abaco-agent-status'
    const STYLE_ID = 'abaco-agent-status-style'

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
      return h(AgentWorkingPill, { useSession })
    }

    // ── Style (ABACO navy/cyan tokens from abaco-theme, with fallbacks) ────
    function injectStyle() {
      if (!document || document.getElementById(STYLE_ID)) return
      const s = document.createElement('style')
      s.id = STYLE_ID
      s.dataset.plugin = 'abaco-agent-status'
      s.textContent = `
        .abaco-agent-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 24px;
          padding: 0 10px;
          border-radius: 999px;
          background: rgba(56, 189, 248, 0.12);
          border: 1px solid rgba(56, 189, 248, 0.4);
          color: var(--abaco-accent-1, #38BDF8);
          font-family: var(--abaco-font-sans, 'SF Pro Text', -apple-system, system-ui, sans-serif);
          font-size: var(--abaco-fs-xs, 11px);
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          white-space: nowrap;
          user-select: none;
          animation: abaco-agent-status-pop var(--abaco-dur-state, 200ms) var(--abaco-ease-out, ease-out);
        }
        .abaco-agent-status-spinner {
          flex: none;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid rgba(56, 189, 248, 0.25);
          border-top-color: var(--abaco-accent-1, #38BDF8);
          animation: abaco-agent-status-spin 0.9s linear infinite;
        }
        .abaco-agent-status-label {
          line-height: 1;
        }
        @keyframes abaco-agent-status-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes abaco-agent-status-pop {
          from { opacity: 0; transform: translateY(-2px) scale(0.96); }
          to { opacity: 1; transform: none; }
        }
      `
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
