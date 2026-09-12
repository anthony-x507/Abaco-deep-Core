import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  BT_MIC_RE,
  BUILTIN_MIC_RE,
  MIC_DEL_MAC_CHIP,
  SILENCE_ERROR_ES,
  SILENCE_MIN_DURATION_S,
  SILENCE_PEAK_ABS_MAX,
  SILENCE_TINY_BLOB_BYTES,
  assertNotSilentFromMeasurement,
  buildComposerMicApplyConstraints,
  buildComposerMicAudioConstraints,
  isBluetoothMicLabel,
  isBuiltinMicLabel,
  isSilentPreflight,
  measureFloat32PeakRms,
  pickComposerMicDevice,
  shouldRejectBluetoothTrack,
  silenceErrorMeta,
} from '../packages/abaco-voice/lib/composer-mic.js'

describe('CONTRACT-P0-MIC-BUILTIN-SILENCE-048 T-R1 pickComposerMicDevice', () => {
  it('T-R1 prefers built-in MacBook over AirPods', () => {
    const pick = pickComposerMicDevice([
      { deviceId: 'bt1', kind: 'audioinput', label: 'AirPods Pro' },
      { deviceId: 'mac1', kind: 'audioinput', label: 'MacBook Pro Microphone' },
      { deviceId: 'vid', kind: 'videoinput', label: 'FaceTime HD' },
    ])
    expect(pick.deviceId).toBe('mac1')
    expect(pick.reason).toBe('builtin')
    expect(pick.isBuiltin).toBe(true)
    expect(isBuiltinMicLabel('Built-in Microphone')).toBe(true)
    expect(isBuiltinMicLabel('Mac mini Microphone')).toBe(true)
    expect(isBuiltinMicLabel('iMac Microphone')).toBe(true)
    expect(isBuiltinMicLabel('Macintosh Speakers')).toBe(true)
    expect(isBuiltinMicLabel('Internal Microphone')).toBe(true)
    expect(isBuiltinMicLabel('AirPods Pro')).toBe(false)
    expect(isBluetoothMicLabel('AirPods Pro')).toBe(true)
    expect(isBluetoothMicLabel('Bluetooth Headset HFP')).toBe(true)
    expect(isBluetoothMicLabel('Hands-Free AG Audio')).toBe(true)
    expect(BUILTIN_MIC_RE.test('MacBook Air Microphone')).toBe(true)
    expect(BT_MIC_RE.test('AirPods')).toBe(true)
  })

  it('T-R1 else first non-BT; last resort default without deviceId', () => {
    const nonBt = pickComposerMicDevice([
      { deviceId: 'bt1', kind: 'audioinput', label: 'AirPods' },
      { deviceId: 'usb1', kind: 'audioinput', label: 'USB Condenser' },
    ])
    expect(nonBt.deviceId).toBe('usb1')
    expect(nonBt.reason).toBe('non-bt')

    const onlyBt = pickComposerMicDevice([
      { deviceId: 'bt1', kind: 'audioinput', label: 'AirPods Max' },
      { deviceId: 'bt2', kind: 'audioinput', label: 'Bluetooth HFP' },
    ])
    expect(onlyBt.deviceId).toBeNull()
    expect(onlyBt.reason).toBe('default')
  })
})

