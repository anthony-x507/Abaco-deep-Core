# abaco-voice

TTS / STT with multi-provider registry for ABACO DEEP HARNES.

## Providers

### TTS (text-to-speech)
| ID | Label | Cost | Privacy |
|---|---|---|---|
| `web-speech-tts` | Web Speech (browser) | Free | 🛡 local |
| `openai-tts` | OpenAI | $15/M chars | Audio leaves device |
| `edge-tts` | Microsoft Edge | Free | Audio leaves device |
| `elevenlabs-tts` | ElevenLabs | ~$0.18/1k chars | Audio leaves device |

### STT (speech-to-text)
| ID | Label | Cost | Privacy |
|---|---|---|---|
| `web-speech-stt` | Web Speech (browser) | Free | 🛡 local |
| `openai-stt` | OpenAI Whisper | $0.006/min | Audio leaves device |
| `deepgram-stt` | Deepgram Nova-3 | $0.0043/min | Audio leaves device |

## Architecture

```
client.js
  ├── lib/registry.js     # Provider interface + registration
  ├── lib/providers/      # One file per provider (or provider group)
  │   ├── web-speech.js   # TTS + STT, browser-native
  │   ├── openai.js       # TTS + STT (Whisper)
  │   ├── edge.js         # Microsoft Edge TTS
  │   ├── elevenlabs.js   # Premium TTS
  │   └── deepgram.js     # Fast STT
  ├── lib/playback.js     # Audio playback helper (native + blob)
  ├── lib/recorder.js     # MediaRecorder wrapper
  └── lib/storage.js      # Persistent config in device-identity Keychain
```

## Slot injections

| Slot | Component |
|---|---|
| `conversation.input.left` | Mic button (idle / recording / transcribing) |
| `message.actions` | Speak button on assistant messages |
| `settings.advanced.item` | Full settings panel (provider dropdowns + per-provider config) |

## Privacy

- Web Speech providers keep audio on device.
- Cloud providers (OpenAI, Edge, ElevenLabs, Deepgram) send audio to their servers — disclosure shown once before first use.
- API keys stored in macOS Keychain via `abaco-device-identity` secure store.
- No audio is stored on our backend (we have none in this release).

## Configuration storage

Stored under key `abaco-voice:config` in the device-identity secure store:

```json
{
  "ttsProvider": "openai-tts",
  "sttProvider": "openai-stt",
  "providers": {
    "openai-tts": { "apiKey": "sk-...", "voice": "alloy", "model": "gpt-4o-mini-tts" },
    "openai-stt": { "apiKey": "sk-...", "model": "whisper-1", "language": "es" }
  },
  "privacy": { "disclosureAccepted": true, "disclosureAcceptedAt": "..." }
}
```