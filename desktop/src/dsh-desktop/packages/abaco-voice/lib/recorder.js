/**
 * Audio recording helper.
 *
 * Wraps MediaRecorder for short voice notes (STT use case). Produces a
 * single Blob on stop, ready to hand to an STT provider.
 *
 * CONTRACT-P0-MIC-BUILTIN-SILENCE-048:
 * - Prefer built-in Mac mic via enumerateDevices (pickComposerMicDevice).
 * - PROHIBITED: do not set sample rate in getUserMedia/applyConstraints.
 * - Never getDisplayMedia; reject desktop/tab.
 */

import {
  buildComposerMicApplyConstraints,
  buildComposerMicAudioConstraints,
  isBuiltinMicLabel,
  isBluetoothMicLabel,
  isDeniedMicLabel,
  pickComposerMicDevice,
  shouldRejectBluetoothTrack,
  shouldRejectDeniedTrack,
} from './composer-mic.js'

let recorder = null
let stream = null
let chunks = []
let startedAt = 0
let lastDeviceLabel = ''

export function getLastDeviceLabel() {
  return lastDeviceLabel
}

export async function requestPermission() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia not available in this environment')
  }
  const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  probe.getTracks().forEach((t) => t.stop()) // just probing
  return true
}

async function listAudioInputsWithPermission() {
  const md = navigator.mediaDevices
  let devices = await md.enumerateDevices()
  let inputs = devices.filter((d) => d.kind === 'audioinput')
  if (inputs.some((d) => d.label && String(d.label).trim())) return inputs
  const probe = await md.getUserMedia({ audio: true, video: false })
  try {
    probe.getTracks().forEach((t) => t.stop())
  } catch {}
  devices = await md.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}

export async function start() {
  if (recorder) return
  // Real microphone only — not desktop/tab capture (P1 monitor path).
  const inputs = await listAudioInputsWithPermission()
  let pick = pickComposerMicDevice(inputs)
  try {
    stream = await navigator.mediaDevices.getUserMedia(
      buildComposerMicAudioConstraints(pick.deviceId),
    )
  } catch (e) {
    if (pick.deviceId) {
      pick = { deviceId: null, label: pick.label, reason: 'default', isBuiltin: false }
      stream = await navigator.mediaDevices.getUserMedia(buildComposerMicAudioConstraints(null))
    } else {
      throw e
    }
  }

  let audioTracks = stream.getAudioTracks()
  const trackLabel = (audioTracks[0] && audioTracks[0].label) || pick.label || ''
  if (shouldRejectDeniedTrack(trackLabel, inputs)) {
    const retry = pickComposerMicDevice(inputs)
    if (retry.deviceId) {
      stream.getTracks().forEach((x) => x.stop())
      stream = await navigator.mediaDevices.getUserMedia(
        buildComposerMicAudioConstraints(retry.deviceId),
      )
      pick = retry
      audioTracks = stream.getAudioTracks()
    } else {
      const fallback = inputs.find((d) => d.deviceId && !isDeniedMicLabel(d.label))
      if (fallback) {
        stream.getTracks().forEach((x) => x.stop())
        stream = await navigator.mediaDevices.getUserMedia(
          buildComposerMicAudioConstraints(fallback.deviceId),
        )
        pick = {
          deviceId: String(fallback.deviceId),
          label: String(fallback.label || ''),
          reason: 'default',
          isBuiltin: isBuiltinMicLabel(fallback.label),
        }
        audioTracks = stream.getAudioTracks()
      }
    }
  }
  const afterDeniedLabel = (stream.getAudioTracks()[0] && stream.getAudioTracks()[0].label) || pick.label || ''
  if (shouldRejectBluetoothTrack(afterDeniedLabel, inputs)) {
    const builtin = pickComposerMicDevice(inputs)
    if (builtin.deviceId && builtin.isBuiltin) {
      stream.getTracks().forEach((x) => x.stop())
      stream = await navigator.mediaDevices.getUserMedia(
        buildComposerMicAudioConstraints(builtin.deviceId),
      )
      pick = builtin
      audioTracks = stream.getAudioTracks()
    }
  }

  for (const track of stream.getAudioTracks()) {
    const settings = typeof track.getSettings === 'function' ? (track.getSettings() || {}) : {}
    if (settings.chromeMediaSource === 'desktop' || settings.displaySurface) {
      stream.getTracks().forEach((x) => x.stop())
      stream = null
      throw new Error('Audio source is not a microphone (desktop/tab)')
    }
    try {
      track.applyConstraints(buildComposerMicApplyConstraints())
    } catch {}
  }

  lastDeviceLabel = (stream.getAudioTracks()[0] && stream.getAudioTracks()[0].label) || pick.label || ''
  // N2/N3: prefer built-in reopen above; headphones/BT must still record (never throw AirPods text).
  if (shouldRejectBluetoothTrack(lastDeviceLabel, inputs) && inputs.some((d) => isBuiltinMicLabel(d.label))) {
    console.warn('[abaco-voice/recorder] BT mic still active after reopen attempt; recording anyway', {
      deviceLabel: lastDeviceLabel,
    })
  }
  // silence unused import guard for tree / lint
  void isBluetoothMicLabel

  chunks = []
  recorder = new MediaRecorder(stream, {
    mimeType: pickMimeType(),
    audioBitsPerSecond: 64000,
  })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  recorder.start(250)
  startedAt = Date.now()
}

export function stop() {
  return new Promise((resolve, reject) => {
    if (!recorder) return resolve(null)
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType })
      const duration = (Date.now() - startedAt) / 1000
      cleanup()
      resolve({ blob, duration, deviceLabel: lastDeviceLabel })
    }
    recorder.onerror = (e) => {
      cleanup()
      reject(new Error(`MediaRecorder error: ${e.error?.message || e.error || 'unknown'}`))
    }
    try {
      recorder.stop()
    } catch (e) {
      cleanup()
      reject(e)
    }
  })
}

export function cancel() {
  if (!recorder) return
  try {
    recorder.stop()
  } catch {}
  chunks = []
  cleanup()
}

export function isRecording() {
  return recorder !== null && recorder.state === 'recording'
}

export function duration() {
  return recorder ? (Date.now() - startedAt) / 1000 : 0
}

function cleanup() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  recorder = null
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}
