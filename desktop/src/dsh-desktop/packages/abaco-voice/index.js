/**
 * Host half for abaco-voice — local Whisper STT mediated by F1 broker.
 *
 * F2.1-C: product STT is Mac-only local Whisper. Linux §15/16 is a
 * fail-closed hint, not a stack and not a silent OpenAI fallback.
 *
 * Renderer records with MediaRecorder, POSTs bytes to
 * `/api/abaco-voice.local-transcribe`. This fiber OWNS the routes (identity).
 * Before any proc.spawn, authorize() must allow; execution goes to
 * abaco-mediacion-pilot strangler cell. Direct spawn here = LEGACY_UNMEDIATED.
 * Cell crash/timeout/deny → fail-closed hint (no silent OpenAI/cloud fallback).
 * Janice = runtime; cero Atena (asesor) en authorize.
 *
 * @module abaco-voice
 */

import {
  authorize,
  hashArgs,
  markLegacyUnmediated,
} from '../abaco-effect-broker/index.js'
import { executeAuthorized, failClosedHint } from '../abaco-mediacion-pilot/index.js'
import { resolveLocalWhisperTools } from '../abaco-mediacion-pilot/ops.js'
import {
  DEFAULT_LOCAL_MODEL,
  listCachedLocalWhisperModels,
  pickCachedModel,
  resolveLocalWhisperModel,
} from './lib/normalize-config.js'
import {
  LINUX_STT_HINT_15_16,
  denySilentCloudSttFallback,
  isMacLocalSttPlatform,
  macLocalSttAdmission,
  sttPlatformHint,
} from './lib/stt-mac-contract.js'

export const name = 'abaco-voice'

export const inject = ['connection']

export const LOCAL_TRANSCRIBE_PATH = '/api/abaco-voice.local-transcribe'
export const LOCAL_STATUS_PATH = '/api/abaco-voice.local-status'

export {
  LINUX_STT_HINT_15_16,
  denySilentCloudSttFallback,
  isMacLocalSttPlatform,
  macLocalSttAdmission,
  sttPlatformHint,
}

const MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_MODEL = DEFAULT_LOCAL_MODEL

function failure(message, status = 422) {
  return Response.json({ ok: false, error: message }, { status })
}

function toolsMissingMessage() {
  return failClosedHint(
    'Whisper local no disponible (binario o ffmpeg ausente, o sin modelos en cache HF). ' +
    'No es un problema de API key (modo local).',
  )
}

/** Re-export for tests that still probe tools without spawn. */
export { resolveLocalWhisperTools }

function warnApply(ctx, message) {
  try {
    ctx?.logger?.warn?.(`abaco-voice: ${message}`)
  } catch {
    /* a logger that throws must not fail boot */
  }
}

/**
 * Host apply. Missing `connection.fetch` (or a later register failure) degrades
 * to a warning and skips local STT routes — it must not throw into Cordis and
 * take the plugin tree to Startup recovery / Safe Mode.
 *
 * @param {any} ctx
 */
export function apply(ctx) {
  try {
    startVoice(ctx)
  } catch (error) {
    warnApply(
      ctx,
      `failed to start; local STT routes are off: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * @param {any} ctx
 */
function startVoice(ctx) {
  const connection = ctx == null ? undefined : Reflect.get(ctx, 'connection')
  if (connection?.fetch?.register === void 0) {
    warnApply(ctx, 'connection.fetch registry is unavailable — local STT routes skipped')
    return
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
      // F2.1-C: darwin keeps hint: null; non-Mac surfaces §15/16 fail-closed.
      const admission = macLocalSttAdmission(process.platform)
      const hint = sttPlatformHint(process.platform)
      return Response.json({
        ok: true,
        available: admission.ok && tools.available && !!picked_model,
        engine: tools.engine,
        hasFfmpeg: !!tools.ffmpeg,
        hasWhisper: !!tools.bin,
        cached_models,
        picked_model,
        hint,
        mediated: true,
        grant_id: decision.grant.grant_id,
        mac_only: true,
      }, { headers: { 'cache-control': 'no-store' } })
    },
  })

  connection.fetch.register({
    path: LOCAL_TRANSCRIBE_PATH,
    methods: ['POST'],
    fetch: async (request) => {
      // F2.1-C: non-Mac transcribe is fail-closed (no spawn, no cloud).
      const admission = macLocalSttAdmission(process.platform)
      if (!admission.ok) {
        return failure(admission.error || LINUX_STT_HINT_15_16, 503)
      }

      const url = new URL(request.url)
      const filename = url.searchParams.get('filename') || 'audio.webm'
      // 0.4.7 FORCE: sticky tiny -> small-mlx before authorize (args_hash = small-mlx).
      let model = resolveLocalWhisperModel(url.searchParams.get('model') || DEFAULT_MODEL)
      const cached = await listCachedLocalWhisperModels()
      const picked = pickCachedModel(cached)
      if (picked && !cached.includes(model)) model = picked
      // Re-resolve: sticky tiny never reaches authorize hashArgs (FORCE).
      model = resolveLocalWhisperModel(model)
      if (!picked) {
        return failure(
          failClosedHint(
            'Whisper local: no hay modelos en cache HF (small-mlx/base-mlx/tiny-mlx/tiny). No es API key.',
          ),
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
        return failure(failClosedHint(`mediación deny: ${fetchDecision.reason}`), 403)
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
        return failure(failClosedHint(`mediación deny spawn: ${spawnDecision.reason}`), 403)
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
        return failure(failClosedHint(`mediación deny ffmpeg: ${ffmpegDecision.reason}`), 403)
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
        return failure(failClosedHint(error instanceof Error ? error.message : 'Whisper local falló.'), 422)
      }
    },
  })
}

/** Test-only: prove direct spawn path is marked unmediated if ever called. */
export function __dangerLegacySpawnProbe() {
  markLegacyUnmediated()
  return 'LEGACY_UNMEDIATED'
}
