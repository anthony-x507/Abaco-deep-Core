/**
 * Host half for abaco-documents.
 *
 * The renderer cannot resolve `pdfjs-dist` / `mammoth` through the web
 * module table (the client module system only seeds `react` / `@deepseek-ai/*`
 * ids), so document parsing lives HERE, in the Harness Node process, behind an
 * exact Fetch route registered on the `connection` seam — the same public
 * registry upstream's own `/api/session.export` uses (see
 * `dsh-desktop-preset-transfer/index.js` for the reference implementation).
 *
 * The browser client uploads the raw file bytes (`POST /api/abaco-documents.extract`)
 * and receives `{ ok, text, meta }` (or a structured error) in return.
 *
 * PDF text extraction uses pdfjs-dist running with its in-Node "fake worker"
 * fallback; DOCX uses mammoth. Both are imported lazily per request so a
 * missing optional dependency degrades to a per-file error instead of a boot
 * failure.
 *
 * @module abaco-documents
 */

/** Stable Cordis plugin name. */
export const name = 'abaco-documents'

/** The API channel this plugin publishes onto. */
export const inject = ['connection']

export const EXTRACT_PATH = '/api/abaco-documents.extract'

/** Hard limits, mirrored from the original renderer-side extractor. */
const MAX_BYTES = 50 * 1024 * 1024
const MAX_PAGES = 200
const MAX_CHARS = 1_000_000

const TEXT_LIKE_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.xml',
])

function failure(message, status = 422) {
  return Response.json({ ok: false, error: message }, { status })
}

function extnameOf(filePath) {
  const base = (filePath || '').split(/[\\/]/).pop() ?? ''
  const idx = base.lastIndexOf('.')
  return idx <= 0 ? '' : base.slice(idx).toLowerCase()
}

/** Classify the request into 'pdf' | 'docx' | 'text' | null by header, then name. */
function classify(contentType, name) {
  if (contentType === 'application/pdf') return 'pdf'
  if (contentType.includes('openxmlformats-officedocument.wordprocessingml')) return 'docx'
  if (contentType.startsWith('text/')) return 'text'
  const ext = extnameOf(name)
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (TEXT_LIKE_EXTENSIONS.has(ext)) return 'text'
  return null
}

/** Truncate extracted prose to the shared ceiling, reporting the truncation. */
function clampText(text, truncatedMarker = '\n\n[… truncated at 1M chars …]') {
  let truncated = false
  let out = text || ''
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS) + truncatedMarker
    truncated = true
  }
  const wordCount = out.split(/\s+/).filter(Boolean).length
  return { text: out, charCount: out.length, wordCount, truncated }
}

async function extractPdf(bytes) {
  let pdfjs
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  } catch (cause) {
    throw new Error('La extracción PDF no está disponible en esta build (pdfjs-dist no cargó): ' + (cause instanceof Error ? cause.message : String(cause)))
  }
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  try {
    const totalPages = Math.min(doc.numPages, MAX_PAGES)
    const pageTexts = []
    for (let i = 1; i <= totalPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const text = content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim()
      if (text) pageTexts.push(`\n\n[Page ${i}]\n${text}`)
    }
    const clamped = clampText(pageTexts.join('').trim())
    return {
      text: clamped.text,
      meta: {
        pageCount: doc.numPages,
        pagesExtracted: totalPages,
        charCount: clamped.charCount,
        wordCount: clamped.wordCount,
        truncated: clamped.truncated,
      },
    }
  } finally {
    try { await doc.destroy() } catch {}
  }
}

async function extractDocx(bytes) {
  let mammoth
  try {
    const mod = await import('mammoth')
    mammoth = mod.default ?? mod
  } catch (cause) {
    throw new Error('La extracción DOCX no está disponible en esta build (mammoth no cargó): ' + (cause instanceof Error ? cause.message : String(cause)))
  }
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  const clamped = clampText(result.value)
  const warnings = (result.messages || []).filter((m) => m.type === 'warning').map((w) => w.message)
  return {
    text: clamped.text,
    meta: {
      charCount: clamped.charCount,
      wordCount: clamped.wordCount,
      truncated: clamped.truncated,
      warnings,
    },
  }
}

async function extractText(bytes) {
  const decoder = new TextDecoder('utf-8')
  const clamped = clampText(decoder.decode(bytes))
  return {
    text: clamped.text,
    meta: { charCount: clamped.charCount, wordCount: clamped.wordCount, truncated: clamped.truncated },
  }
}

/**
 * Register the extraction route on the shared API channel.
 *
 * @param ctx - Host context carrying the connection service.
 */
export function apply(ctx) {
  const connection = Reflect.get(ctx, 'connection')
  if (connection?.fetch?.register === void 0) {
    throw new Error('abaco-documents: connection.fetch registry is unavailable — cannot publish the extraction route')
  }

  connection.fetch.register({
    path: EXTRACT_PATH,
    methods: ['POST'],
    fetch: async (request) => {
      const url = new URL(request.url)
      const filename = url.searchParams.get('filename') ?? ''

      const contentLength = Number(request.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
        return failure(`Archivo demasiado grande (máximo permitido: ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`, 413)
      }

      let bytes
      try {
        bytes = new Uint8Array(await request.arrayBuffer())
      } catch {
        return failure('No se pudo leer el cuerpo del archivo.')
      }
      if (bytes.length === 0) return failure('El archivo está vacío.')
      if (bytes.length > MAX_BYTES) {
        return failure(`Archivo demasiado grande (máximo permitido: ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`, 413)
      }

      const contentType = (request.headers.get('content-type') || '').split(';', 1)[0]?.trim().toLowerCase()
      const kind = classify(contentType, filename)
      if (kind === null) {
        return failure(
          `Tipo de archivo no soportado${filename ? `: ${filename}` : ''}. Aceptados: PDF, DOCX, TXT, MD, CSV, JSON, YAML, XML.`,
          415,
        )
      }

      try {
        const extracted =
          kind === 'pdf' ? await extractPdf(bytes)
          : kind === 'docx' ? await extractDocx(bytes)
          : await extractText(bytes)
        return Response.json({
          ok: true,
          name: filename,
          text: extracted.text,
          meta: extracted.meta,
        }, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'La extracción falló por un error desconocido.', 422)
      }
    },
  })
}
