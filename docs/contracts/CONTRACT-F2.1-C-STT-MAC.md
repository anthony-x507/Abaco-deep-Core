# CONTRACT F2.1-C — STT Mac-only (Deep Harnes)

| Campo | Valor |
|-------|--------|
| **fecha** | 2026-09-16 (ET) |
| **autor** | ARQUITECTO (Plugins Frontier) · gate tip = UNIVERSAL ARQUITECTO PASS escrito |
| **impl** | UNIVERSAL INGENIERO |
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **padre** | `CONTRACT-F2.1-A-MEMORYSTORE-QUARANTINE` · `CONTRACT-F1-MEDIACION-DEEP.md` · `CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md` · voto Astra Frontier |
| **orden** | Leader F2.1 GO — A MemoryStore quarantine → B utilityProcess → **C STT Mac-only** (Linux §15/16 diferido) |
| **estado** | **LOCK de gate** (listo cuando aparezca el PR). Merge F2.1 = **HOLD** hasta Leader. |

## Meta

El producto **Mac Deep Harnes** transcribe con **Whisper local ya en el dispositivo** (`mlx_whisper` / `whisper` + `ffmpeg`, modelo cache HF). Eso es el único camino STT de producto.

**No** hay STT de producto en OpenAI cloud (`openai-stt`). **No** hay fallback silencioso a cloud si el Whisper local falla, falta o corre fuera de Mac. Los hints son **fail-closed**: el usuario ve el error; el audio no sale del Mac por un plan B oculto.

Linux §15/16 (stack STT + mic PipeWire/Pulse) es **posterior / opcional**. Este pack **no** lo implementa y **no** bloquea Pack B (`utilityProcess`).

## Alcance C (solo esto)

| In | Out |
|----|-----|
| Contrato Mac-only: `local-whisper-stt` + host `/api/abaco-voice.local-*` | Control B `utilityProcess` (vs fork Harness S0) |
| Hint fail-closed Linux §15/16 (sin stack) | Stack STT Linux (whisper.cpp empaquetado, PipeWire, ALSA) |
| Brokers grants mic → `host.fetch` → `proc.spawn` (`bin:mlx_whisper` / `bin:whisper` / `bin:ffmpeg`) | Re-enable plugins disabled · tocar perfil `dsh-desktop` |
| Deny: fallback silencioso a `openai-stt` / Deepgram | Atena en `authorize()` · bajar compact **0.90 / 0.12 / 8192** |
| Naming Janice = runtime · Atena ≠ authorize | Rehab disabled / Wasm masivo / third-party |
| Tests fail-closed del contrato | Reescribir `client.js` / multi-provider cloud como producto |

## Camino de producto (Mac)

```
mic composer (getUserMedia, Mic del Mac)
    → MediaRecorder blob
    → POST /api/abaco-voice.local-transcribe   (identity = abaco-voice)
        1. authorize(host.fetch)  → grant efímero (trust user, route-owner)
        2. authorize(proc.spawn bin:mlx_whisper|bin:whisper)
        3. authorize(proc.spawn bin:ffmpeg)
        4. executeAuthorized({ grantId, op: 'local-transcribe' })
           worker = Janice runtime; NUNCA grant; cero Atena
    → texto; meta.offline=true, meta.mediated=true
```

Config por defecto (ya en árbol): `sttProvider = local-whisper-stt`, modelo `mlx-community/whisper-small-mlx`, idioma `es`. `openai-stt` / Deepgram **sin** API key se coercen a local (write-through). Eso **no** es un fallback silencioso a cloud: es el lock de producto.

## Reglas

