/**
 * Audio recording helper.
 *
 * Wraps MediaRecorder for short voice notes (STT use case). Produces a
 * single Blob on stop, ready to hand to an STT provider.
 *
 * Constraints: prefers webm/opus; falls back to whatever the browser offers.
 * macOS Electron exposes getUserMedia + MediaRecorder on Chromium without
 * any extra setup beyond the Info.plist NSMicrophoneUsageDescription entry.
 */

let recorder = null
let stream = null
let chunks = []
let startedAt = 0

export async function requestPermission() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia not available in this environment')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach((t) => t.stop()) // just probing
  return true
}

export async function start() {
  if (recorder) return
  // Real microphone only — not desktop/tab capture (P1 monitor path).
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  })
  for (const track of stream.getAudioTracks()) {
    const settings = typeof track.getSettings === 'function' ? (track.getSettings() || {}) : {}
    if (settings.chromeMediaSource === 'desktop' || settings.displaySurface) {
      stream.getTracks().forEach((x) => x.stop())
      stream = null
      throw new Error('Audio source is not a microphone (desktop/tab)')
    }
  }
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
      resolve({ blob, duration })
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