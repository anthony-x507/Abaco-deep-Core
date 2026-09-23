# Plugin Frontiers — índice de contratos (ley vs teatro)

| Campo | Valor |
|-------|--------|
| **pack** | Plugin Frontiers Law Pack (Janice naming recovery) |
| **fecha** | 2026-09-22 |
| **tip producto** | ABACO DEEP HARNES **v0.4.26** — F1 day-14 + broker + F1.5 + F2.1 cerrados; **no reabrir F1** |
| **naming** | [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) |

## Cómo leer este índice

| Etiqueta | Significa |
|----------|-----------|
| **LEY** | Invariante portable de compañía: debe heredarse al convertir cualquier sistema a plugins (Python Core, faces futuras). Independiente de Electron/Cordis. |
| **TEATRO** | Contrato o evidencia atada a Deep Harnes (`Abaco-deep-Core`): paths TS, patches, vitest, Mac smoke. Extraer la ley; no copiar el árbol DSH. |
| **HOLD** | Decisión diferida a propósito (connectors, third-party MCP rows, Linux STT, Wasm/CAPMAS). |

Un plugin es un **contrato**, no una carpeta. Ver Mind `2026-09-11-plugin-es-contrato-no-carpeta.md`.

---

## Mapa F1 → F1.5 → F2.1

```text
F1  mediación demostrable
 ├─ Control 1  broker + grants por tarea          [main / v0.4.26]
 ├─ Control 2  ejecución aislada (strangler cell) [Pack B / F2.1]
 └─ Control 3  admission immutable + datos≠control [PR #15]

F1.5  endurecimiento de superficie
 ├─ MCP schema pin/witness                        [PR #16]
 └─ Memory 3-phase packager provenance            [PR #17]

F2.1  packs de producto sobre mediación
 ├─ A  MemoryStore quarantine
 ├─ B  utility / strangler-fork cell
 └─ C  STT Mac-only (Whisper local, no cloud silencioso)
```

---

## Contratos canónicos (repo)

### F1 — mediación

