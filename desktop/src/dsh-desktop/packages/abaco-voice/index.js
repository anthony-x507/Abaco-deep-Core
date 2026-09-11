/**
 * Host half for abaco-voice — local Whisper STT (mlx_whisper / whisper CLI).
 *
 * Renderer records with MediaRecorder, POSTs bytes to
 * `/api/abaco-voice.local-transcribe`. The Harness Node process converts
 * (ffmpeg) and runs on-device Whisper. No OpenAI key. No Cordis ctx.store.
 *
 * @module abaco-voice
 */

export const name = 'abaco-voice'

export const inject = ['connection']

export const LOCAL_TRANSCRIBE_PATH = '/api/abaco-voice.local-transcribe'
export const LOCAL_STATUS_PATH = '/api/abaco-voice.local-status'

const MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_MODEL = 'mlx-community/whisper-tiny'

function failure(message, status = 422) {
  return Response.json({ ok: false, error: message }, { status })
}

function installHint() {
  return (
    'Whisper local no está instalado (o no está en PATH). En Mac Apple Silicon: ' +
    '`pipx install mlx-whisper` o `pip install mlx-whisper`, y asegúrate de ' +
    'tener `ffmpeg` (`brew install ffmpeg`). Reinicia ABACO DEEP HARNES. ' +
    'No uses clave OpenAI para este modo.'
  )
}

/** Extra dirs packaged Electron often omits from PATH. */
function candidateBinDirs() {
  const home = process.env.HOME || ''
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    home ? `${home}/.local/bin` : '',
    home ? `${home}/Library/Python/3.14/bin` : '',
    home ? `${home}/Library/Python/3.13/bin` : '',
    home ? `${home}/Library/Python/3.12/bin` : '',
  ].filter(Boolean)
}

async function pathExists(p) {
  try {
    const { access } = await import('node:fs/promises')
    const { constants } = await import('node:fs')
    await access(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveBinary(names) {
  const { join } = await import('node:path')
  const pathEnv = String(process.env.PATH || '')
  const dirs = [...pathEnv.split(':').filter(Boolean), ...candidateBinDirs()]
  const seen = new Set()
  for (const dir of dirs) {
    if (seen.has(dir)) continue
    seen.add(dir)
    for (const name of names) {
      const full = join(dir, name)
      if (await pathExists(full)) return full
    }
  }
  return null
}

/** Exported for unit tests. */
export async function resolveLocalWhisperTools() {
  const mlx = await resolveBinary(['mlx_whisper'])
  const openaiWhisper = mlx ? null : await resolveBinary(['whisper'])
  const ffmpeg = await resolveBinary(['ffmpeg'])
  const engine = mlx ? 'mlx_whisper' : (openaiWhisper ? 'whisper' : null)
  const bin = mlx || openaiWhisper || null
  return { engine, bin, ffmpeg, available: !!(bin && ffmpeg) }
}

function run(cmd, args, opts = {}) {
  return new Promise(async (resolve, reject) => {
    const { spawn } = await import('node:child_process')
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':'),
        // HuggingFace / mlx caches stay in the user home.
        HOME: process.env.HOME,
      },
      ...opts,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += String(c) })
    child.stderr.on('data', (c) => { stderr += String(c) })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

async function convertToWav(ffmpegBin, inputPath, wavPath) {
  const result = await run(ffmpegBin, [
    '-y', '-i', inputPath,
    '-ar', '16000', '-ac', '1',
    '-c:a', 'pcm_s16le',
    wavPath,
  ])
  if (result.code !== 0) {
    throw new Error(
      `ffmpeg no pudo convertir el audio: ${(result.stderr || result.stdout || '').trim().slice(0, 400) || 'sin detalle'}`,
    )
  }
}

async function transcribeLocal({ engine, bin, ffmpeg }, bytes, filename, opts) {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const dir = await mkdtemp(join(tmpdir(), 'abaco-voice-'))
  const ext = (filename || '').toLowerCase().endsWith('.wav') ? '.wav' : '.webm'
  const inputPath = join(dir, `in${ext}`)
  const wavPath = join(dir, 'audio.wav')
  const outDir = join(dir, 'out')
  try {
    await writeFile(inputPath, Buffer.from(bytes))
    const { mkdir } = await import('node:fs/promises')
    await mkdir(outDir, { recursive: true })

    let audioPath = inputPath
    if (ext !== '.wav') {
      await convertToWav(ffmpeg, inputPath, wavPath)
      audioPath = wavPath
    }

    const model = (opts && opts.model) || DEFAULT_MODEL
    const language = (opts && opts.language) || 'es'
    const args = engine === 'mlx_whisper'
      ? [
          audioPath,
          '--model', model,
          '--language', language,
          '--output-dir', outDir,
          '--output-name', 'transcript',
          '--output-format', 'txt',
          '--verbose', 'False',
        ]
      : [
          audioPath,
          '--model', model.includes('/') ? 'tiny' : model,
          '--language', language,
          '--output_dir', outDir,
          '--output_format', 'txt',
          '--verbose', 'False',
        ]

    const result = await run(bin, args)
    if (result.code !== 0) {
      throw new Error(
        `Whisper local falló (${engine}): ${(result.stderr || result.stdout || '').trim().slice(0, 500) || 'sin detalle'}`,
      )
    }

    let text = ''
    try {
      text = (await readFile(join(outDir, 'transcript.txt'), 'utf8')).trim()
    } catch {
      // openai-whisper names output after input stem
      try {
        const { readdir } = await import('node:fs/promises')
        const files = (await readdir(outDir)).filter((f) => f.endsWith('.txt'))
        if (files[0]) text = (await readFile(join(outDir, files[0]), 'utf8')).trim()
      } catch {}
    }
    return {
      text,
      meta: { engine, model, language, offline: true },
    }
  } finally {
    try { await rm(dir, { recursive: true, force: true }) } catch {}
  }
}

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
      const tools = await resolveLocalWhisperTools()
      return Response.json({
        ok: true,
        available: tools.available,
        engine: tools.engine,
        hasFfmpeg: !!tools.ffmpeg,
        hasWhisper: !!tools.bin,
        hint: tools.available ? null : installHint(),
      }, { headers: { 'cache-control': 'no-store' } })
    },
  })

  connection.fetch.register({
    path: LOCAL_TRANSCRIBE_PATH,
    methods: ['POST'],
    fetch: async (request) => {
      const tools = await resolveLocalWhisperTools()
      if (!tools.available) {
        return failure(installHint(), 503)
      }

      const url = new URL(request.url)
      const filename = url.searchParams.get('filename') || 'audio.webm'
      const model = url.searchParams.get('model') || DEFAULT_MODEL
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

      try {
        const result = await transcribeLocal(tools, bytes, filename, { model, language })
        return Response.json({
          ok: true,
          text: result.text,
          meta: result.meta,
        }, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'Whisper local falló.', 422)
      }
    },
  })
}