1. **Plataforma de producto = `darwin`.** Whisper local (MLX / CLI en cache) es el STT de Deep Harnes en Mac. Fuera de Mac, admisión = deny fail-closed + hint §15/16. No se finge disponibilidad.
2. **Local only.** El camino de producto no llama `api.openai.com/v1/audio/transcriptions` ni Deepgram. `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` en el spawn: 0 download en transcribe.
3. **Cero fallback silencioso a cloud.** Si falta binario, modelo, grant o la plataforma no es Mac → error visible (ES), `ok: false`. **Prohibido** elegir `openai-stt` / `deepgram-stt` porque el local falló. Opt-in explícito con key + disclosure es legado de registro, **no** el path de producto ni un plan B oculto.
4. **Hints fail-closed.** Status Mac: `hint: null` cuando el contrato admite (bins/cache se reportan en campos propios). Status no-Mac: hint §15/16 (menciona Whisper local / mlx-whisper / ffmpeg; **nunca** “falta API key OpenAI”). Transcribe no-Mac: HTTP 503 + el mismo hint. Sin recetas `pipx`/`brew` en el hint.
5. **Broker intacto.** `authorize()` sigue mecánico. Mic / transcribe no saltan mediación. Worker sin `grantId` = refuse. Direct `spawn` en `abaco-voice` = `LEGACY_UNMEDIATED`. Identidad = dueño de ruta (`/api/abaco-voice.*`), no `plugin_id` del body.
6. **Grants.** Click de mic (user) → `host.fetch` voice = trust de canal `user` + grant de tarea efímero (TTL corto, budget). `proc.spawn` exige authorize **antes** del hijo. Transcript inbound a MemoryStore = `untrusted` (Pack A); **no** amplía `A_tarea` / grants.
7. **Janice / Atena.** Janice = runtime (executor `abaco-mediacion-pilot`). Atena = asesor, **cero** en `authorize()` / grant / spawn. El LLM no elige proveedor STT ni “rescata” con cloud.
8. **Linux §15/16 (diferido, no bloquea B).**
   - **§15** — STT Linux local (whisper.cpp / CLI, modelos no-MLX). Fuera de este pack.
   - **§16** — Mic Linux (PipeWire / Pulse / device pick). Fuera de este pack.
   Hint de código = fail-closed, no implementación. Pack B (`utilityProcess`) no espera este stack.
9. **Candados.** Compact 0.90 / 0.12 / 8192 intacto. No `~/Library/Application Support/dsh-desktop/`. No reactivar `DISABLED_PLUGINS`. No tocar perfil / `dsh-desktop.patch.yml` en este pack.

## Gates de aceptación (PASS tip)

| # | Gate | PASS cuando |
|---|------|-------------|
| G1 | Mac-only | `darwin` admite Whisper local; `linux`/`win32` → `macLocalSttAdmission.ok === false` + hint §15/16 |
| G2 | Sin cloud silencioso | Fixture: selected `local-whisper-stt` + fallback `openai-stt` → deny `silent-cloud-stt-fallback`. Host transcribe no-Mac → 503, 0 spawn cloud |
| G3 | Hint fail-closed | Hint Linux menciona Whisper local / mlx-whisper / ffmpeg; **no** “OpenAI API key”; 0 `pipx`/`brew` |
| G4 | Broker grants | Ruta `local-transcribe` exige `authorize` fetch + spawn; worker exige `grantId`; identidad = `abaco-voice` |
| G5 | Compact intacto | Preset `thresholdRatio 0.9` / `retainRatio 0.12` / `maxTokens 8192`; diff no toca `abaco-context` |
| G6 | Suite | Fail-closed: denegó · 0 side-effect cloud · hint · contador de gates |
| G7 | Naming | Docs/code: Janice=runtime; Atena≠authorize (Atena no aparece en path ejecutable de voice host) |

## Veredicto de tip

Cuando exista PR/tip: UNIVERSAL ARQUITECTO emite `GATE-F2.1-C-<tip>.md` **PASS|FAIL** contra esta tabla. Frontier ARQUITECTO vigila DoD. Leader Mac smoke (mic → Whisper local) si hace falta. **Merge F2.1 HOLD** hasta orden Leader.

## Fuera / siguiente

- **B** `utilityProcess` (vs fork Harness S0) — contrato aparte; **no bloqueado** por §15/16
- **§15 / §16** STT + mic Linux — hint only aquí
- Cloud STT como producto, MCP schema pin, CAPMAS hops, Atena asesor — no este slice

## Anclas en el árbol (no son el contrato; el contrato manda)

| Pieza | Dónde |
|-------|--------|
| Host routes + authorize | `desktop/src/dsh-desktop/packages/abaco-voice/index.js` |
| Helpers de este pack | `desktop/src/dsh-desktop/packages/abaco-voice/lib/stt-mac-contract.js` |
| Default / coerce keyless cloud → local | `…/abaco-voice/lib/normalize-config.js` |
| Mic Mac + anti-alucinación | `…/abaco-voice/lib/composer-mic.js` |
| Caps / recursos | `…/abaco-voice/manifest.f1.yml` |
| Janice executor | `…/abaco-mediacion-pilot/{index,worker,ops}.js` |
| Broker grants | `…/abaco-effect-broker/index.js` (`resolveIdentity`, auto-grant voice) |
| Quarantine STT inbound | Pack A `abaco-memory/lib/quarantine.js` |

*Fin CONTRACT F2.1-C — ARQUITECTO Frontier.*
