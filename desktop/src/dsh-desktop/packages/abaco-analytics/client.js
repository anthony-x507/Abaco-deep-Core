window.__ModuleLoader__.load({
  id: 'abaco-analytics',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const {
      summarizeChatNodes,
      formatDuration,
      formatTokens,
      formatPercent,
      formatTtftRange,
      isAnalyticsStripText,
    } = require('./lib/summary.js')

    const STYLE_ID = 'abaco-analytics-style'
    const SETTINGS_ID = 'abaco-analytics'
    const COLLECTOR_ID = 'abaco-analytics-collector'
    const HIDDEN_ATTR = 'data-abaco-hidden-analytics'

    const listeners = new Set()
    let snapshot = emptySnapshot()

    function emptySnapshot() {
      return {
        turns: 0,
        steps: 0,
        llmMs: 0,
        toolMs: 0,
        ttftAvgMs: null,
        ttftMinMs: null,
        ttftMaxMs: null,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        cacheHitRate: null,
        requestCount: 0,
        contextPercent: null,
        contextWindow: null,
        updatedAt: 0,
      }
    }

    function publish(next) {
      snapshot = next
      listeners.forEach((fn) => fn(snapshot))
    }

    function subscribe(fn) {
      listeners.add(fn)
      fn(snapshot)
      return () => listeners.delete(fn)
    }

    function copy() {
      const lang = typeof navigator !== 'undefined' && navigator.language
        ? String(navigator.language).toLowerCase()
        : ''
      if (lang.indexOf('es') === 0) {
        return {
          title: 'Analytics',
          intro: 'Métricas de la sesión activa. Ya no se muestran debajo del composer.',
          empty: 'Abre una sesión y envía un mensaje para llenar este panel.',
          turns: 'Turnos',
          steps: 'Pasos',
          llm: 'Tiempo LLM',
          tool: 'Tiempo de tools',
          ttft: 'TTFT (promedio / rango)',
          cache: 'Cache hit',
          input: 'Input tokens',
          output: 'Output tokens',
          context: 'Contexto',
          access: 'Modo de acceso',
          accessHelp: 'El escudo (Full access / workspace / read-only) vive en la barra superior, junto al selector de modelo. No se quitó: solo salió del recuadro del mensaje. También puedes usar /permission.',
        }
      }
      return {
        title: 'Analytics',
        intro: 'Live session metrics. They no longer sit under the composer.',
        empty: 'Open a session and send a message to populate this panel.',
        turns: 'Turns',
        steps: 'Steps',
        llm: 'LLM time',
        tool: 'Tool-call time',
        ttft: 'TTFT (avg / range)',
        cache: 'Cache hit',
        input: 'Input tokens',
        output: 'Output tokens',
        context: 'Context',
        access: 'Access mode',
        accessHelp: 'The shield (Full access / workspace / read-only) lives in the top chrome next to the model dropdown. The capability is unchanged — it left the message box. /permission still works.',
      }
    }

    function collectFromProps(props) {
      const useChat = props && props.useChat
      const useProjection = props && props.useProjection
      let nodes = []
      if (typeof useChat === 'function') {
        try {
          nodes = useChat((chat) => {
            if (!chat) return []
            if (chat.legacy && Array.isArray(chat.legacy.nodes)) return chat.legacy.nodes
            if (Array.isArray(chat.nodes)) return chat.nodes
            return []
          }) || []
        } catch {
          nodes = []
        }
      }
      const next = { ...emptySnapshot(), ...summarizeChatNodes(nodes), updatedAt: Date.now() }
      if (typeof useProjection === 'function') {
        try {
          const pressure = useProjection('contextPressure')
          if (pressure && typeof pressure === 'object') {
            const used = Number(pressure.usedTokens ?? pressure.projectedTokens ?? pressure.estimatedTokens)
            const windowSize = Number(pressure.contextWindow ?? pressure.windowTokens)
            if (Number.isFinite(used) && Number.isFinite(windowSize) && windowSize > 0) {
              next.contextPercent = Math.round((used / windowSize) * 100)
              next.contextWindow = windowSize
            }
          }
        } catch {
          // Projection seat is optional in this slot.
        }
      }
      return next
    }

    function AnalyticsCollector(props) {
      const next = collectFromProps(props)
      React.useEffect(() => {
        publish(next)
      }, [next.turns, next.steps, next.llmMs, next.toolMs, next.inputTokens, next.requestCount, next.contextPercent])
      return null
    }

    function CollectorEntry(props) {
      return h(AnalyticsCollector, props || {})
    }

    function MetricRow({ label, value }) {
      return h(
        'div',
        { className: 'abaco-analytics-row' },
        h('span', { className: 'abaco-analytics-label' }, label),
        h('span', { className: 'abaco-analytics-value' }, value),
      )
    }

    function SettingsPanel() {
      const [state, setState] = React.useState(snapshot)
      React.useEffect(() => subscribe(setState), [])
      const t = copy()
      const empty = !state.requestCount && !state.turns
      return h(
        'div',
        { className: 'abaco-analytics-panel', 'data-abaco-analytics': 'settings' },
        h('h3', { className: 'abaco-analytics-title' }, t.title),
        h('p', { className: 'abaco-analytics-intro' }, t.intro),
        empty
          ? h('p', { className: 'abaco-analytics-empty' }, t.empty)
          : h(
            'div',
            { className: 'abaco-analytics-grid' },
            h(MetricRow, { label: t.turns, value: String(state.turns) }),
            h(MetricRow, { label: t.steps, value: String(state.steps) }),
            h(MetricRow, { label: t.llm, value: formatDuration(state.llmMs) }),
            h(MetricRow, { label: t.tool, value: formatDuration(state.toolMs) }),
            h(MetricRow, {
              label: t.ttft,
              value: `${formatDuration(state.ttftAvgMs)} · ${formatTtftRange(state.ttftMinMs, state.ttftMaxMs)}`,
            }),
            h(MetricRow, { label: t.cache, value: formatPercent(state.cacheHitRate) }),
            h(MetricRow, { label: t.input, value: formatTokens(state.inputTokens) }),
            h(MetricRow, { label: t.output, value: formatTokens(state.outputTokens) }),
            state.contextPercent != null && h(MetricRow, {
              label: t.context,
              value: `${state.contextPercent}%${state.contextWindow ? ` · ${formatTokens(state.contextWindow)}` : ''}`,
            }),
          ),
        h('h4', { className: 'abaco-analytics-sub' }, t.access),
        h('p', { className: 'abaco-analytics-intro' }, t.accessHelp),
      )
    }

    function hideAnalyticsStrips(root) {
      if (!root || typeof root.querySelectorAll !== 'function') return 0
      let hidden = 0
      const nodes = root.querySelectorAll
        ? root.querySelectorAll('[data-slot="conversation.composer.dock"], [data-composer-dock], [class*="composer"]')
        : []
      const seen = new Set()
      const visit = (el) => {
        if (!el || el.nodeType !== 1 || seen.has(el)) return
        seen.add(el)
        if (el.getAttribute && el.getAttribute(HIDDEN_ATTR) === '1') return
        if (el.closest && el.closest('[data-plugin="dsh-ppt-composer"]')) return
        const text = (el.innerText || el.textContent || '').trim()
        if (!isAnalyticsStripText(text)) return
        // Only hide leaf-ish strips, not the whole conversation column.
        if (text.length > 400) return
        el.setAttribute(HIDDEN_ATTR, '1')
        hidden += 1
      }
      if (typeof root.querySelectorAll === 'function') {
        root.querySelectorAll('[data-slot="conversation.composer.dock"] *').forEach(visit)
        root.querySelectorAll('[data-slot="conversation.composer.dock"]').forEach(visit)
      }
      void nodes
      return hidden
    }

    function watchComposerDock() {
      if (typeof document === 'undefined') return
      hideAnalyticsStrips(document)
      if (typeof MutationObserver !== 'function') return
      const observer = new MutationObserver(() => {
        hideAnalyticsStrips(document)
      })
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }

    function injectStyle() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
      const s = document.createElement('style')
      s.id = STYLE_ID
      s.dataset.plugin = 'abaco-analytics'
      s.textContent = `
        [${HIDDEN_ATTR}="1"] { display: none !important; }
        [data-composer-card] button.VphDDa_add { display: none !important; }
        [data-abaco-analytics-strip] { display: none !important; }
        .abaco-analytics-panel {
          padding: 16px;
          color: var(--abaco-fg-0, #F1F5F9);
          font-size: 14px;
        }
        .abaco-analytics-title {
          margin: 0 0 8px;
          font-size: 16px;
          font-weight: 600;
        }
        .abaco-analytics-sub {
          margin: 20px 0 8px;
          font-size: 13px;
          font-weight: 600;
        }
        .abaco-analytics-intro, .abaco-analytics-empty {
          margin: 0 0 16px;
          color: var(--abaco-fg-1, #94A3B8);
          line-height: 1.45;
        }
        .abaco-analytics-grid {
          display: grid;
          gap: 8px;
        }
        .abaco-analytics-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 8px 10px;
          background: var(--abaco-bg-1, #111729);
          border: 1px solid var(--abaco-border, #1E293B);
          border-radius: 8px;
        }
        .abaco-analytics-label { color: var(--abaco-fg-1, #94A3B8); }
        .abaco-analytics-value {
          font-family: var(--abaco-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
          font-size: 13px;
        }
      `
      document.head.appendChild(s)
    }

    const inject = ['slots']

    function apply(ctx) {
      injectStyle()
      watchComposerDock()

      ctx.slots.inject('conversation.session.header.utilities', () =>
        ctx.slots.register(
          { name: 'conversation.session.header.utilities', id: COLLECTOR_ID, order: 80 },
          CollectorEntry,
        ),
      )

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: SETTINGS_ID, order: 70, label: 'Analytics' },
          SettingsPanel,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.__test__ = { collectFromProps, hideAnalyticsStrips, subscribe, publish, emptySnapshot }
    return module.exports
  },
})