describe('CONTRACT-P0-MIC-BUILTIN-SILENCE-048 T-R2 constraints', () => {
  it('T-R2 build constraints never include sampleRate; reject desktop path in client', async () => {
    const withId = buildComposerMicAudioConstraints('mac1')
    const without = buildComposerMicAudioConstraints(null)
    const apply = buildComposerMicApplyConstraints()
    expect(withId.audio).not.toHaveProperty('sampleRate')
    expect(without.audio).not.toHaveProperty('sampleRate')
    expect(apply).not.toHaveProperty('sampleRate')
    expect(JSON.stringify(withId)).not.toMatch(/sampleRate/)
    expect(JSON.stringify(apply)).not.toMatch(/sampleRate/)
    expect(withId.video).toBe(false)
    expect(withId.audio.deviceId).toEqual({ exact: 'mac1' })
    expect(without.audio.deviceId).toBeUndefined()

    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    const recorder = await readFile('packages/abaco-voice/lib/recorder.js', 'utf8')
    expect(client).toContain('pickComposerMicDevice')
    expect(client).toContain('enumerateDevices')
    expect(client).not.toMatch(/getDisplayMedia\s*\(/)
    expect(client).not.toMatch(/getUserMedia\([^)]*sampleRate/)
    expect(client).not.toMatch(/applyConstraints\([^)]*sampleRate/)
    expect(recorder).not.toMatch(/sampleRate\s*:/)
    expect(recorder).not.toMatch(/getDisplayMedia\s*\(/)
    expect(client).toContain('chromeMediaSource')
    expect(client).toContain('displaySurface')
  })
})

describe('CONTRACT-P0-MIC-BUILTIN-SILENCE-048 T-R3 silence preflight', () => {
  it('T-R3 duration≥0.4s + peak/RMS≈0 → silent; ES error ≠ API key', () => {
    expect(SILENCE_MIN_DURATION_S).toBe(0.4)
    expect(SILENCE_PEAK_ABS_MAX).toBe(0.01)
    expect(SILENCE_ERROR_ES).toBe('Mic silencioso. Usa el micrófono del Mac, no AirPods.')
    expect(SILENCE_ERROR_ES).not.toMatch(/API key/i)
    expect(SILENCE_ERROR_ES).not.toMatch(/OpenAI/i)

    expect(isSilentPreflight({ durationSec: 0.3, peakAbs: 0 })).toBe(false)
    expect(isSilentPreflight({ durationSec: 0.4, peakAbs: 0.009 })).toBe(true)
    expect(isSilentPreflight({ durationSec: 1, peakAbs: 0.02, rms: 0.005 })).toBe(true)
    expect(isSilentPreflight({ durationSec: 1, peakAbs: 0.5, rms: 0.2 })).toBe(false)
    expect(
      isSilentPreflight({
        durationSec: 0.5,
        peakAbs: 0.5,
        blobSize: SILENCE_TINY_BLOB_BYTES - 1,
      }),
    ).toBe(true)

    const quiet = new Float32Array(1000)
    const loud = new Float32Array(1000)
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 === 0 ? 0.4 : -0.4
    expect(measureFloat32PeakRms(quiet).peak).toBe(0)
    expect(measureFloat32PeakRms(loud).peak).toBeGreaterThan(0.3)
  })

  it('T-R3b silence/empty meta MUST include blob.size + device.label', async () => {
    const meta = silenceErrorMeta({ size: 128 }, 'AirPods Pro')
    expect(meta).toEqual({ blobSize: 128, deviceLabel: 'AirPods Pro' })
    const mac = silenceErrorMeta({ size: 4096 }, 'MacBook Pro Microphone')
    expect(mac.blobSize).toBe(4096)
    expect(mac.deviceLabel).toMatch(/MacBook/i)

    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(client).toContain('silenceErrorMeta')
    expect(client).toContain('blobSize')
    expect(client).toContain('deviceLabel')
    expect(client).toContain('assertNotSilentBeforeLocalTranscribe')
    // 0.4.10: live path logs only — constant may remain; must not throw SILENCE_ERROR_ES
    expect(client).toContain("console.warn('[abaco-voice] mic preflight log-only'")
    expect(client).not.toMatch(/throw new Error\(SILENCE_ERROR_ES\)/)
  })
})

describe('CONTRACT-P0-MIC-BUILTIN-SILENCE-048 T-R4 BT vs built-in + chip', () => {
  it('T-R4 reject BT track when built-in exists; optional Mic del Mac chip', async () => {
    const devices = [
      { deviceId: 'bt1', kind: 'audioinput', label: 'AirPods Pro' },
      { deviceId: 'mac1', kind: 'audioinput', label: 'MacBook Pro Microphone' },
    ]
    expect(shouldRejectBluetoothTrack('AirPods Pro', devices)).toBe(true)
    expect(shouldRejectBluetoothTrack('MacBook Pro Microphone', devices)).toBe(false)
    expect(shouldRejectBluetoothTrack('AirPods', [{ deviceId: 'bt1', label: 'AirPods' }])).toBe(
      false,
    )
    expect(MIC_DEL_MAC_CHIP).toBe('Mic del Mac')
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(client).toContain('MIC_DEL_MAC_CHIP')
    expect(client).toContain('Mic del Mac')
    expect(client).toContain('data-abaco-mic-chip')
    expect(client).toContain('shouldRejectBluetoothTrack')
  })
})

describe('CONTRACT-P0-MIC-BUILTIN-SILENCE-048 T-R5 keep 0.4.7 + version 0.4.10', () => {
  it('T-R5 sticky tiny→small-mlx; OFFLINE; Update; F1; 0 new IPC; version 0.4.10', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    expect(pkg.version).toBe('0.4.10')

    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    const host = await readFile('packages/abaco-voice/index.js', 'utf8')
    const ops = await readFile('packages/abaco-mediacion-pilot/ops.js', 'utf8')
    const preload = await readFile('src/preload/index.ts', 'utf8')
    const f1 = await readFile('test/abaco-f1-mediacion-broker.test.ts', 'utf8')

    expect(client).toContain("DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-small-mlx'")
    expect(client).toContain('STICKY_TINY_LOCAL_MODELS')
    expect(host).toContain('0.4.7 FORCE')
    expect(ops).toContain("HF_HUB_OFFLINE: '1'")
    expect(ops).toContain("TRANSFORMERS_OFFLINE: '1'")
    expect(preload).toContain("textContent = 'Update'")
    expect(preload).toContain("ipcRenderer.invoke('updates:check')")
    // 0 new IPC — no nested updates:foo:bar
    expect(preload).not.toMatch(/ipcRenderer\.invoke\('updates:[a-z-]+:[a-z-]+'/)
    expect(client).not.toMatch(/ipcRenderer/)
    expect(f1.length).toBeGreaterThan(100)
    expect(client).toContain("offline: true")
  })
})

describe('CONTRACT-P0-MIC-DECODE-SILENCE-049 D1/D1b/D2/D3/T-D5', () => {
  it('T-D5 decodeFailed + 50KB + 2s MUST NOT silent (allow POST, no Mic silencioso)', () => {
    const args = {
      durationSec: 2,
      peakAbs: 0,
      rms: 0,
      blobSize: 50 * 1024,
      decodeFailed: true,
      deviceLabel: 'MacBook Pro Microphone',
    }
    // D1: energy zeros must be ignored when decodeFailed
    expect(isSilentPreflight(args)).toBe(false)
    expect(() => assertNotSilentFromMeasurement(args)).not.toThrow()
    try {
      assertNotSilentFromMeasurement(args)
    } catch (e) {
      throw new Error(`T-D5 must allow POST / not throw Mic silencioso: ${e && e.message}`)
    }
  })

  it('D1 decodeFailed + tiny blob (<256) still blocks; D3 big blob passes', () => {
    expect(
      isSilentPreflight({
        durationSec: 2,
        peakAbs: 0,
        rms: 0,
        blobSize: SILENCE_TINY_BLOB_BYTES - 1,
        decodeFailed: true,
      }),
    ).toBe(true)
    expect(
      isSilentPreflight({
        durationSec: 2,
        peakAbs: 0,
        rms: 0,
        blobSize: 50 * 1024,
        decodeFailed: true,
      }),
    ).toBe(false)
    expect(() =>
      assertNotSilentFromMeasurement({
        durationSec: 2,
        peakAbs: 0,
        rms: 0,
        blobSize: SILENCE_TINY_BLOB_BYTES - 1,
        decodeFailed: true,
      }),
    ).toThrow(SILENCE_ERROR_ES)
  })

  it('D2 decode OK keeps energy: quiet peak/rms still silent', () => {
    expect(
      isSilentPreflight({ durationSec: 2, peakAbs: 0, rms: 0, blobSize: 50 * 1024 }),
    ).toBe(true)
    expect(
      isSilentPreflight({
        durationSec: 2,
        peakAbs: 0.5,
        rms: 0.2,
        blobSize: 50 * 1024,
      }),
    ).toBe(false)
  })

  it('D1b helpers still encode decodeFailed energy skip (tests-only)', () => {
    // Live client path is N1 log-only; helpers remain for unit tests.
    expect(
      isSilentPreflight({
        durationSec: 2,
        peakAbs: 0,
        rms: 0,
        blobSize: 50 * 1024,
        decodeFailed: true,
      }),
    ).toBe(false)
    expect(SILENCE_ERROR_ES).toMatch(/AirPods/)
  })
})

describe('CONTRACT-P0-MIC-NO-SILENCE-GATE-0410 T-N1–T-N5', () => {
  it('T-N1 assertNotSilentBeforeLocalTranscribe is log-only (console.warn + return; never throw SILENCE_ERROR_ES)', async () => {
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    const fnStart = client.indexOf('async function assertNotSilentBeforeLocalTranscribe')
    expect(fnStart).toBeGreaterThan(-1)
    const fnBody = client.slice(fnStart, client.indexOf('function recorderStop'))
    expect(fnBody).toContain("console.warn('[abaco-voice] mic preflight log-only'")
    expect(fnBody).toContain('blobSize')
    expect(fnBody).toContain('durationSec')
    expect(fnBody).toContain('deviceLabel')
    expect(fnBody).toContain('peakAbs')
    expect(fnBody).toContain('rms')
    expect(fnBody).toContain('decodeFailed')
    expect(fnBody).not.toMatch(/throw\s+new\s+Error\s*\(\s*SILENCE_ERROR_ES\s*\)/)
    expect(fnBody).not.toContain('isSilentPreflight')
    expect(fnBody).toMatch(/never throw SILENCE_ERROR_ES/)
  })

  it('T-N2 zero throw SILENCE_ERROR_ES / AirPods text in client.js AND lib/recorder.js grabar→transcribe path', async () => {
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    const recorder = await readFile('packages/abaco-voice/lib/recorder.js', 'utf8')
    expect(client).not.toMatch(/throw new Error\(SILENCE_ERROR_ES\)/)
    expect(client).not.toMatch(/throw new Error\(['"]Mic silencioso/)
    expect(recorder).not.toMatch(/throw new Error\(['"]Mic silencioso/)
    expect(recorder).not.toContain('Mic silencioso. Usa el micrófono del Mac, no AirPods.')
    // Empty-audio error must not reuse AirPods text
    expect(client).toContain("EMPTY_AUDIO_ERROR_ES = 'Sin audio grabado'")
    expect(client).not.toMatch(/EMPTY_AUDIO_ERROR_ES\s*=\s*SILENCE_ERROR_ES/)
  })

  it('T-N3 prefer built-in reopen OK; headphones/BT must record (no AirPods throw after reopen)', async () => {
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    const recorder = await readFile('packages/abaco-voice/lib/recorder.js', 'utf8')
    expect(client).toContain('shouldRejectBluetoothTrack')
    expect(client).toContain('openComposerMicStream(builtin.deviceId)')
    expect(client).toContain('recording anyway')
    expect(recorder).toContain('recording anyway')
    // reopen path kept; hard throw removed
    expect(client).toContain('prefer built-in reopen')
    expect(shouldRejectBluetoothTrack('AirPods Pro', [
      { deviceId: 'bt1', label: 'AirPods Pro' },
      { deviceId: 'mac1', label: 'MacBook Pro Microphone' },
    ])).toBe(true)
  })

  it('T-N4 blob.size===0 OR duration<0.15s → Sin audio grabado; else always POST local-transcribe', async () => {
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    expect(client).toContain('EMPTY_AUDIO_MIN_DURATION_S = 0.15')
    expect(client).toContain('Sin audio grabado')
    expect(client).toContain('blob.size === 0')
    expect(client).toContain('EMPTY_AUDIO_MIN_DURATION_S')
    expect(client).toContain('throw new Error(EMPTY_AUDIO_ERROR_ES)')
    // Empty error ≠ AirPods silence text
    expect('Sin audio grabado').not.toMatch(/AirPods/)
    // After empty gate + log-only, still POSTs via provider.transcribe
    expect(client).toContain('provider.transcribe(blob, provCfg)')
    expect(client).toContain('assertNotSilentBeforeLocalTranscribe')
    // N5: 0 isSilentPreflight in record→POST path (assertNotSilent body)
    const fnBody = client.slice(
      client.indexOf('async function assertNotSilentBeforeLocalTranscribe'),
      client.indexOf('function recorderStop'),
    )
    expect(fnBody).not.toContain('isSilentPreflight')
    const transcribeBody = client.slice(
      client.indexOf('async function transcribeBlob'),
      client.indexOf('const onCancel'),
    )
    expect(transcribeBody).not.toContain('isSilentPreflight(')
  })

  it('T-N5 keep sticky tiny→small-mlx, F1, Settings Update, R1, R2; version 0.4.10; plugin-safe', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    expect(pkg.version).toBe('0.4.10')
    const client = await readFile('packages/abaco-voice/client.js', 'utf8')
    const host = await readFile('packages/abaco-voice/index.js', 'utf8')
    const preload = await readFile('src/preload/index.ts', 'utf8')
    const f1 = await readFile('test/abaco-f1-mediacion-broker.test.ts', 'utf8')
    expect(client).toContain("DEFAULT_LOCAL_MODEL = 'mlx-community/whisper-small-mlx'")
    expect(client).toContain('STICKY_TINY_LOCAL_MODELS')
    expect(host).toContain('0.4.7 FORCE')
    expect(preload).toContain("textContent = 'Update'")
    expect(preload).toContain("ipcRenderer.invoke('updates:check')")
    expect(client).not.toMatch(/sampleRate\s*:/)
    expect(pickComposerMicDevice([
      { deviceId: 'bt1', kind: 'audioinput', label: 'AirPods Pro' },
      { deviceId: 'mac1', kind: 'audioinput', label: 'MacBook Pro Microphone' },
    ]).reason).toBe('builtin')
    expect(f1.length).toBeGreaterThan(100)
    // plugin-safe: only abaco-voice paths touched in this contract (smoke dirs untracked OK)
    expect(client).toContain('0.4.10')
  })
})

