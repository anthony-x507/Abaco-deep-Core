# desktop/features/audio

TypeScript voice UI for the abaco-deep-core chat shell.  This folder
mirrors the contracts exposed by `core/voice/` on the Python side so
the two layers stay aligned.

## Files

| File              | Purpose                                                 |
|-------------------|---------------------------------------------------------|
| `types.ts`        | Shared TypeScript types (`WhisperTranscript`, etc.).     |
| `recorder.ts`     | Browser `MediaRecorder` wrapper with analyser frames.   |
| `player.ts`       | `HTMLAudioElement` wrapper with state subscription.     |
| `ipc-handlers.ts` | Thin fetch-based bridge to `/api/voice/*`.              |
| `mic-button.tsx`  | Microphone button (toggle recording).                   |
| `speaker-button.tsx` | Play/pause button for rendered TTS replies.          |
| `waveform.tsx`    | Amplitude visualisation driven by recorder frames.      |
| `tests/audio.test.tsx` | Vitest unit tests for every component above.       |

## Usage

```tsx
import { MicButton, SpeakerButton, VoiceIPC, Waveform } from "@features/audio";

const ipc = new VoiceIPC({ baseUrl: "/api" });

<MicButton ipc={ipc} onTranscript={(text) => composer.setText(text)} />
<SpeakerButton audioUrl={reply.audioUrl} />
<Waveform frames={recorderFrames} />
```

The recording is captured client-side and uploaded as `multipart/form-data`
to `POST /api/voice/stt`, which proxies to the Python
`WhisperRunner.transcribe`.  Playback URLs come from
`POST /api/voice/tts`, which returns a local AIFF file path; the
absolute URL is `voiceIPC.audioUrl(filename)`.

## Tests

```
cd desktop
npx vitest run features/audio/tests/audio.test.tsx
```

The tests monkey-patch `MediaRecorder`, `AudioContext`, `navigator`
and the global `fetch` so they work under Vitest's jsdom environment
without any external audio device.
