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
    expect(client).toContain("console.error('[abaco-voice] mic silence preflight'")
    expect(client).toContain('assertNotSilentBeforeLocalTranscribe')
    expect(client).toContain(SILENCE_ERROR_ES)
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

describe('CONTRACT-P0-MIC-BUILTIN-SILENCE-048 T-R5 keep 0.4.7 + version 0.4.8', () => {
  it('T-R5 sticky tiny→small-mlx; OFFLINE; Update; F1; 0 new IPC; version 0.4.8', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    expect(pkg.version).toBe('0.4.8')

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