| Doc | Etiqueta | Qué fija (ley extraíble) | Qué es teatro |
|-----|----------|--------------------------|---------------|
| [`CONTRACT-F1-MEDIACION-DEEP.md`](../contracts/CONTRACT-F1-MEDIACION-DEEP.md) | **LEY** + teatro | 0 efecto protegido sin autorizador; worker cae sin tumbar host; datos≠control; DoD day-14; doctrine delta | Repo piloto Deep; compact 0.90/0.12; path `dsh-desktop` |
| [`CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md) | **LEY** + teatro | `A_efectiva` intersección; identidad = canal; `authorize()` único; suite M1–M10; ContractEvolution+HITL | Inject/patch/preload Deep; `f1-broker-deny-reasons.json` Enum tip |
| [`CONTRACT-F1-ADMISSION-IMMUTABLE.md`](../contracts/CONTRACT-F1-ADMISSION-IMMUTABLE.md) | **LEY** + teatro | Grafo de admisión sellado; skills/docs/memory/tool-results no entran al plano de control; Atena never grants | `manifest.f1.yml`, preload Electron, gates G1–G7 tip |
| [`MATRIX-F1-DAY14-ACCEPTANCE.md`](../contracts/MATRIX-F1-DAY14-ACCEPTANCE.md) | **TEATRO** (evidencia) | Demuestra que la ley F1 pasó en tip; espejo Python deny-reasons | Vitest / node:test / LIVE smoke Mac |
| [`STATUS-F1-MEDIACION.md`](../STATUS-F1-MEDIACION.md) | **TEATRO** (ops) | Cómo probar deny/audit/0 side-effect hoy | Comandos locales Deep |
| [`f1-broker-deny-reasons.json`](../contracts/f1-broker-deny-reasons.json) | **LEY** (enum) + teatro | Vocabulario de deny + four asserts; espejado en `core/f1/effect_broker_contract.py` | Razones específicas de superficie Deep (preload, inject) |

### F1.5 — superficie

| Doc | Etiqueta | Ley extraíble | Teatro |
|-----|----------|---------------|--------|
| [`CONTRACT-F1.5-MCP-SCHEMA-PIN.md`](../contracts/CONTRACT-F1.5-MCP-SCHEMA-PIN.md) | **LEY** + teatro | Tools externos no amplían autoridad mutando schema; pin/witness fail-closed; attestors host\|user only | Wrap `ctx.tools.register`, `mcp__*` prefix, patch sin `dsh-mcp-client` |
| [`CONTRACT-F1.5-MEMORY-PACKAGER.md`](../contracts/CONTRACT-F1.5-MEMORY-PACKAGER.md) | **LEY** + teatro | Procedencia por fase; `effective = min(claim, channel)`; untrusted no escala a control; Atena/Janice no attestan admit | Pack A MemoryStore Deep; paths `abaco-memory` |

### F2.1 — producto Mac STT (slice C)

| Doc | Etiqueta | Ley extraíble | Teatro |
|-----|----------|---------------|--------|
| [`CONTRACT-F2.1-C-STT-MAC.md`](../contracts/CONTRACT-F2.1-C-STT-MAC.md) | mayormente **TEATRO** + 1 ley | **Ley:** efectos de voz mediadas; cero fallback silencioso a cloud; Janice ejecuta, Atena no elige provider | Whisper MLX Mac, rutas `/api/abaco-voice.*`, Linux §15/16 HOLD |

Packs A/B viven en código/tests tip; sus contratos padre están citados desde F1 / F2.1-C. No reabrir para este pack de naming.

---

## Ley vs teatro — tabla rápida

| Tema | LEY (portable) | TEATRO (Deep Harnes) | HOLD |
|------|----------------|----------------------|------|
| Naming Janice / Atena | Sí — [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) | Roles en broker tip | — |
| Plugin = contrato | Sí | Carpeta `packages/abaco-*` | — |
| Broker + grants | Sí (intersección + fail-closed) | `abaco-effect-broker` TS | — |
| Admission sealed | Sí (datos ≠ control) | patch.yml / preload Electron | — |
| Schema pin tools externos | Sí (MCP u homólogo) | `mcp__*` + wrap Cordis tools | Habilitar filas MCP third-party |
| Memory provenance | Sí (fases + quarantine) | Pack A / packager JS | Spill C/D |
| STT local-only | Producto Deep Mac | F2.1-C | Linux STT |
| connectors copy | — | — | **HOLD** (producto sobre Janice) |
| Wasm / CAPMAS / third-party libre | — | — | **HOLD** hasta plan + mediación (mediación ya demostrada; falta plan producto) |
| Curso Python 10 | Sí para cores Python | No aplica a Cordis agents | Ver portable rules |

---

## Contratos a reforzar al “pluginizar” cualquier sistema

Checklist de compañía (extraído de F1/F1.5 + curso + defaults Integrador). Al convertir monolito → plugins, exigir evidencia por ítem:

1. **Contrato declarado** — manifest / caps / versión; host descubre en runtime; core no conoce impl en compile-time.
2. **Broker de efectos** — todo sink protegido pasa por un autorizador determinista; timeout/throw = deny.
3. **Grants por tarea** — `A_efectiva` = intersección tarea ∩ plugin ∩ delegación ∩ política; TTL + budget + revoke.
4. **Identidad de canal** — el caller no se auto-nombra; body `plugin_id` no es confianza.
5. **Fail-closed cuádruple** — deny · 0 side-effect · audit · contador (o breaker).
6. **Admisión inmutable en sesión** — skills/docs/memory/tool-results no mutan el grafo de control.
7. **Datos ≠ control** — transcript, tool-result, memoria untrusted no amplían caps ni admission.
8. **Aislamiento del ejecutor** — crash/hang del worker no reinicia el núcleo; unload/revoke sin reboot del core.
9. **Atena-class advisor outside hot-path** — cualquier SLM/LLM asesor **nunca** grant / authorize / attest.
10. **Janice-class runtime** — ejecuta con grant; nunca es grantor ni attestor de escalada.
11. **Pin/witness de schemas de tools externos** — drift o unwitnessed = deny (MCP u equivalente).
12. **Provenance de memoria / estado durable** — fases o tiers con techo; no escalada silenciosa a profile/control.
13. **Evolución explícita + HITL** — widen de autoridad auditado; security ≠ freeze de admitidos.
14. **Trust tiers + kill/breaker por plugin** — respuesta graduada; breakers locales, no congelar el core.
15. **Supply chain mínima** — manifests pinneados / firmados antes de third-party; permission-diff en bump.
16. **Doctrina core chico** — identity, tenancy, event log, broker, registry, audit; negocio en plugins versionados.
17. **Separación de stacks** — Python cores ≠ copiar Cordis/DSH agents (ver portable rules).
18. **connectors HOLD** — no renombrar producto ni abrir third-party UI hasta plan explícito.

---

## Docs de apoyo (no son contratos F*, pero informan la ley)

| Doc / fuente | Uso |
|--------------|-----|
| [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md) | **PAPER unificado G47** (síntesis research A+B+C): plugins vs tradicional + Jev pulse; piloto Anthony 2026-09-22 |
| [`FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md`](FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md) | Research: plugin isolation + supply chain (SBOM, provenance, pin, kill). No runtime; does not replace S1–S8 |
| [`FRONTIER-PERMISSIONS-CAPABILITIES-2026.md`](FRONTIER-PERMISSIONS-CAPABILITIES-2026.md) | Frontier pública 2023–2026 (WASI, Capsicum, seL4, MV3, Deno, OPA, SPIFFE) aplicada a Bind/Janice. No reabre F1. |
| [`README.md`](README.md) | Índice frontier (paper + naming + G47 + research) |
| [`TECH-plugin-loading.md`](../TECH-plugin-loading.md) | Teatro: cómo DSH carga UI plugins (Cordis patch) — **no** copiar a Python Core |
| [`SECURITY.md`](../SECURITY.md) | Modelo seguridad app unsigned actual |
| Mind: plugin = contrato; curso 10 vs Cordis; catorce defaults; frontier dónde estamos | Contexto Leader / rediseño plan |
| [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md) | Qué hereda el hub Python |
| [`FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md`](FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md) | Ports, FacePlugin/catalog hygiene, fitness, top 5 `docs/contracts` refactors. No runtime |
| [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) | G47 pulse PILOT (PR #36): CODE-first, Jev gray-band, platform+adapters |
| [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) | G47 compare: plugin-unique attack surface vs monolith; Jev easier/harder on Janice |
| [`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md) | Wire audit: System One advanced structure vs decision desk. Docs only. Jev stays outside `authorize()` and Bind |
| [`JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md`](JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md) | Cinco poderes cotidianos de Jev: potentiabilities, márgenes de error, honestidad, consejo de atenuar y de timing de canary. `execute_ok` siempre falso. Docs only |
| [`research/README.md`](research/README.md) | Serie research A/B/C (fuentes del paper; drafts no reescritos) |

## Política de este pack

- **Solo markdown.** No cambia runtime Electron.
- **No reabre F1.** Extrae ley portable para Python Core Phase A (rediseño) y futuros productos.
- **Merge a main:** solo vía PR de docs; no merge automático por este agente.


## Ola 1 / Bloque 1 (observation)

| Doc | Role |
|-----|------|
| [`OLA1-BLOQUE1-DURABLE-AUDIT.md`](OLA1-BLOQUE1-DURABLE-AUDIT.md) | **INV-DURABLE-AUDIT-FAIL-CLOSED** — K durable append failures → authorize `audit-unavailable` (tip-of-spear; in-memory trail kept) |
