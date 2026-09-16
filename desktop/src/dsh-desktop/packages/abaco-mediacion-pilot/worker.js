/**
 * Mediation worker cell — runs only {op,args,grantId} already authorized.
 * NEVER issues grants. Cero Atena (asesor). No environmental authority.
 */
import { resolveLocalWhisperTools, transcribeLocal } from './ops.js'

export const IPC_FIELDS = Object.freeze(['id', 'op', 'args', 'grantId'])

/** Drop extra keys so forged plugin_id / trust / authorize flags cannot ride IPC. */
export function sanitizeInbound(msg) {
  if (!msg || typeof msg !== 'object') return null
  return {
    id: msg.id,
    op: msg.op,
    args: msg.args && typeof msg.args === 'object' ? msg.args : {},
    grantId: msg.grantId,
  }
}

export async function handleMessage(msg) {
  const inbound = sanitizeInbound(msg)
  if (!inbound) return { ok: false, error: 'bad message' }
  if (!inbound.grantId) {
    return { ok: false, error: 'missing grantId — worker refuses unmediated work' }
  }
  if (inbound.op === 'local-transcribe') {
    const tools = await resolveLocalWhisperTools()
    if (!tools.available) {
      return { ok: false, error: 'Whisper local no disponible (mlx_whisper/ffmpeg).' }
    }
    const bytes = Buffer.from(inbound.args.bytesBase64 || '', 'base64')
    const result = await transcribeLocal(tools, bytes, inbound.args.filename || 'audio.webm', {
      model: inbound.args.model,
      language: inbound.args.language,
    })
    return { ok: true, text: result.text, meta: { ...result.meta, grantId: inbound.grantId } }
  }
  if (inbound.op === 'status') {
    const tools = await resolveLocalWhisperTools()
    return { ok: true, available: tools.available, engine: tools.engine }
  }
  return { ok: false, error: `unknown op ${inbound.op}` }
}

const isCellWorker = typeof process.send === 'function'
if (isCellWorker) {
  process.on('message', async (msg) => {
    try {
      const result = await handleMessage(msg)
      process.send({ id: msg && msg.id, ...result })
    } catch (e) {
      process.send({
        id: msg && msg.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  })
  process.send({ ok: true, ready: true })
}
