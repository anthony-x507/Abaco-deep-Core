window.__ModuleLoader__.load({
  id: 'abaco-analytics',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // The web module table only seeds platform ids (react, @deepseek-ai/*).
    // A relative specifier ./lib/summary.js misses the table even when that
    // file exists under Resources/app/node_modules (asar:false copies bytes;
    // it does not register a factory). Bindings below are materialized
    // from lib/summary.js — not listed as seeds or externals.
    // Materialized from ./lib/summary.js — not a module-table seed or external.
    /**
     * Pure session-analytics helpers. Node tests import lib/summary.js directly.
     * This factory keeps a materialized copy so the loader module table can
     * answer every require() without a relative specifier.
     */

    /** A composer-dock / footer strip that belongs in Settings, not under the box. */
    const ANALYTICS_STRIP_MARKERS = [
      /\bturns?\b/i,
      /\bsteps?\b/i,
      /\bTTFT\b/i,
      /cache\s*hit/i,
      /tool\s*call/i,
      /tok\/s/i,
      /\bLLM\b/,
    ]

    /**
     * @param {unknown} text
     * @returns {boolean}
     */
    function isAnalyticsStripText(text) {
      const value = String(text || '').replace(/\s+/g, ' ').trim()
      if (value.length < 8) return false
      let hits = 0
      for (const marker of ANALYTICS_STRIP_MARKERS) {
        if (marker.test(value)) hits += 1
      }
      return hits >= 2
    }

    /**
     * @param {unknown} value
     * @returns {number | null}
     */
    function asFiniteNumber(value) {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? n : null
    }

    /**
     * Provider usage blobs are not one shape. Read the common token fields.
     * @param {unknown} usage
     * @returns {{ input: number, cached: number, output: number }}
     */
    function readUsage(usage) {
      if (!usage || typeof usage !== 'object') return { input: 0, cached: 0, output: 0 }
      const row = /** @type {Record<string, unknown>} */ (usage)
      const input = firstNumber(row, [
        'inputTokens',
        'prompt_tokens',
        'promptTokens',
        'input_tokens',
        'promptCacheMissTokens',
      ])
      const cached = firstNumber(row, [
        'cacheReadTokens',
        'cached_tokens',
        'prompt_cache_hit_tokens',
        'cache_read_input_tokens',
        'cacheHits',
        'cachedTokens',
      ])
      const output = firstNumber(row, [
        'outputTokens',
        'completion_tokens',
        'completionTokens',
        'output_tokens',
      ])
      return { input, cached, output }
    }

    /**
     * @param {Record<string, unknown>} row
     * @param {string[]} keys
     */
    function firstNumber(row, keys) {
      for (const key of keys) {
        const n = asFiniteNumber(row[key])
        if (n != null) return n
      }
      return 0
    }

    /**
     * @param {unknown} nodes
     * @returns {{
     *   turns: number,
     *   steps: number,
     *   llmMs: number,
     *   toolMs: number,
     *   ttftAvgMs: number | null,
     *   ttftMinMs: number | null,
     *   ttftMaxMs: number | null,
     *   inputTokens: number,
     *   cachedTokens: number,
     *   outputTokens: number,
     *   cacheHitRate: number | null,
     *   requestCount: number,
     * }}
     */
    function summarizeChatNodes(nodes) {
      const list = Array.isArray(nodes) ? nodes : []
      const assistants = list.filter((node) => node && node.kind === 'assistant')
      let maxTurn = 0
      let maxStep = 0
      let llmMs = 0
      let toolMs = 0
      /** @type {number[]} */
      const ttfts = []
      let inputTokens = 0
      let cachedTokens = 0
      let outputTokens = 0

      for (const node of assistants) {
        const turn = asFiniteNumber(node.turn)
        const step = asFiniteNumber(node.step)
        if (turn != null) maxTurn = Math.max(maxTurn, turn)
        if (step != null) maxStep = Math.max(maxStep, step)

        const timing = node.timing && typeof node.timing === 'object' ? node.timing : {}
        const start = asFiniteNumber(timing.stepStartTime)
        const first = asFiniteNumber(timing.firstTokenTime)
        const done = asFiniteNumber(timing.completedTime)
        if (start != null && first != null && first >= start) ttfts.push(first - start)
        if (first != null && done != null && done >= first) llmMs += done - first
        else if (start != null && done != null && done >= start) llmMs += done - start

        const usage = readUsage(node.usage)
        inputTokens += usage.input
        cachedTokens += usage.cached
        outputTokens += usage.output
      }

      toolMs = sumToolMs(list, assistants)

      const billed = inputTokens + cachedTokens
      return {
        turns: maxTurn || assistants.length,
        steps: maxStep || assistants.length,
        llmMs,
        toolMs,
        ttftAvgMs: average(ttfts),
        ttftMinMs: ttfts.length ? Math.min(...ttfts) : null,
        ttftMaxMs: ttfts.length ? Math.max(...ttfts) : null,
        inputTokens,
        cachedTokens,
        outputTokens,
        cacheHitRate: billed > 0 ? cachedTokens / billed : null,
        requestCount: assistants.length,
      }
    }

    /**
     * Tool-call duration when the chat/trajectory nodes carry timestamps.
     * @param {unknown[]} list
     * @param {unknown[]} assistants
     */
    function sumToolMs(list, assistants) {
      let total = 0
      for (const node of list) {
        if (!node || typeof node !== 'object') continue
        const kind = node.kind
        if (kind !== 'tool' && kind !== 'tool-call' && kind !== 'tool_call') continue
        const start = asFiniteNumber(node.startedAt ?? node.startTime ?? node.time)
        const end = asFiniteNumber(node.endedAt ?? node.endTime ?? node.completedTime)
        if (start != null && end != null && end >= start) total += end - start
      }
      if (total > 0) return total
      // Fallback: time-to-first-token is the wait that is not model decode.
      for (const node of assistants) {
        const timing = node && node.timing && typeof node.timing === 'object' ? node.timing : {}
        const start = asFiniteNumber(timing.stepStartTime)
        const first = asFiniteNumber(timing.firstTokenTime)
        if (start != null && first != null && first >= start) total += first - start
      }
      return total
    }

    /**
     * @param {number[]} values
     * @returns {number | null}
     */
    function average(values) {
      if (!values.length) return null
      return values.reduce((sum, value) => sum + value, 0) / values.length
    }

    /**
     * @param {number | null | undefined} ms
     * @returns {string}
     */
    function formatDuration(ms) {
      if (ms == null || !Number.isFinite(ms)) return '—'
      const total = Math.max(0, Math.round(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      if (hours > 0) return minutes ? `${hours}h${minutes}m` : `${hours}h`
      if (minutes > 0) return seconds ? `${minutes}m${seconds}s` : `${minutes}m`
      return `${seconds}s`
    }

    /**
     * @param {number | null | undefined} n
     * @returns {string}
     */
    function formatTokens(n) {
      if (n == null || !Number.isFinite(n)) return '—'
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M tok`
      if (n >= 1e3) return `${Math.round(n / 100) / 10}K tok`
      return `${Math.round(n)} tok`
    }

    /**
     * @param {number | null | undefined} rate
     * @returns {string}
     */
    function formatPercent(rate) {
      if (rate == null || !Number.isFinite(rate)) return '—'
      return `${Math.round(rate * 1000) / 10}%`
    }

    /**
     * @param {number | null | undefined} minMs
     * @param {number | null | undefined} maxMs
     * @returns {string}
     */
    function formatTtftRange(minMs, maxMs) {
      if (minMs == null && maxMs == null) return '—'
      if (minMs != null && maxMs != null && minMs !== maxMs) {
        return `${formatDuration(minMs)}–${formatDuration(maxMs)}`
      }
      return formatDuration(minMs ?? maxMs)
    }

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
