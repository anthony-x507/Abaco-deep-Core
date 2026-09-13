import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_LANGUAGE,
  DEFAULT_LOCAL_MODEL,
  KNOWN_GOOD_LOCAL_MODELS,
  LOCAL_WHISPER_ID,
  listCachedLocalWhisperModels,
  normalizeVoiceConfig,
  pickCachedModel,
  resolveLocalWhisperModel,
  hubModelDirName,
} from '../packages/abaco-voice/lib/normalize-config.js'
import { saveConfig, loadConfig } from '../packages/abaco-voice/lib/storage.js'

const tempRoots: string[] = []

afterEach(async () => {
  while (tempRoots.length) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

async function fixtureCache(ids: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'abaco-hf-'))
  tempRoots.push(root)
  for (const id of ids) {
    const dir = join(root, hubModelDirName(id))
    await mkdir(join(dir, 'snapshots', 'snap1'), { recursive: true })
    await writeFile(join(dir, 'snapshots', 'snap1', 'config.json'), '{}')
  }
  return root
}

function memoryStore(initial: Record<string, string> = {}) {
  const bag = { ...initial }
  return {
    async get(key: string) {
      return bag[key] ?? null
    },
    async set(key: string, value: string) {
      bag[key] = value
    },
    bag,
  }
}

