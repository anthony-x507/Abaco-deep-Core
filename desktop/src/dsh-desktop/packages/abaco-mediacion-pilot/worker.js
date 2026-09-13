/**
 * Mediation worker cell — runs only {op,args,grantId} already authorized.
 * NEVER calls broker.grant. Cero Atena (asesor).
 */
import { resolveLocalWhisperTools, transcribeLocal } from './ops.js'

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'bad message' }
  if (!msg.grantId) return { ok: false, error: 'missing grantId — worker refuses unmediated work' }
  if (msg.op === 'local-transcribe') {
    const tools = await resolveLocalWhisperTools()
    if (!tools.available) {
      return { ok: false, error: 'Whisper local no disponible (mlx_whisper/ffmpeg).' }
    }
    const bytes = Buffer.from(msg.args.bytesBase64 || '', 'base64')
    const result = await transcribeLocal(tools, bytes, msg.args.filename || 'audio.webm', {
      model: msg.args.model,
      language: msg.args.language,
    })
    return { ok: true, text: result.text, meta: { ...result.meta, grantId: msg.grantId } }
  }
  if (msg.op === 'status') {
    const tools = await resolveLocalWhisperTools()
    return { ok: true, available: tools.available, engine: tools.engine }
  }
  return { ok: false, error: `unknown op ${msg.op}` }
}

process.on('message', async (msg) => {
  try {
    const result = await handle(msg)
    process.send && process.send({ id: msg.id, ...result })
  } catch (e) {
    process.send && process.send({
      id: msg && msg.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })
  }
})

process.send && process.send({ ok: true, ready: true })
