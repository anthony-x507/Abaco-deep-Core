/**
 * CONTRACT-P0-MIC-BUILTIN-SILENCE-048 + DECODE-SILENCE-049 + NO-SILENCE-GATE-0410
 * + CAPTURE-HALLUCINATION-0411 — pure helpers.
 * Prefer built-in Mac mic. Deny Continuity/FBI/iPhone before non-bt.
 * Helpers (isSilentPreflight / assertNotSilentFromMeasurement) remain for tests.
 * 0.4.10 live path: assertNotSilentBeforeLocalTranscribe is LOG-ONLY (never throw SILENCE_ERROR_ES).
 * 0.4.11: deny-list + raw-ish constraints + isWhisperHallucination (no silence-gate throw).
 */

/** Built-in Mac / internal labels (must NOT also match BT). */
export const BUILTIN_MIC_RE = /macbook|built-?in|internal|macintosh|imac|mac mini/i

/** Bluetooth / AirPods / HFP / headset — never preferred when built-in exists. */
export const BT_MIC_RE = /airpods|bluetooth|hands-?free|\bhfp\b|headset/i

/**
 * Continuity / iPhone / Desk View / Watch — empty-ish capture; Whisper hallucinates.
 * C1: filtered out BEFORE non-bt. Never pick, not even as non-bt fallback.
 */
export const DENY_MIC_RE = /fbi|continuity|iphone|desk view|iphone mic|apple watch/i

export const SILENCE_MIN_DURATION_S = 0.4
/** Peak abs (and RMS≈0) threshold — below this is treated as silence. */
export const SILENCE_PEAK_ABS_MAX = 0.01
/** Tiny useful blob after ≥0.4s → silence (bytes). */
export const SILENCE_TINY_BLOB_BYTES = 256
export const SILENCE_ERROR_ES = 'Mic silencioso. Usa el micrófono del Mac, no AirPods.'
export const MIC_DEL_MAC_CHIP = 'Mic del Mac'
export const HALLUCINATION_ERROR_ES =
  'Audio no usable (alucinación Whisper). Prueba mic MacBook, habla 2–3 s.'

/** Real short ES answers — never treat as Whisper hallucination (C3 living). */
const REAL_SHORT_ES = new Set(['sí', 'si', 'ya', 'no'])

/** 1–2 char/token fillers Whisper repeats on empty-ish capture. */
const FILLER_TOKEN_RE = /^(y|a|e|o|uh|um|ah|eh|oh|mm|m|hm|hmm|\.|…|\.{2,}|…+)$/i

export function isBuiltinMicLabel(label) {
  const s = String(label || '')
  return BUILTIN_MIC_RE.test(s) && !BT_MIC_RE.test(s)
}

export function isBluetoothMicLabel(label) {
  return BT_MIC_RE.test(String(label || ''))
}

export function isDeniedMicLabel(label) {
  return DENY_MIC_RE.test(String(label || ''))
}

/**
 * Pure device pick for composer mic (R1 / R4 / C1).
 * Order: deny-list out → MacBook/built-in → non-bt → default (deviceId null).
 * AirPods/BT last (never preferred when anything else remains).
 * @param {Array<{ deviceId?: string, kind?: string, label?: string }>} devices
 * @returns {{ deviceId: string|null, label: string, reason: 'builtin'|'non-bt'|'default', isBuiltin: boolean }}
 */
export function pickComposerMicDevice(devices) {
  const inputs = (Array.isArray(devices) ? devices : []).filter(
    (d) => d && (!d.kind || d.kind === 'audioinput'),
  )
  // C1: deny-list BEFORE non-bt — never pick FBI/Continuity/iPhone/Desk View/Watch.
  const allowed = inputs.filter((d) => !isDeniedMicLabel(d.label))

  const builtin = allowed.find((d) => isBuiltinMicLabel(d.label))
  if (builtin && builtin.deviceId) {
    return {
      deviceId: String(builtin.deviceId),
      label: String(builtin.label || ''),
      reason: 'builtin',
      isBuiltin: true,
    }
  }

  const nonBt = allowed.find(
    (d) => d.deviceId && !isBluetoothMicLabel(d.label),
  )
  if (nonBt) {
    return {
      deviceId: String(nonBt.deviceId),
      label: String(nonBt.label || ''),
      reason: 'non-bt',
      isBuiltin: isBuiltinMicLabel(nonBt.label),
    }
  }

  // Last resort: browser default — omit deviceId in getUserMedia.
  return { deviceId: null, label: '', reason: 'default', isBuiltin: false }
}

/**
 * R4: if the active track looks BT/AirPods but a built-in exists, reject BT.
 */
export function shouldRejectBluetoothTrack(trackLabel, devices) {
  if (!isBluetoothMicLabel(trackLabel)) return false
  const inputs = (Array.isArray(devices) ? devices : []).filter(
    (d) => d && (!d.kind || d.kind === 'audioinput'),
  )
  return inputs.some((d) => isBuiltinMicLabel(d.label))
}

/**
 * C1: if OS handed us FBI/Continuity, reopen with any non-denied device.
 */
export function shouldRejectDeniedTrack(trackLabel, devices) {
  if (!isDeniedMicLabel(trackLabel)) return false
  const inputs = (Array.isArray(devices) ? devices : []).filter(
    (d) => d && (!d.kind || d.kind === 'audioinput'),
  )
  return inputs.some((d) => d.deviceId && !isDeniedMicLabel(d.label))
}

