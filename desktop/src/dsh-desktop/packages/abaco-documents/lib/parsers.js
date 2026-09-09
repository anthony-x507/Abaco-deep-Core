/**
 * Client-side document text extractors.
 *
 * Each function returns { text, meta } where meta has pageCount, wordCount,
 * charCount, and extractor-specific fields. Errors throw with a user-friendly
 * message — the UI catches them and shows a non-blocking toast.
 *
 * Supported: application/pdf, docx (via mammoth), text/* (txt, md, csv).
 *
 * Hard limits:
 *   - Max 50 MB per file
 *   - Max 200 pages for PDFs
 *   - Max 1M characters extracted (truncate with warning if exceeded)
 */

const MAX_BYTES = 50 * 1024 * 1024
const MAX_PAGES = 200
const MAX_CHARS = 1_000_000

let pdfjsPromise = null

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // pdfjs-dist exposes its main entry; the legacy build works in browser
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
      // worker
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })()
  }
  return pdfjsPromise
}

async function loadMammoth() {
  return import('mammoth/mammoth.browser.js')
}

function checkSize(file) {
  if (file.size > MAX_BYTES) {
    throw new Error(`Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo permitido: ${MAX_BYTES / 1024 / 1024} MB.`)
  }
}

export async function extract(file) {
  checkSize(file)
  const name = file.name
  const lower = name.toLowerCase()
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) return extractPdf(file)
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx')) return extractDocx(file)
  if (
    file.type.startsWith('text/') ||
    lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.markdown') ||
    lower.endsWith('.csv') || lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml') ||
    lower.endsWith('.xml')
  ) return extractText(file)
  throw new Error(`Tipo de archivo no soportado: ${file.type || name}. Aceptados: PDF, DOCX, TXT, MD, CSV, JSON, YAML, XML.`)
}

async function extractPdf(file) {
  const pdfjs = await loadPdfjs()
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const totalPages = Math.min(doc.numPages, MAX_PAGES)
  const pageTexts = []
  for (let i = 1; i <= totalPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim()
    pageTexts.push(`\n\n[Page ${i}]\n${text}`)
  }
  let text = pageTexts.join('').trim()
  let truncated = false
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + '\n\n[… truncated at 1M chars …]'
    truncated = true
  }
  return {
    text,
    meta: { pageCount: doc.numPages, pagesExtracted: totalPages, charCount: text.length, truncated },
  }
}

async function extractDocx(file) {
  const mammoth = await loadMammoth()
  const buf = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  let text = result.value || ''
  let truncated = false
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + '\n\n[… truncated at 1M chars …]'
    truncated = true
  }
  const warnings = result.messages?.filter((m) => m.type === 'warning') || []
  return {
    text,
    meta: { charCount: text.length, truncated, warnings: warnings.map((w) => w.message) },
  }
}

async function extractText(file) {
  const text = await file.text()
  let truncated = false
  let out = text
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS) + '\n\n[… truncated at 1M chars …]'
    truncated = true
  }
  const wordCount = out.split(/\s+/).filter(Boolean).length
  return { text: out, meta: { charCount: out.length, wordCount, truncated } }
}

export function supportedTypes() {
  return [
    { ext: '.pdf', mime: 'application/pdf', label: 'PDF' },
    { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'DOCX' },
    { ext: '.txt', mime: 'text/plain', label: 'TXT' },
    { ext: '.md', mime: 'text/markdown', label: 'Markdown' },
    { ext: '.csv', mime: 'text/csv', label: 'CSV' },
    { ext: '.json', mime: 'application/json', label: 'JSON' },
    { ext: '.yaml', mime: 'text/yaml', label: 'YAML' },
  ]
}

export function acceptString() {
  return '.pdf,.docx,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv'
}