/**
 * Host half for abaco-voice — local Whisper STT mediated by F1 broker.
 *
 * Renderer records with MediaRecorder, POSTs bytes to
 * `/api/abaco-voice.local-transcribe`. This fiber OWNS the routes (identity).
 * Before any proc.spawn, authorize() must allow; execution goes to
 * abaco-mediacion-pilot worker cell. Direct spawn here = LEGACY_UNMEDIATED.
 * Janice = runtime; cero Atena (asesor) en authorize.
 *
 * @module abaco-voice
 */

import {
  authorize,
  hashArgs,
  markLegacyUnmediated,
} from 'abaco-effect-broker'
import { executeAuthorized } from 'abaco-mediacion-pilot'
import { resolveLocalWhisperTools } from 'abaco-mediacion-pilot/ops'
import {
  DEFAULT_LOCAL_MODEL,
  listCachedLocalWhisperModels,
  pickCachedModel,
  resolveLocalWhisperModel,
} from './lib/normalize-config.js'

export const name = 'abaco-voice'

export const inject = ['connection']

export const LOCAL_TRANSCRIBE_PATH = '/api/abaco-voice.local-transcribe'
export const LOCAL_STATUS_PATH = '/api/abaco-voice.local-status'

const MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_MODEL = DEFAULT_LOCAL_MODEL

function failure(message, status = 422) {
  return Response.json({ ok: false, error: message }, { status })
}

function toolsMissingMessage() {
  return (
    'Whisper local no disponible (binario o ffmpeg ausente, o sin modelos en cache HF). ' +
    'No es un problema de API key (modo local).'
  )
}

/** Re-export for tests that still probe tools without spawn. */
export { resolveLocalWhisperTools }

/**
 * @param {any} ctx
 */
export function apply(ctx) {
  const connection = Reflect.get(ctx, 'connection')
  if (connection?.fetch?.register === void 0) {
    throw new Error('abaco-voice: connection.fetch registry is unavailable — cannot publish local STT routes')
  }

  connection.fetch.register({
    path: LOCAL_STATUS_PATH,
    methods: ['GET'],
    fetch: async () => {
      const decision = authorize({
        channel: { kind: 'host.fetch', path: LOCAL_STATUS_PATH },
        task_id: null,
        effect: {
          kind: 'host.fetch',
          resource: LOCAL_STATUS_PATH,
          args_hash: hashArgs({ method: 'GET' }),
        },
        trust_in: 'user',
      })
      if (decision.decision !== 'allow') {
        return Response.json({
          ok: false,
          available: false,
          error: decision.reason,
          mediated: true,
        }, { status: 403, headers: { 'cache-control': 'no-store' } })
      }
      const tools = await resolveLocalWhisperTools()
      const cached_models = await listCachedLocalWhisperModels()
      const picked_model = pickCachedModel(cached_models)
      return Response.json({
        ok: true,
        available: tools.available && !!picked_model,
        engine: tools.engine,
        hasFfmpeg: !!tools.ffmpeg,
        hasWhisper: !!tools.bin,
        cached_models,
        picked_model,
        hint: null,
        mediated: true,
        grant_id: decision.grant.grant_id,
      }, { headers: { 'cache-control': 'no-store' } })
    },
  })

  connection.fetch.register({
    path: LOCAL_TRANSCRIBE_PATH,
    methods: ['POST'],
    fetch: async (request) => {
      const url = new URL(request.url)
      const filename = url.searchParams.get('filename') || 'audio.webm'
      let model = resolveLocalWhisperModel(url.searchParams.get('model') || DEFAULT_MODEL)
      const cached = await listCachedLocalWhisperModels()
      const picked = pickCachedModel(cached)
      if (picked && !cached.includes(model)) model = picked
      if (!picked) {
        return failure(
          'Whisper local: no hay modelos en cache HF (small-mlx/base-mlx/tiny-mlx/tiny). No es API key.',
          503,
        )
      }
      const language = url.searchParams.get('language') || 'es'

      const contentLength = Number(request.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
        return failure(`Audio demasiado grande (máximo ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`, 413)
      }

      let bytes
      try {
        bytes = new Uint8Array(await request.arrayBuffer())
      } catch {
        return failure('No se pudo leer el audio.')
      }
      if (!bytes.length) return failure('Audio vacío.')
      if (bytes.length > MAX_BYTES) {
        return failure(`Audio demasiado grande (máximo ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`, 413)
      }

      // 1) Authorize host.fetch on the route (identity = abaco-voice via path).
      const fetchDecision = authorize({
        channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
        task_id: null,
        effect: {
          kind: 'host.fetch',
          resource: LOCAL_TRANSCRIBE_PATH,
          args_hash: hashArgs({ filename, model, language, n: bytes.length }),
        },
        trust_in: 'user',
      })
      if (fetchDecision.decision !== 'allow') {
        return failure(`mediación deny: ${fetchDecision.reason}`, 403)
      }

      // 2) Authorize proc.spawn BEFORE any child process (suite: direct spawn = red).
      const toolsProbe = await resolveLocalWhisperTools()
      if (!toolsProbe.available) {
        return failure(toolsMissingMessage(), 503)
      }
      const binResource = toolsProbe.engine === 'mlx_whisper' ? 'bin:mlx_whisper' : 'bin:whisper'
      const spawnDecision = authorize({
        channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
        task_id: fetchDecision.grant.task_id,
        grant_id: fetchDecision.grant.grant_id,
        effect: {
          kind: 'proc.spawn',
          resource: binResource,
          args_hash: hashArgs({ model, language }),
        },
        trust_in: 'user',
      })
      if (spawnDecision.decision !== 'allow') {
        return failure(`mediación deny spawn: ${spawnDecision.reason}`, 403)
      }

      // Also authorize ffmpeg spawn when conversion needed.
      const ffmpegDecision = authorize({
        channel: { kind: 'host.fetch', path: LOCAL_TRANSCRIBE_PATH },
        task_id: fetchDecision.grant.task_id,
        grant_id: fetchDecision.grant.grant_id,
        effect: {
          kind: 'proc.spawn',
          resource: 'bin:ffmpeg',
          args_hash: hashArgs({ convert: true }),
        },
        trust_in: 'user',
      })
      if (ffmpegDecision.decision !== 'allow') {
        return failure(`mediación deny ffmpeg: ${ffmpegDecision.reason}`, 403)
      }

      try {
        const result = await executeAuthorized({
          grantId: spawnDecision.grant.grant_id,
          op: 'local-transcribe',
          args: {
            bytesBase64: Buffer.from(bytes).toString('base64'),
            filename,
            model,
            language,
          },
          timeoutMs: 180_000,
        })
        return Response.json({
          ok: true,
          text: result.text || '',
          meta: {
            ...(result.meta || {}),
            mediated: true,
            grant_id: spawnDecision.grant.grant_id,
          },
        }, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'Whisper local falló.', 422)
      }
    },
  })
}

/** Test-only: prove direct spawn path is marked unmediated if ever called. */
export function __dangerLegacySpawnProbe() {
  markLegacyUnmediated()
  return 'LEGACY_UNMEDIATED'
}
