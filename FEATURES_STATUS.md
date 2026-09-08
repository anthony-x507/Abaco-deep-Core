# Estado de features v2 — abaco-deep-core

> Documento vivo del segundo round de features.

## Features nuevos

| Feature | Estado | Backend Python | Frontend TS | Tests |
|---|---|---|---|---|
| Upload de archivos | 🟡 En progreso | ✅ `core/uploads/` | ✅ `desktop/features/upload/` | pendientes |
| STT/TTS whisper.cpp + say | ✅ Completo | ✅ `core/voice/` | ✅ `desktop/features/audio/` | 56 tests |
| Pairing QR teléfono | 🟡 En progreso | ✅ `core/pairing/` | pendiente | pendientes |
| Navegador embebido + skill | 🟡 En progreso | ✅ `core/skills/` | ✅ `desktop/features/browser/` | pendientes |
| Auto-update preservando historial | ✅ Completo | ✅ `core/migrations/` | pendiente | pendientes |
| UI shell con botones | ✅ Completo | — | ✅ `desktop/features/` | — |

## Detalles por feature

### Upload (`core/uploads/` + `desktop/features/upload/`)

Backend Python completo:
- `models.py` con `UploadedFile` dataclass.
- `validators.py` con whitelist MIME, sanitización de filename, límite 100MB.
- `storage.py` con persistencia por UUID, metadata JSONL.
- `attachment.py` con registry por thread.
- `handlers.py` con endpoints dict.
- `tests/test_uploads.py` con 11 tests.

Frontend TypeScript:
- `types.ts`, `ipc-handlers.ts`, `preload-bridge.ts`.
- `ui-component.tsx`, `preview-component.tsx`.
- `styles.module.css`.

### Voice (`core/voice/` + `desktop/features/audio/`)

Backend:
- 10 archivos Python.
- Whisper subprocess wrapper, TTS via `say`.
- AudioRecorder opcional con sox/ffmpeg.
- AudioPlayer con afplay/ffplay.
- VoicePipeline orquestador.
- API FastAPI: `/voices`, `/tts`, `/stt`, `/status`.

Frontend:
- 8 archivos TS/TSX.
- Recorder con MediaRecorder + AnalyserNode.
- Player con HTMLAudioElement.
- MicButton, SpeakerButton, Waveform SVG.

### Pairing (`core/pairing/`)

- `models.py` con PairingCode, PairedDevice, SessionToken.
- `codes.py` con generador y normalizador (alfabeto sin 0/O/1/I).
- `devices.py` con DeviceStore JSON en disco.
- `api.py` con FastAPI router: `/pairing/code`, `/qr/{code}`, `/verify`, `/paired-devices`.
- Validator y registry pendientes de verificación.

### Skills (`core/skills/`)

- `models.py` con Skill, SkillStep, SkillSource.
- `store.py` JSONL.
- `validator.py` con validación de acciones, regex, selectores.
- `generator.py` con llamada a Claude API + fallback heurístico.
- `templates.py` con templates built-in (Google search, GitHub, Twitter).
- `tests/test_skills.py` con 11 tests.

### Auto-update (`core/migrations/`)

- `migrator.py` con registry versionado.
- `backup.py` con ZIP incremental.
- `restore.py` con restore atómico.
- `schema_version.py` con tracking.
- `updater_api.py` con detección de update desde GitHub releases o feed YAML.

### UI Shell (`desktop/features/`)

- `button-bar.tsx` con botones unificados.
- `theme.ts` con paleta ABACO.
- `styles/theme.css` con variables CSS.
- 6 iconos SVG inline.
- `_jsx.ts` shim para build.
- `README.md` con guía de integración.

## Próximos pasos

1. Esperar a subagentes pendientes (upload, pairing, browser).
2. Verificar tests que sí pueden correr.
3. Documentar en `docs/FEATURES.md`.
4. Actualizar README principal.
