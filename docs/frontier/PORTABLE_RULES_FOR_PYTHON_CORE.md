# Reglas portables para Python Core (desde Plugins Frontier)

| Campo | Valor |
|-------|--------|
| **audiencia** | Hub Python Core / relays / engines (Phase A en rediseño; plan pausado) |
| **fuente** | Teatro Deep Harnes F1–F2.1 (v0.4.26) + curso Python 10 + voto Frontier |
| **naming** | [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) |
| **índice** | [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md) |

## Objetivo

Alimentar el **rediseño del plan** Python Core con ley ya demostrada en Deep Harnes — sin arrastrar el teatro Cordis/Electron ni reabrir F1.

## Qué SÍ copiar / adaptar

### 1. Naming (ley)

| Concepto | Nombre portable | En código Python sugerido |
|----------|-----------------|---------------------------|
| Runtime de plugins | **Janice** | docs + roles (`"janice": "runtime"`); no hace falta renombrar el paquete del curso |
| Asesor SLM | **Atena** | módulo advisory opcional; **nunca** importado por el broker hot-path |
| Extensiones de producto | **connectors** | solo copy/docs; **HOLD** — no APIs públicas aún |
| Unidad técnica | **plugin** | ids, entry points, manifests |

STT / oral: «Genes» → Janice.

### 2. Contrato de mediación (ley F1)

Portar la **semántica**, no el árbol TS:

| Invariante | Adaptación Python |
|------------|-------------------|
| `authorize()` único grantor | Función/servicio determinista en el core; throw/timeout → deny |
| `A_efectiva = ∩(tarea, plugin, delegación, política)` | Mismos conjuntos; serializar grants (TTL, budget, revoke) |
| Identidad = canal | Contexto de llamada verificado por el host (stdio/RPC session), no confiar en `plugin_id` del payload |
| Four asserts | `decision == "deny"`, `side_effect is False`, audit event, contador |
| Plugin retirable | Unload/revoke sin reiniciar el proceso núcleo |
| Doctrine delta | Deny no congela plugins admitidos; widen solo con evolución explícita + HITL |

Espejo ya en este repo (mínimo): `core/f1/effect_broker_contract.py` + `docs/contracts/f1-broker-deny-reasons.json`. Ampliar el enum al surface Python real; no borrar razones Deep si se comparte el JSON — versionar o particionar por face.

### 3. Admisión + datos ≠ control (ley F1 control-3)

- Grafo de admisión **sellado** tras boot/seal.
- Skills, docs, memoria, tool-results, transcripts: **no** añaden caps, preload, ni filas de composición.
- Atena never grants; Janice never attests admit/escalation.

### 4. Superficie F1.5 (ley)

| Tema | Portable |
|------|----------|
| Tools externos (MCP u homólogo) | Pin/witness del schema de input; unwitnessed/drift → deny |
| Memoria / estado durable | Procedencia; `effective = min(claim, channel)`; quarantine de untrusted; no target control |

### 5. Curso Python 10 lecciones (estándar de producto para cores)

Lock Anthony 2026-09-06: **curso 10 = estándar de producto** para plataformas / relays / engines Python.

Orden canónico:

1. Qué es un plugin / por qué  
2. Estado y configuración  
3. Descubrimiento automático  
4. Ciclo de vida  
5. Eventos  
6. Aislamiento de errores  
7. Dependencias  
8. Hot reload  
9. Bus de contexto  
10. Sistema completo  

Reglas del curso que **sí** son ley de core:

- El núcleo solo conoce **interfaces**.
- Los plugins poseen su estado.
- Comunicación por **contexto compartido**, no spaghetti de imports.
- Un plugin fallido **no mata** el core.

Referencia pedagógica: Mind / `abaco-plugin-guide/CURSO-10-LECCIONES.md` (y práctica `curso_plugins/`). No reimplementar lecciones en este PR.

### 6. Defaults del Integrador (subset portable)

Del track “catorce defaults”, llevar al hub al menos:

