window.__ModuleLoader__.load({
  id: 'abaco-documents',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { extract, acceptString, supportedTypes } = require('./lib/parsers.js')

    const STYLE_ID = 'abaco-documents-style'

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
          background: var(--abaco-bg-1);
          border: 1px solid var(--abaco-border);
          border-radius: var(--abaco-radius);
          font-size: var(--abaco-fs-sm);
          color: var(--abaco-fg-1);
          max-width: 280px;
          animation: abaco-fade-in var(--abaco-dur-state) var(--abaco-ease-out);
        }
        .abaco-doc-card .abaco-doc-icon { font-size: 14px; flex: none; }
        .abaco-doc-card .abaco-doc-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .abaco-doc-card .abaco-doc-meta {
          color: var(--abaco-fg-2);
          font-family: var(--abaco-font-mono);
          font-size: var(--abaco-fs-xs);
          flex: none;
        }
        .abaco-doc-card .abaco-doc-remove {
          background: transparent;
          border: none;
          color: var(--abaco-fg-2);
          cursor: pointer;
          font-size: 16px;
          padding: 0 4px;
          border-radius: var(--abaco-radius-sm);
          flex: none;
        }
        .abaco-doc-card .abaco-doc-remove:hover { color: var(--abaco-danger); }
        .abaco-doc-card.abaco-doc-error { border-color: var(--abaco-danger); color: var(--abaco-danger); }
        .abaco-doc-card.abaco-doc-loading { opacity: 0.7; }
        @keyframes abaco-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .abaco-doc-upload-btn {
          width: 32px; height: 32px;
          border-radius: var(--abaco-radius);
          background: var(--abaco-bg-2);
          border: 1px solid var(--abaco-border);
          color: var(--abaco-fg-1);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          transition: all var(--abaco-dur-hover) var(--abaco-ease-out);
        }
        .abaco-doc-upload-btn:hover {
          background: var(--abaco-bg-3);
          color: var(--abaco-fg-0);
          border-color: var(--abaco-border-strong);
        }
        .abaco-doc-upload-btn.abaco-doc-busy {
          pointer-events: none;
          opacity: 0.6;
        }
      `
      document.head.appendChild(s)
    }

    // ── State store (per-conversation documents) ────────────────────────

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

    // ── Upload button ───────────────────────────────────────────────────

    function UploadButton({ store, onUploadStart }) {
      const inputRef = React.useRef(null)
      const [busy, setBusy] = React.useState(false)

      const onPick = async (e) => {
        const files = Array.from(e.target.files || [])
        e.target.value = '' // allow re-pick of same file
        if (!files.length) return
        setBusy(true)
        onUploadStart?.(files.length)
        for (const file of files) {
          const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          store.add({
            id, name: file.name, size: file.size, type: file.type,
            status: 'extracting',
          })
          try {
            const { text, meta } = await extract(file)
            store.remove(id) // remove the loading one
            store.add({
              id, name: file.name, size: file.size, type: file.type,
              status: 'ready', text, meta,
            })
          } catch (err) {
            store.remove(id)
            store.add({
              id, name: file.name, size: file.size, type: file.type,
              status: 'error', error: err.message,
            })
          }
        }
        setBusy(false)
      }

      return React.createElement(
        React.Fragment, null,
        React.createElement('button', {
          type: 'button',
          'aria-label': 'Subir documento',
          title: `Subir documento (${supportedTypes().map((t) => t.label).join(', ')})`,
          className: `abaco-doc-upload-btn${busy ? ' abaco-doc-busy' : ''}`,
          onClick: () => inputRef.current?.click(),
        }, busy ? '…' : '📎'),
        React.createElement('input', {
          ref: inputRef,
          type: 'file',
          multiple: true,
          accept: acceptString(),
          onChange,
          style: { display: 'none' },
        }),
      )
    }

    // ── Preview card ────────────────────────────────────────────────────

    function DocCard({ doc, onRemove }) {
      const isError = doc.status === 'error'
      const isLoading = doc.status === 'extracting'
      const sizeStr = formatBytes(doc.size)
      return React.createElement(
        'div',
        {
          className: `abaco-doc-card${isError ? ' abaco-doc-error' : ''}${isLoading ? ' abaco-doc-loading' : ''}`,
          title: isError ? doc.error : (doc.text ? `${doc.text.length} caracteres extraídos` : ''),
        },
        React.createElement('span', { className: 'abaco-doc-icon' },
          isError ? '⚠' : isLoading ? '⏳' : iconForType(doc.name),
        ),
        React.createElement('span', { className: 'abaco-doc-name' }, doc.name),
        React.createElement('span', { className: 'abaco-doc-meta' },
          isLoading ? 'extrayendo…' : isError ? 'error' : sizeStr,
        ),
        React.createElement('button', {
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

    // ── Documents row (renders above composer) ──────────────────────────

    function DocumentsRow({ store, input }) {
      const [docs, setDocs] = React.useState(store.get())

      React.useEffect(() => store.subscribe(setDocs), [store])

      const onRemove = (id) => store.remove(id)

      if (!docs.length) return null

      return React.createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', padding: '4px 12px 0' } },
        ...docs.map((d) =>
          React.createElement(DocCard, { key: d.id, doc: d, onRemove }),
        ),
      )
    }

    // ── Intercept submit to inject document text ────────────────────────

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
      return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    // ── Wire up ─────────────────────────────────────────────────────────

    function apply(ctx) {
      injectStyle()
      const store = createStore()

      // Attach to ctx so other plugins can read it
      ctx.abaco = ctx.abaco || {}
      ctx.abaco.documents = store

      // Inject upload button into composer accessory
      ctx.slots.inject('conversation.input.attachments', () =>
        ctx.slots.register(
          { name: 'conversation.input.attachments' },
          function AbacoUploadButton() {
            return React.createElement(UploadButton, { store, onUploadStart: () => {} })
          },
        ),
      )

      // Render the documents row above the composer
      ctx.slots.inject('conversation.composer', () =>
        ctx.slots.register(
          { name: 'conversation.composer', order: -1 },
          function AbacoDocumentsRow(props) {
            return React.createElement(DocumentsRow, { store, input: props?.input })
          },
        ),
      )

      // Hook message send — append document context. We listen to the
      // conversation's send event if the seam exposes one; otherwise we
      // monkey-patch the input's submit value at insertion time.
      ctx.slots.inject('conversation.submit', () =>
        ctx.slots.register(
          { name: 'conversation.submit' },
          function AbacoDocsAugment(next) {
            return async function augmentedSubmit(payload) {
              const docs = store.get()
              const ctx2 = buildContextText(docs)
              const augmented = payload && typeof payload === 'object'
                ? { ...payload, content: (payload.content || '') + ctx2 }
                : (typeof payload === 'string' ? payload + ctx2 : payload)
              const result = await next(augmented)
              store.clear()
              return result
            }
          },
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})