/**
 * Peak + RMS over Float32 PCM samples (−1..1).
 * @param {ArrayLike<number>|Float32Array|null|undefined} samples
 */
export function measureFloat32PeakRms(samples) {
  let peak = 0
  let sumSq = 0
  const n = samples && samples.length ? samples.length : 0
  for (let i = 0; i < n; i++) {
    const v = samples[i]
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
    sumSq += v * v
  }
  return { peak, rms: n ? Math.sqrt(sumSq / n) : 0 }
}

/**
 * R3 silence preflight decision (pure).
 * duration≥0.4s AND (peak abs<0.01 OR rms≈0 OR tiny useful blob).
 *
 * D1 / 0.4.9: decodeFailed → skip energy (peak/rms zeros are untrusted;
 * WebAudio cannot decode webm/opus). Only tiny-blob (<256) blocks.
 */
export function isSilentPreflight({ durationSec, peakAbs, rms, blobSize, decodeFailed } = {}) {
  if (!(Number(durationSec) >= SILENCE_MIN_DURATION_S)) return false
  if (decodeFailed) {
    return typeof blobSize === 'number' && blobSize < SILENCE_TINY_BLOB_BYTES
  }
  if (typeof peakAbs === 'number' && peakAbs < SILENCE_PEAK_ABS_MAX) return true
  if (typeof rms === 'number' && rms < SILENCE_PEAK_ABS_MAX) return true
  if (
    typeof blobSize === 'number' &&
    blobSize > 0 &&
    blobSize < SILENCE_TINY_BLOB_BYTES
  ) {
    return true
  }
  return false
}

/**
 * D1/D1b/D2/D3: throw Mic silencioso only when preflight says silent.
 * decodeFailed must not pass peak/rms (energy skipped).
 */
export function assertNotSilentFromMeasurement({
  durationSec,
  peakAbs,
  rms,
  blobSize,
  decodeFailed,
  deviceLabel,
} = {}) {
  const args = decodeFailed
    ? { durationSec, blobSize, decodeFailed: true }
    : { durationSec, peakAbs, rms, blobSize }
  if (isSilentPreflight(args)) {
    const err = new Error(SILENCE_ERROR_ES)
    err.meta = {
      blobSize: typeof blobSize === 'number' ? blobSize : 0,
      deviceLabel: deviceLabel != null ? String(deviceLabel) : '',
      decodeFailed: !!decodeFailed,
    }
    throw err
  }
}

/**
 * Build audio constraints for composer mic — NEVER includes sampleRate (R2 / C2).
 * Raw-ish: AEC+NS off so Continuity/AEC cannot crush the signal; AGC on.
 * @param {string|null|undefined} deviceId
 */
export function buildComposerMicAudioConstraints(deviceId) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
  }
  if (deviceId) {
    audio.deviceId = { exact: String(deviceId) }
  }
  return { audio, video: false }
}

/**
 * Constraints for applyConstraints — NEVER sampleRate (R2 / C2).
 */
export function buildComposerMicApplyConstraints() {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
  }
}

function isFillerToken(token) {
  const t = String(token || '')
  if (!t || REAL_SHORT_ES.has(t)) return false
  if (FILLER_TOKEN_RE.test(t)) return true
  // glued fillers: yyyy / aaaa / ....
  return t.length >= 3 && /^(y+|a+|m{2,}|u+h+|h+m+|\.+|…+)$/i.test(t)
}

/**
 * C3 — anti-hallucination post-Whisper (pure).
 * Trim + lower. True if only 1–2 char fillers repeated ≥3, or unique/words < 0.15 with length≥6.
 * Living: sí / ya / no are real short ES answers — never hallucination.
 */
export function isWhisperHallucination(text) {
  const s = String(text ?? '').trim().toLowerCase().normalize('NFC')
  if (!s) return false
  const compact = s.replace(/[¡!.,?¿…]+$/g, '').trim()
  if (REAL_SHORT_ES.has(s) || REAL_SHORT_ES.has(compact)) return false

  const rawTokens = s.split(/\s+/).filter(Boolean)
  const tokens = rawTokens.map((t) => {
    const stripped = t.replace(/^[¿¡"'([{]+|[.!?,;:"'`)\]}]+$/g, '')
    return stripped || t
  }).filter(Boolean)
  if (!tokens.length) {
    const onlyPunct = s.replace(/\s+/g, '')
    return onlyPunct.length >= 3 && /^[.\u2026]+$/.test(onlyPunct)
  }

  const allFillers = tokens.every(isFillerToken)
  if (allFillers && tokens.length >= 3) return true

  const unique = new Set(tokens)
  const ratio = unique.size / tokens.length
  if (tokens.length >= 6 && ratio < 0.15) return true
  if (s.replace(/\s+/g, '').length >= 6 && tokens.length >= 3 && ratio < 0.15) return true
  return false
}

/**
 * R3b meta for silence / empty errors.
 */
export function silenceErrorMeta(blob, deviceLabel) {
  return {
    blobSize: blob && typeof blob.size === 'number' ? blob.size : 0,
    deviceLabel: deviceLabel != null ? String(deviceLabel) : '',
  }
}
