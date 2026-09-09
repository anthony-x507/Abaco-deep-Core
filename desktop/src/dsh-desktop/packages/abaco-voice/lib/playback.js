/**
 * Audio playback helper.
 *
 * Centralizes the "play this audio source" path:
 *   - native (SpeechSynthesisUtterance) → just speak, no DOM audio
 *   - blob  → create object URL, play via HTMLAudioElement, revoke on end
 *   - url   → same as blob but with a string URL
 *
 * A single in-flight playback is tracked so a new TTS request cancels the
 * previous one instead of overlapping.
 */

let currentAudio = null
let currentNative = null

export async function play(audio) {
  stop()
  if (audio.kind === 'native') {
    currentNative = audio.utterance
    return
  }
  const url = audio.kind === 'url' ? audio.url : URL.createObjectURL(audio.blob)
  const a = new Audio(url)
  currentAudio = a
  a.onended = () => {
    if (currentAudio === a) currentAudio = null
    if (audio.kind === 'blob') URL.revokeObjectURL(url)
  }
  a.onerror = () => {
    if (currentAudio === a) currentAudio = null
    if (audio.kind === 'blob') URL.revokeObjectURL(url)
    throw new Error('Audio playback failed')
  }
  await a.play()
}

export function stop() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if (currentNative && typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel()
    currentNative = null
  }
}

export function isPlaying() {
  return currentAudio !== null || currentNative !== null
}