1. Core mínimo: identity, tenancy, event log, **capability broker**, registry, audit.  
2. Slots/API tipados (pocos, versionados) — no 80 hooks free-form.  
3. Trust tiers desde día uno (default restrictive para plugins nuevos).  
4. Python↔JS (si hay face): JSON-RPC / WebSocket; MCP para tools **externos**; plugins = extensión **interna**.  
5. Kill switch + breakers **por plugin**.  
6. Manifests pinneados / firmados antes de third-party.

### 7. Tip-of-spear

Security must not stop evolution: fail-closed en no autorizados + camino medible al “sí” para admitidos (HITL / ContractEvolution). Todo “no” con ruta hacia “sí”.

---

## Qué NO mezclar (Cordis / DSH / teatro Deep)

| No portar como diseño del hub Python | Por qué |
|--------------------------------------|---------|
| `@deepseek-ai/cordis*` loader, `cordis.patch.yml`, patch-package overlays | Mecánica de agentes DSH; el curso Python es el stack de cores |
| `provide` / `inject` / Cordis `Invalid effect` semantics | Contrato de face Electron; Python usa lifecycle del curso |
| `build/dsh-desktop.patch.yml`, preload Electron, `utilityProcess` | Teatro shell |
| UI slots React / `client.js` module-table | Face desktop |
| Rehab list `DISABLED_PLUGINS` brand/onboarding/… | Estado producto Deep, no modelo de core |
| Compact ratios 0.90 / 0.12 / 8192 como ley Python | Candado **Deep** context preset; Python define su propio presupuesto |
| Paths `~/Library/Application Support/dsh-desktop/` | Stay-out Deep; hub Python usa su propio userData |
| Renombrar runtime a “connectors” en código | HOLD de producto |
| Copiar Atena al hot-path “porque F2 inteligencia” | Atena asesora; broker decide |
| Colapsar “un solo stack Abaco” = Cordis + curso | Lock: **ambos** bajo Abaco, **roles distintos** |

### Separación de productos (lock)

```text
Python Core / relays / engines  →  curso 10 + broker portable + Janice naming
Agent faces (Deep Harnes, Studio) →  Cordis/DSH + mediación F1 (teatro) + misma naming law
```

No reescribir Deep Harnes en Python. No reescribir el hub Python como Cordis.

---

## Qué es espejo útil vs qué es N-A

| Pieza Deep | Para Python Core |
|------------|------------------|
| `docs/contracts/CONTRACT-F1-*.md` | **Copiar semántica** a contratos propios del hub |
| `core/f1/effect_broker_contract.py` | **Semilla** del espejo deny-reasons |
| Day-14 matrix E2 “Python N-A” para STT mediado | Correcto: STT mediado es ruta TS voice; no fingir que `core/voice/` ya llama `authorize()` |
| F2.1-C STT Mac | Solo si el hub ofrece STT: heredar “local / no silent cloud”, no MLX obligatorio |
| `TECH-plugin-loading.md` | Lectura de face; no blueprint del hub |

---

## Lista de contratos a reforzar en el rediseño Phase A

Al retomar Python Core, el plan debe exigir (docs + tests) al menos:

1. Naming law Janice / Atena / connectors HOLD.  
2. Plugin = contrato (manifest + caps + versión).  
3. Broker + grants + four asserts.  
4. Admission seal + datos≠control.  
5. Advisor outside authorize.  
6. Schema pin para tools externos (cuando existan).  
7. Provenance de memoria/estado si hay profile durable.  
8. Curso 10 como skeleton de loader (descubrimiento, lifecycle, eventos, deps, hot reload, isolation).  
9. Core chico; negocio en plugins.  
10. Separación explícita del stack Cordis/DSH (dependencia solo si hay bridge RPC, nunca como loader nativo del hub).

Detalle ampliado: checklist § “Contratos a reforzar” en el [índice](PLUGIN_FRONTIERS_CONTRACT_INDEX.md).

---

## Fuera de alcance de este pack

- Implementar Phase A.  
- Cambiar Electron / Cordis / broker TS.  
- Salir de HOLD connectors.  
- Reabrir F1 o bump de versión producto.
