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
const DEFAULT_MODEL = 'mlx-community/whisper-tiny'

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
    const model = (opts && opts.model) || DEFAULT_MODEL
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
    if (result.code !== 0) {
      throw new Error(
        `Whisper local falló (${tools.engine}): ${(result.stderr || result.stdout || '').trim().slice(0, 500) || 'sin detalle'}`,
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
    return { text, meta: { engine: tools.engine, model, language, offline: true, mediated: true } }
  } finally {
    try { await rm(dir, { recursive: true, force: true }) } catch {}
  }
}
