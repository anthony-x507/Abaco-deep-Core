/**
 * F2.1 Pack C · deterministic gates for the Mac-only STT contract.
 *
 * Run: node --test packages/abaco-voice/tests/stt-mac-contract.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLOUD_STT_PROVIDER_IDS,
  LINUX_STT_HINT_15_16,
  LOCAL_WHISPER_PROVIDER_ID,
  STT_PRODUCT_PLATFORM,
  denySilentCloudSttFallback,
  isMacLocalSttPlatform,
  isProductLocalWhisper,
  linuxSttDeferredHint,
  macLocalSttAdmission,
  sttPlatformHint,
} from '../lib/stt-mac-contract.js'
import {
  apply,
  LOCAL_STATUS_PATH,
  LOCAL_TRANSCRIBE_PATH,
} from '../index.js'
import { DISABLED_PLUGINS } from '../../abaco-effect-broker/index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const DSH_DIR = resolve(THIS_DIR, '../../..')
const REPO_ROOT = resolve(DSH_DIR, '../../..')

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function registerVoiceRoutes() {
  const registry = []
  apply({
    connection: {
      fetch: {
        register: (entry) => {
          registry.push(entry)
        },
      },
    },
  })
  return registry
}

test('G1 Mac-only: darwin admite; linux/win32 fail-closed con hint §15/16', () => {
  assert.equal(STT_PRODUCT_PLATFORM, 'darwin')
  assert.equal(isMacLocalSttPlatform('darwin'), true)
  assert.equal(isMacLocalSttPlatform('linux'), false)
  assert.equal(isMacLocalSttPlatform('win32'), false)
  assert.deepEqual(macLocalSttAdmission('darwin'), { ok: true, hint: null, error: null })
  assert.equal(sttPlatformHint('darwin'), null)
  const linux = macLocalSttAdmission('linux')
  assert.equal(linux.ok, false)
  assert.equal(linux.hint, LINUX_STT_HINT_15_16)
  assert.equal(linux.error, LINUX_STT_HINT_15_16)
  assert.equal(macLocalSttAdmission('win32').ok, false)
  assert.equal(isProductLocalWhisper(LOCAL_WHISPER_PROVIDER_ID), true)
  assert.equal(isProductLocalWhisper('openai-stt'), false)
})

test('G2 selected local-whisper + fallback openai/deepgram → silent-cloud-stt-fallback', () => {
  assert.deepEqual([...CLOUD_STT_PROVIDER_IDS], ['openai-stt', 'deepgram-stt', 'deepgram'])
  assert.deepEqual(denySilentCloudSttFallback('local-whisper-stt', 'openai-stt'), {
    deny: true,
    reason: 'silent-cloud-stt-fallback',
  })
  assert.equal(denySilentCloudSttFallback('local-whisper-stt', 'deepgram-stt').deny, true)
  assert.equal(denySilentCloudSttFallback('local-whisper-stt', 'local-whisper-stt').deny, false)
  assert.equal(denySilentCloudSttFallback('openai-stt', 'openai-stt').deny, false)
})

test('G3 hint §15/16 fail-closed: Whisper local / mlx-whisper; 0 OpenAI key; 0 pip/brew', () => {
  const hint = linuxSttDeferredHint()
  assert.equal(hint, LINUX_STT_HINT_15_16)
  assert.match(hint, /§15\/16/)
  assert.match(hint, /Whisper local|mlx-whisper|ffmpeg/i)
  assert.doesNotMatch(hint, /OpenAI API key required/i)
  assert.ok(!hint.includes('pipx'))
  assert.ok(!hint.includes('brew install'))
  assert.equal(sttPlatformHint('linux'), hint)
})

test('G4 host cablea admisión + authorize; worker exige grantId', async () => {
  const host = await readFile(resolve(PKG_DIR, 'index.js'), 'utf8')
  const worker = await readFile(resolve(PKG_DIR, '../abaco-mediacion-pilot/worker.js'), 'utf8')
  const broker = await readFile(resolve(PKG_DIR, '../abaco-effect-broker/index.js'), 'utf8')
  assert.ok(host.includes('macLocalSttAdmission'))
  assert.ok(host.includes('sttPlatformHint'))
  assert.ok(host.includes('authorize('))
  assert.ok(host.includes('executeAuthorized'))
  assert.ok(!/\bspawn\s*\(/.test(host))
  assert.ok(worker.includes('missing grantId'))
  assert.ok(worker.includes('NEVER calls broker.grant'))
  assert.ok(broker.includes("if (channel.path && String(channel.path).startsWith('/api/abaco-voice.')) return 'abaco-voice'"))
  assert.ok(broker.includes('Auto-issue ephemeral task grant for host.fetch voice routes'))
})

test('G5 compact 0.90 / 0.12 / 8192 intacto; sin perfil dsh-desktop ni rehab disabled', async () => {
  const preset = await readFile(
    resolve(PKG_DIR, '../abaco-context/presets/abaco/agent.cordis.yml'),
    'utf8',
  )
  const row = preset.match(
    /-\s*id:\s*compaction-basic[\s\S]*?thresholdRatio:\s*([0-9.]+)[\s\S]*?retainRatio:\s*([0-9.]+)[\s\S]*?maxTokens:\s*([0-9]+)/,
  )
  assert.ok(row, 'la fila compaction-basic existe')
  assert.equal(Number(row[1]), 0.9)
  assert.equal(Number(row[2]), 0.12)
  assert.equal(Number(row[3]), 8192)

  const out = execFileSync('git', ['-C', REPO_ROOT, 'diff', '--name-only'], { encoding: 'utf8' })
  const changed = out.split('\n').map((line) => line.trim()).filter(Boolean)
  for (const file of changed) {
    assert.ok(!file.includes('abaco-context'), `el diff no debe tocar abaco-context: ${file}`)
    assert.ok(
      !/dsh-desktop\.patch\.yml|profile-startup/i.test(file),
      `el diff no debe tocar el perfil dsh-desktop: ${file}`,
    )
  }
  assert.equal(DISABLED_PLUGINS.has('abaco-brand'), true)
  assert.equal(DISABLED_PLUGINS.has('abaco-voice'), false)
})

test('G6 fail-closed live: status 200; no-Mac transcribe 503 + hint; 0 copy de API key', async () => {
  const registry = registerVoiceRoutes()
  const status = registry.find((r) => r.path === LOCAL_STATUS_PATH)
  const transcribe = registry.find((r) => r.path === LOCAL_TRANSCRIBE_PATH)
  assert.ok(status)
  assert.ok(transcribe)

  const statusRes = await status.fetch(new Request(`http://abaco.local${LOCAL_STATUS_PATH}`))
  assert.equal(statusRes.status, 200)
  const statusBody = await statusRes.json()
  assert.equal(statusBody.ok, true)
  assert.equal(statusBody.mac_only, true)
  if (process.platform === 'darwin') {
    assert.equal(statusBody.hint, null)
  } else {
    assert.equal(statusBody.available, false)
    assert.match(String(statusBody.hint), /mlx-whisper|ffmpeg|Whisper local/i)
    assert.doesNotMatch(String(statusBody.hint), /OpenAI API key required/i)
  }

  if (process.platform !== 'darwin') {
    const res = await transcribe.fetch(
      new Request(`http://abaco.local${LOCAL_TRANSCRIBE_PATH}?filename=audio.webm`, {
        method: 'POST',
        body: new Uint8Array([1, 2, 3, 4]),
      }),
    )
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, LINUX_STT_HINT_15_16)
  }
})

test('G7 naming: Janice=runtime en comentarios; Atena ausente del path ejecutable', async () => {
  const host = await readFile(resolve(PKG_DIR, 'index.js'), 'utf8')
  const helper = await readFile(resolve(PKG_DIR, 'lib/stt-mac-contract.js'), 'utf8')
  const worker = await readFile(resolve(PKG_DIR, '../abaco-mediacion-pilot/worker.js'), 'utf8')
  const contract = await readFile(
    resolve(REPO_ROOT, 'docs/contracts/CONTRACT-F2.1-C-STT-MAC.md'),
    'utf8',
  )
  assert.ok(contract.includes('Janice = runtime'))
  assert.match(contract, /Atena/)
  assert.ok(contract.includes('cero Atena'))
  assert.ok(host.includes('Janice = runtime'))
  assert.ok(helper.includes('Janice = runtime'))
  assert.ok(worker.includes('Cero Atena'))
  assert.doesNotMatch(stripComments(host), /\bAtena\b/)
  assert.doesNotMatch(stripComments(helper), /\bAtena\b/)
  assert.doesNotMatch(stripComments(helper), /\bJanice\b/)
})
