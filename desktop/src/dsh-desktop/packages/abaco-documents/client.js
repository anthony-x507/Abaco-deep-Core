window.__ModuleLoader__.load({
  id: 'abaco-documents',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ── Host extraction endpoint (registered by index.js on connection.fetch) ──
    const EXTRACT_PATH = '/api/abaco-documents.extract'
    const STYLE_ID = 'abaco-documents-style'
    const MAX_BYTES = 50 * 1024 * 1024

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return
      const s = document.createElement('style')
      s.id = STYLE_ID
      s.dataset.plugin = 'abaco-documents'
      s.textContent = `
        .abaco-doc-card {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          margin: 4px 4px 0 0;
          background: var(--abaco-bg-1, #111729);
          border: 1px solid var(--abaco-border, #1E293B);
          border-radius: var(--abaco-radius, 8px);
          font-size: var(--abaco-fs-sm, 12px);
          color: var(--abaco-fg-1, #94A3B8);
          max-width: 280px;
          animation: abaco-fade-in var(--abaco-dur-state, 200ms) var(--abaco-ease-out, ease-out);
        }
        .abaco-doc-card .abaco-doc-icon { font-size: 14px; flex: none; }
        .abaco-doc-card .abaco-doc-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .abaco-doc-card .abaco-doc-meta {
          color: var(--abaco-fg-2, #64748B);
          font-family: var(--abaco-font-mono, monospace);
          font-size: var(--abaco-fs-xs, 11px);
          flex: none;
        }
        .abaco-doc-card .abaco-doc-remove {
          background: transparent;
          border: none;
          color: var(--abaco-fg-2, #64748B);
          cursor: pointer;
          font-size: 16px;
          padding: 0 4px;
          border-radius: var(--abaco-radius-sm, 6px);
          flex: none;
        }
        .abaco-doc-card .abaco-doc-remove:hover { color: var(--abaco-danger, #F87171); }
        .abaco-doc-card.abaco-doc-error { border-color: var(--abaco-danger, #F87171); color: var(--abaco-danger, #F87171); }
        .abaco-doc-card.abaco-doc-loading { opacity: 0.7; }
        @keyframes abaco-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .abaco-doc-row-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin: 4px 4px 0 0;
          flex: 1 1 100%;
        }
        .abaco-doc-action {
          padding: 3px 10px;
          background: var(--abaco-bg-2, #1A2238);
          border: 1px solid var(--abaco-border, #1E293B);
          border-radius: var(--abaco-radius-sm, 6px);
          color: var(--abaco-fg-1, #94A3B8);
          font-size: var(--abaco-fs-xs, 11px);
          cursor: pointer;
        }
        .abaco-doc-action:hover { color: var(--abaco-fg-0, #F1F5F9); border-color: var(--abaco-border-strong, #334155); }
        .abaco-doc-action:disabled { opacity: 0.5; cursor: default; }
        .abaco-doc-upload-btn {
          width: 32px; height: 32px;
          border-radius: var(--abaco-radius, 8px);
          background: var(--abaco-bg-2, #1A2238);
          border: 1px solid var(--abaco-border, #1E293B);
          color: var(--abaco-fg-1, #94A3B8);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          transition: all var(--abaco-dur-hover, 150ms) var(--abaco-ease-out, ease-out);
        }
        .abaco-doc-upload-btn:hover {
          background: var(--abaco-bg-3, #232E4A);
          color: var(--abaco-fg-0, #F1F5F9);
          border-color: var(--abaco-border-strong, #334155);
        }
        .abaco-doc-upload-btn.abaco-doc-busy {
          pointer-events: none;
          opacity: 0.6;
        }
      `
      document.head.appendChild(s)
    }

    // ── Per-session document store ───────────────────────────────────────

    function createStore() {
      const listeners = new Set()
      let docs = [] // { id, name, size, type, status, text?, meta?, error? }
      return {
        get: () => docs,
        add: (doc) => {
          docs = [...docs, doc]
          listeners.forEach((l) => l(docs))
        },
        remove: (id) => {
          docs = docs.filter((d) => d.id !== id)
          listeners.forEach((l) => l(docs))
        },
        clear: () => {
          docs = []
          listeners.forEach((l) => l(docs))
        },
        subscribe: (fn) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      }
    }

    // ── Extraction transport: POST raw bytes to the host route ────────────

    async function extractFile(file) {
      if (file.size > MAX_BYTES) {
        throw new Error(`Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo permitido: ${MAX_BYTES / 1024 / 1024} MB.`)
      }
      const bytes = await file.arrayBuffer()
      const res = await fetch(
        `${window.location.origin}${EXTRACT_PATH}?filename=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes,
        },
      )
      let payload = null
      try { payload = await res.json() } catch {}
      if (!res.ok || !payload || payload.ok !== true) {
        throw new Error((payload && payload.error) || `La extracción falló (HTTP ${res.status}).`)
      }
      return { text: payload.text || '', meta: payload.meta || {} }
    }

    // ── Upload button (composer right accessory) ─────────────────────────

    function UploadButton({ store }) {
      const inputRef = React.useRef(null)
      const [busy, setBusy] = React.useState(false)

      const onPick = async (e) => {
        const files = Array.from(e.target.files || [])
        e.target.value = '' // allow re-pick of same file
        if (!files.length) return
        setBusy(true)
        for (const file of files) {
          const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          store.add({
            id, name: file.name, size: file.size, type: file.type,
            status: 'extracting',
          })
          try {
            const { text, meta } = await extractFile(file)
            store.remove(id)
            store.add({
              id, name: file.name, size: file.size, type: file.type,
              status: 'ready', text, meta,
            })
          } catch (err) {
            store.remove(id)
            store.add({
              id, name: file.name, size: file.size, type: file.type,
              status: 'error', error: err && err.message ? err.message : String(err),
            })
          }
        }
        setBusy(false)
      }

      return h(
        React.Fragment, null,
        h('button', {
          type: 'button',
          'aria-label': 'Subir documento',
          title: 'Subir documento (PDF, DOCX, TXT, MD, CSV, JSON, YAML)',
          className: `abaco-doc-upload-btn${busy ? ' abaco-doc-busy' : ''}`,
          onClick: () => inputRef.current && inputRef.current.click(),
        }, busy ? '…' : '📎'),
        h('input', {
          ref: inputRef,
          type: 'file',
          multiple: true,
          accept: '.pdf,.docx,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv',
          onChange: onPick,
          style: { display: 'none' },
        }),
      )
    }

    // ── Preview card ─────────────────────────────────────────────────────

    function DocCard({ doc, onRemove }) {
      const isError = doc.status === 'error'
      const isLoading = doc.status === 'extracting'
      const sizeStr = formatBytes(doc.size)
      return h(
        'div',
        {
          className: `abaco-doc-card${isError ? ' abaco-doc-error' : ''}${isLoading ? ' abaco-doc-loading' : ''}`,
          title: isError ? doc.error : (doc.text ? `${doc.text.length} caracteres extraídos` : ''),
        },
        h('span', { className: 'abaco-doc-icon' },
          isError ? '⚠' : isLoading ? '⏳' : iconForType(doc.name)),
        h('span', { className: 'abaco-doc-name' }, doc.name),
        h('span', { className: 'abaco-doc-meta' },
          isLoading ? 'extrayendo…' : isError ? 'error' : sizeStr),
        h('button', {
          type: 'button',
          className: 'abaco-doc-remove',
          'aria-label': 'Quitar documento',
          onClick: () => onRemove(doc.id),
        }, '×'),
      )
    }

    function iconForType(name) {
      const lower = name.toLowerCase()
      if (lower.endsWith('.pdf')) return '📄'
      if (lower.endsWith('.docx')) return '📝'
      if (lower.endsWith('.csv')) return '📊'
      if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml')) return '⚙'
      if (lower.endsWith('.md') || lower.endsWith('.markdown')) return '📑'
      return '📃'
    }

    function formatBytes(n) {
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    // ── Build the XML-ish context block appended to the message draft ────

    function buildContextText(docs) {
      const ready = docs.filter((d) => d.status === 'ready' && d.text)
      if (!ready.length) return ''
      const parts = ready.map((d) => {
        const meta = d.meta || {}
        const where = meta.pageCount ? ` (${meta.pageCount} pages)` : ` (${meta.charCount || d.text.length} chars)`
        return `\n\n<document name="${escapeXml(d.name)}"${where}>\n${d.text}\n</document>`
      })
      return `\n\n<attachments>\n${parts.join('')}\n</attachments>`
    }

    function escapeXml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    // ── Documents row (renders above the composer card, via input.dock) ──

    // Read the live draft through the standard session props when available
    // (keeps the insert handler from clobbering text typed since last render).
    function readCurrentDraft(props) {
      const useInput = props && props.useInput
      if (typeof useInput !== 'function') return ''
      try {
        const value = useInput((s) => (s && s.draft) || '')
        return value || ''
      } catch {
        return ''
      }
    }

    function DocumentsRow({ store, input, inputActions, useInput }) {
      const [docs, setDocs] = React.useState(store.get())
      React.useEffect(() => store.subscribe(setDocs), [store])
      const draft = readCurrentDraft({ useInput }) || (input && input.draft) || ''
      const ready = docs.filter((d) => d.status === 'ready')

      const onRemove = (id) => store.remove(id)

      const onInsert = () => {
        if (!ready.length) return
        if (!inputActions || typeof inputActions.setDraft !== 'function') return
        const context = buildContextText(docs)
        if (!context) return
        inputActions.setDraft(`${draft}${context}`)
        store.clear()
      }

      if (!docs.length) return null

      return h(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', padding: '4px 12px 0' } },
        ...docs.map((d) => h(DocCard, { key: d.id, doc: d, onRemove })),
        ready.length > 0 && h(
          'div', { className: 'abaco-doc-row-actions' },
          h('button', {
            type: 'button',
            className: 'abaco-doc-action',
            disabled: !inputActions || typeof inputActions.setDraft !== 'function',
            onClick: onInsert,
            title: inputActions && typeof inputActions.setDraft === 'function'
              ? 'Añade el texto extraído al mensaje actual (lo verás en el editor para revisarlo antes de enviar)'
              : 'Inserta el texto en el editor del mensaje antes de enviarlo',
          }, `Insertar contexto en el mensaje (${ready.length})`),
          h('button', {
            type: 'button',
            className: 'abaco-doc-action',
            onClick: () => store.clear(),
          }, 'Quitar todos'),
        ),
      )
    }

    // ── Wire up ─────────────────────────────────────────────────────────

    const inject = ['slots']

    function apply(ctx) {
      injectStyle()
      const store = createStore()

      // Attach to ctx so other plugins can read it
      ctx.abaco = ctx.abaco || {}
      ctx.abaco.documents = store

      // Upload button → right accessory of the composer tool row
      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          { name: 'conversation.input.right', id: 'abaco-documents-upload', order: 20 },
          function AbacoUploadButton() {
            return h(UploadButton, { store })
          },
        ),
      )

      // Document cards row → full-width strip above the composer card
      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          { name: 'conversation.input.dock', id: 'abaco-documents-row', order: -1000 },
          function AbacoDocumentsRow(props) {
            return h(DocumentsRow, {
              store,
              input: props && props.input,
              inputActions: props && props.inputActions,
              useInput: props && props.useInput,
            })
          },
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