describe('abaco-voice STT lock (0.4.7 sticky tiny migrate)', () => {
  it('T3 schema default is whisper-small-mlx + es; sticky tiny resolves to small-mlx', () => {
    expect(DEFAULT_LOCAL_MODEL).toBe('mlx-community/whisper-small-mlx')
    expect(DEFAULT_LOCAL_LANGUAGE).toBe('es')
    expect(LOCAL_WHISPER_ID).toBe('local-whisper-stt')
    expect(KNOWN_GOOD_LOCAL_MODELS).toEqual([
      'mlx-community/whisper-small-mlx',
      'mlx-community/whisper-base-mlx',
      'mlx-community/whisper-tiny-mlx',
      'mlx-community/whisper-tiny',
    ])
    expect(KNOWN_GOOD_LOCAL_MODELS).not.toContain('mlx-community/whisper-large-v3-turbo')
    expect(resolveLocalWhisperModel('')).toBe('mlx-community/whisper-small-mlx')
    expect(resolveLocalWhisperModel('mlx-community/whisper-tiny')).toBe(
      'mlx-community/whisper-small-mlx',
    )
    expect(resolveLocalWhisperModel('mlx-community/whisper-tiny-mlx')).toBe(
      'mlx-community/whisper-small-mlx',
    )
    expect(resolveLocalWhisperModel('whisper-tiny')).toBe('mlx-community/whisper-small-mlx')
    expect(resolveLocalWhisperModel('mlx-community/whisper-base')).toBe(
      'mlx-community/whisper-base-mlx',
    )
    expect(resolveLocalWhisperModel('mlx-community/whisper-small')).toBe(
      'mlx-community/whisper-small-mlx',
    )
    expect(resolveLocalWhisperModel('mlx-community/whisper-base-mlx')).toBe(
      'mlx-community/whisper-base-mlx',
    )
  })

  it('T1 load openai-stt without key → local-whisper + store.set', async () => {
    const store = memoryStore({
      'abaco-voice:config': JSON.stringify({
        sttProvider: 'openai-stt',
        providers: { 'openai-stt': { apiKey: '   ' } },
      }),
    })
    const cfg = await loadConfig(store)
    expect(cfg.sttProvider).toBe('local-whisper-stt')
    expect(cfg.providers['local-whisper-stt'].model).toBe('mlx-community/whisper-small-mlx')
    expect(cfg.providers['local-whisper-stt'].language).toBe('es')
    const persisted = JSON.parse(store.bag['abaco-voice:config'])
    expect(persisted.sttProvider).toBe('local-whisper-stt')
  })

  it('T2 save openai-stt without key → persist local-whisper', async () => {
    const store = memoryStore()
    await saveConfig(store, {
      sttProvider: 'openai-stt',
      providers: { 'openai-stt': { apiKey: '' } },
    })
    const persisted = JSON.parse(store.bag['abaco-voice:config'])
    expect(persisted.sttProvider).toBe('local-whisper-stt')
    expect(persisted.providers['local-whisper-stt'].model).toBe(
      'mlx-community/whisper-small-mlx',
    )
  })

  it('T2b save deepgram-stt / deepgram without key → local-whisper', async () => {
    for (const id of ['deepgram-stt', 'deepgram']) {
      const store = memoryStore()
      await saveConfig(store, {
        sttProvider: id,
        providers: { [id]: { apiKey: '  ' } },
      })
      const persisted = JSON.parse(store.bag['abaco-voice:config'])
      expect(persisted.sttProvider).toBe('local-whisper-stt')
    }
  })

  it('T3 fixture cache with small-mlx → picked = small-mlx', async () => {
    const root = await fixtureCache([
      'mlx-community/whisper-tiny',
      'mlx-community/whisper-small-mlx',
    ])
    const cached = await listCachedLocalWhisperModels(root)
    expect(cached).toContain('mlx-community/whisper-small-mlx')
    expect(pickCachedModel(cached)).toBe('mlx-community/whisper-small-mlx')
    const { config } = normalizeVoiceConfig({}, { cachedModels: cached })
    expect(config.providers['local-whisper-stt'].model).toBe(
      'mlx-community/whisper-small-mlx',
    )
    expect(config.providers['local-whisper-stt'].language).toBe('es')
  })

  it('T3b fixture cache only tiny → picked = tiny (runtime)', async () => {
    const root = await fixtureCache(['mlx-community/whisper-tiny'])
    const cached = await listCachedLocalWhisperModels(root)
    expect(pickCachedModel(cached)).toBe('mlx-community/whisper-tiny')
    // With cache list: coerce away from uncached small-mlx to picked tiny
    const { config } = normalizeVoiceConfig(
      {
        sttProvider: 'local-whisper-stt',
        providers: {
          'local-whisper-stt': { model: 'mlx-community/whisper-small-mlx', language: 'es' },
        },
      },
      { cachedModels: cached },
    )
    expect(config.providers['local-whisper-stt'].model).toBe('mlx-community/whisper-tiny')
  })

  it('T3c no plain whisper-base/small; tiny removed from dropdown', async () => {
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(client).toContain("DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-small-mlx'")
    expect(client).toContain("default: 'mlx-community/whisper-small-mlx'")
    expect(client).not.toMatch(/value:\s*'mlx-community\/whisper-base'/)
    expect(client).not.toMatch(/value:\s*'mlx-community\/whisper-small'/)
    expect(client).not.toMatch(/value:\s*'whisper-base'/)
    expect(client).not.toMatch(/value:\s*'whisper-small'/)
    expect(client).not.toMatch(/value:\s*'mlx-community\/whisper-tiny'/)
    expect(client).not.toMatch(/value:\s*'mlx-community\/whisper-tiny-mlx'/)
    expect(client).not.toContain('whisper-large-v3-turbo')
    expect(client).not.toMatch(/\.includes\(['\"]whisper-base['\"]\)/)
  })

  it('keeps openai-stt when a non-empty API key is present', () => {
    const { config } = normalizeVoiceConfig({
      sttProvider: 'openai-stt',
      providers: {
        'openai-stt': { apiKey: 'sk-test' },
        'local-whisper-stt': {
          model: 'mlx-community/whisper-small-mlx',
          language: 'es',
        },
      },
    })
    expect(config.sttProvider).toBe('openai-stt')
  })

  it('coerces stored plain whisper-base → whisper-base-mlx', () => {
    const { config, changed } = normalizeVoiceConfig({
      sttProvider: 'local-whisper-stt',
      providers: {
        'local-whisper-stt': { model: 'mlx-community/whisper-base', language: 'es' },
      },
    })
    expect(changed).toBe(true)
    expect(config.providers['local-whisper-stt'].model).toBe(
      'mlx-community/whisper-base-mlx',
    )
  })

  it('0.4.7 sticky tiny in store → load/save persist small-mlx (write-through)', async () => {
    for (const sticky of [
      'mlx-community/whisper-tiny',
      'mlx-community/whisper-tiny-mlx',
      'whisper-tiny',
    ]) {
      const store = memoryStore({
        'abaco-voice:config': JSON.stringify({
          sttProvider: 'local-whisper-stt',
          providers: {
            'local-whisper-stt': { model: sticky, language: 'es' },
          },
        }),
      })
      const cfg = await loadConfig(store)
      expect(cfg.providers['local-whisper-stt'].model).toBe(
        'mlx-community/whisper-small-mlx',
      )
      const persisted = JSON.parse(store.bag['abaco-voice:config'])
      expect(persisted.providers['local-whisper-stt'].model).toBe(
        'mlx-community/whisper-small-mlx',
      )
    }
  })

  it('0.4.7 save sticky tiny → persisted small-mlx', async () => {
    const store = memoryStore()
    await saveConfig(store, {
      sttProvider: 'local-whisper-stt',
      providers: {
        'local-whisper-stt': { model: 'mlx-community/whisper-tiny', language: 'es' },
      },
    })
    const persisted = JSON.parse(store.bag['abaco-voice:config'])
    expect(persisted.providers['local-whisper-stt'].model).toBe(
      'mlx-community/whisper-small-mlx',
    )
  })

  it('0.4.7 cached.includes(tiny) does NOT pardon sticky tiny on normalize', () => {
    const { config, changed } = normalizeVoiceConfig(
      {
        sttProvider: 'local-whisper-stt',
        providers: {
          'local-whisper-stt': { model: 'mlx-community/whisper-tiny', language: 'es' },
        },
      },
      {
        cachedModels: [
          'mlx-community/whisper-tiny',
          'mlx-community/whisper-small-mlx',
        ],
      },
    )
    expect(changed).toBe(true)
    expect(config.providers['local-whisper-stt'].model).toBe(
      'mlx-community/whisper-small-mlx',
    )
  })
})

describe('0.4.7 host / offline / settings Update wiring', () => {
  it('T4 getUserMedia never display/chromeMediaSource', async () => {
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(client).toContain('getUserMedia')
    expect(client).not.toMatch(/getUserMedia\(\s*\{[^}]*chromeMediaSource/)
    expect(client).not.toMatch(/getUserMedia\(\s*\{[^}]*displaySurface/)
  })

  it('T5 authorize + GITHUB_STABLE_FEED + card aspect intact', async () => {
    const voice = await readFile('packages/abaco-voice/index.js', 'utf8')
    const broker = await readFile('packages/abaco-effect-broker/index.js', 'utf8')
    const catalog = await readFile('src/main/update/version-catalog.ts', 'utf8')
    const browser = await readFile('src/shared/abaco-browser.ts', 'utf8')
    expect(voice).toContain('authorize(')
    expect(voice).not.toMatch(/\bspawn\s*\(/)
    expect(broker).toContain('export function authorize')
    expect(catalog).toContain('GITHUB_STABLE_FEED')
    expect(browser).toContain('ABACO_BROWSER_PANEL_MIN_ASPECT')
    expect(browser).toContain('ABACO_BROWSER_PANEL_MAX_ASPECT')
  })

  it('T6 empty/RepoNotFound ≠ API key; 0 pip/brew install recipes', async () => {
    const ops = await readFile('packages/abaco-mediacion-pilot/ops.js', 'utf8')
    const host = await readFile('packages/abaco-voice/index.js', 'utf8')
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(ops).toContain('Repository Not Found')
    expect(ops).toContain('transcripción vacía')
    expect(ops).toContain('No es un problema de API key')
    expect(ops).not.toMatch(/String\(model\)\.includes\('whisper-base'\)/)
    expect(host).toContain('cached_models')
    expect(host).toContain('picked_model')
    expect(host).toContain('hint: null')
    expect(host).not.toContain('pipx install')
    expect(host).not.toContain('brew install')
    expect(client).not.toContain('pipx install')
    expect(client).not.toContain('brew install ffmpeg')
  })

  it('T7 spawn env includes HF_HUB_OFFLINE + TRANSFORMERS_OFFLINE', async () => {
    const ops = await readFile('packages/abaco-mediacion-pilot/ops.js', 'utf8')
    expect(ops).toContain("HF_HUB_OFFLINE: '1'")
    expect(ops).toContain("TRANSFORMERS_OFFLINE: '1'")
    expect(ops).toContain("const DEFAULT_MODEL = 'mlx-community/whisper-small-mlx'")
  })

  it('T8 Settings nav Update control wires updates:check; 0 new IPC', async () => {
    const preload = await readFile('src/preload/index.ts', 'utf8')
    expect(preload).toContain("SETTINGS_UPDATE_BUTTON_ID = 'dsh-desktop-settings-update'")
    expect(preload).toContain('mountSettingsUpdateButton')
    expect(preload).toContain("textContent = 'Update'")
    expect(preload).toContain("ipcRenderer.invoke('updates:check')")
    // Existing channels only — no nested updates:foo:bar
    expect(preload).not.toMatch(/ipcRenderer\.invoke\('updates:[a-z-]+:[a-z-]+'/)
    const channelMatches = [...preload.matchAll(/ipcRenderer\.invoke\('(updates:[^']+)'/g)].map(
      (m) => m[1],
    )
    for (const ch of channelMatches) {
      expect([
        'updates:check',
        'updates:status',
        'updates:download',
        'updates:install',
        'updates:skip',
        'updates:install-version',
        'updates:list-versions',
      ]).toContain(ch)
    }
  })

  it('host DEFAULT + client schema are small-mlx (not tiny)', async () => {
    const host = await readFile('packages/abaco-voice/index.js', 'utf8')
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    const ops = await readFile('packages/abaco-mediacion-pilot/ops.js', 'utf8')
    expect(host).toContain('DEFAULT_LOCAL_MODEL')
    expect(client).toContain("DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-small-mlx'")
    expect(ops).toContain("const DEFAULT_MODEL = 'mlx-community/whisper-small-mlx'")
    expect(client).not.toContain("DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-tiny'")
  })

  it('0.4.7 host upgrades sticky tiny before authorize; ops upgrades before spawn', async () => {
    const host = await readFile('packages/abaco-voice/index.js', 'utf8')
    const ops = await readFile('packages/abaco-mediacion-pilot/ops.js', 'utf8')
    expect(host).toContain('0.4.7 FORCE')
    expect(host).toMatch(/let model = resolveLocalWhisperModel/)
    expect(host).toMatch(/model = resolveLocalWhisperModel\(model\)/)
    const routeStart = host.indexOf('LOCAL_TRANSCRIBE_PATH')
    const routeSlice = host.slice(host.indexOf('path: LOCAL_TRANSCRIBE_PATH'))
    const resolveIdx = routeSlice.indexOf('model = resolveLocalWhisperModel(model)')
    const authIdx = routeSlice.indexOf('authorize({')
    expect(resolveIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeGreaterThan(resolveIdx)
    expect(ops).toContain('STICKY_TINY')
    expect(ops).toContain('STICKY_TINY.includes(model)) model = DEFAULT_MODEL')
  })
})
