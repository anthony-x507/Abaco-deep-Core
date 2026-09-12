/**
 * Pure local-whisper ops used by the mediation worker.
 * No broker.grant here — executor only.
 */
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs'
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const accessAsync = promisify(access)
const DEFAULT_MODEL = 'mlx-community/whisper-small-mlx'

function candidateBinDirs() {
  const home = process.env.HOME || ''
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    home ? `${home}/.local/bin` : '',
  ].filter(Boolean)
}

async function pathExists(p) {
  try {
    await accessAsync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveBinary(names) {
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

export async function resolveLocalWhisperTools() {
  const mlx = await resolveBinary(['mlx_whisper'])
  const openaiWhisper = mlx ? null : await resolveBinary(['whisper'])
  const ffmpeg = await resolveBinary(['ffmpeg'])
  const engine = mlx ? 'mlx_whisper' : (openaiWhisper ? 'whisper' : null)
  const bin = mlx || openaiWhisper || null
  return { engine, bin, ffmpeg, available: !!(bin && ffmpeg) }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':'),
        HOME: process.env.HOME,
        // Q2/T7: never download models at transcribe time.
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += String(c) })
    child.stderr.on('data', (c) => { stderr += String(c) })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
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

export async function transcribeLocal(tools, bytes, filename, opts) {
  const dir = await mkdtemp(join(tmpdir(), 'abaco-voice-'))
  const ext = (filename || '').toLowerCase().endsWith('.wav') ? '.wav' : '.webm'
  const inputPath = join(dir, `in${ext}`)
  const wavPath = join(dir, 'audio.wav')
  const outDir = join(dir, 'out')
  try {
    await writeFile(inputPath, Buffer.from(bytes))
    await mkdir(outDir, { recursive: true })
    let audioPath = inputPath
    if (ext !== '.wav') {
      await convertToWav(tools.ffmpeg, inputPath, wavPath)
      audioPath = wavPath
    }
    // Exact BAD plain ids → *-mlx. NEVER includes('whisper-base') (kills base-mlx).
    // 0.4.7 belt+suspenders: sticky tiny → small-mlx before spawn.
    const STICKY_TINY = [
      'mlx-community/whisper-tiny',
      'mlx-community/whisper-tiny-mlx',
      'whisper-tiny',
    ]
    const BAD_MODEL_MAP = {
      'mlx-community/whisper-base': 'mlx-community/whisper-base-mlx',
      'whisper-base': 'mlx-community/whisper-base-mlx',
      'mlx-community/whisper-small': 'mlx-community/whisper-small-mlx',
      'whisper-small': 'mlx-community/whisper-small-mlx',
    }
    let model = (opts && opts.model) || DEFAULT_MODEL
    if (!model) model = DEFAULT_MODEL
    else if (STICKY_TINY.includes(model)) model = DEFAULT_MODEL
    else if (Object.prototype.hasOwnProperty.call(BAD_MODEL_MAP, model)) model = BAD_MODEL_MAP[model]
    const language = (opts && opts.language) || 'es'
    const args = tools.engine === 'mlx_whisper'
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
    const result = await run(tools.bin, args)
    const errBlob = `${result.stderr || ''}\n${result.stdout || ''}`
    const repoMissing = /Repository Not Found|RepositoryNotFound|404 Client Error|Skipping/i.test(errBlob)
    if (result.code !== 0 || repoMissing) {
      throw new Error(
        `Whisper local falló (${tools.engine}, modelo=${model}): ` +
        `${errBlob.trim().slice(0, 500) || (repoMissing ? 'repositorio/modelo no encontrado' : 'sin detalle')}. ` +
        'Usa whisper-small-mlx / base-mlx / tiny-mlx / tiny (cache local). No es API key.',
      )
    }
    let text = ''
    try {
      text = (await readFile(join(outDir, 'transcript.txt'), 'utf8')).trim()
    } catch {
      try {
        const files = (await readdir(outDir)).filter((f) => f.endsWith('.txt'))
        if (files[0]) text = (await readFile(join(outDir, files[0]), 'utf8')).trim()
      } catch {}
    }
    // Root cause: plain whisper-base can exit 0 with empty transcript.txt
    if (!text) {
      throw new Error(
        `Whisper local devolvió transcripción vacía (${tools.engine}, modelo=${model}, idioma=${language}). ` +
        'Habla más cerca del micrófono, o usa un modelo *-mlx en cache local. ' +
        'No es un problema de API key (modo local).',
      )
    }
    return { text, meta: { engine: tools.engine, model, language, offline: true, mediated: true } }
  } finally {
    try { await rm(dir, { recursive: true, force: true }) } catch {}
  }
}
