# Ley de nombres — Janice / Atena / connectors

| Campo | Valor |
|-------|--------|
| **estado** | **LOCK FINAL** (Plugins Frontier, 2026-09-11; recuperado 2026-09-22) |
| **teatro de prueba** | `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **hereda** | cualquier face Abaco que cargue módulos plug-in (Deep Harnes, Python Core hub, futuros productos) |
| **no es** | código runtime, rename de paquetes npm, ni rebrand de Cordis upstream |

## Tesis en una línea

**Janice** ejecuta. **Atena** aconseja. **connectors** es lenguaje de producto futuro sobre Janice (**HOLD**). El autorizador es determinista: `authorize()` — nunca un SLM.

## Lock de nombres

| Nombre | Significado canónico | Nunca significa |
|--------|----------------------|-----------------|
| **Janice** | Runtime de plugins Abaco (marca propia sobre la mecánica ex-Cordis: provide / inject / patch.yml / loader) | SLM, guardián LLM, grantor, attestor de admisión |
| **Atena** | Asesor SLM (advisory only) | Hot-path authorize, grants, admission, pin attest, spawn, scheme widen |
| **connectors** | Lenguaje de producto futuro para extensiones de usuario/terceros sobre Janice | Nombre de runtime, carpeta de código F1, o permiso de third-party hoy |
| **Cordis** | Dependencia / mecánica upstream (`@deepseek-ai/cordis*`) en Deep Harnes | Marca de producto Abaco; nombre a copiar a Python Core |
| **plugin** | Unidad de comportamiento con **contrato** (deferred binding) | “Carpeta con `index.js`” sin manifest / caps / mediación |

### Recuperación oral / STT

En transcripts y notas habladas, **«Genes» = Janice** (artefacto STT). Al formalizar docs o código, escribir siempre **Janice**.

### Historia breve (no reabrir)

La investigación v2 usó “Janice” una vez como nombre del guardián LLM (G3). El **voto Frontier + checkpoint Astra** lo corrigió: el runtime se llama Janice; el asesor se llama **Atena**. Cualquier doc Mind previo que diga “Janice = LLM guardián” está **superseded** por este lock.

## Dónde usar cada nombre

### Código (identificadores, roles, tests)

| Usar | Ejemplos | Prohibido |
|------|----------|-----------|
| `janice` / `Janice` | `ADMISSION_ROLES.janice = 'runtime'`; comments “Janice cell / executor”; tests G-naming | `janice` como attestor que admite o escala (`janice-is-runtime` deny) |
| `atena` / `Atena` | `ADMISSION_ROLES.atena = 'advisor-never-grants'`; stub `atena-advise.js` **fuera** de `authorize()` | Importar Atena dentro de `authorize()`, `verifyMcpToolSchema`, spawn, pin write |
| Mecánica Cordis | rutas npm, `cordis.patch.yml`, loader patches — **sin renombrar upstream** | Renombrar tarballs Cordis a “janice-*” en este slice |
| `plugin` / `abaco-*` | ids de paquete, manifests F1 | Usar `connector` en ids de código hasta que connectors salga de HOLD |

### Producto (UI, marketing, release notes)

| Hoy (Deep Harnes / teatro F1) | Futuro (HOLD) |
|-------------------------------|---------------|
| Hablar de **plugins** Abaco en la app; runtime interno = Janice en docs de arquitectura | Copy de producto **connectors** = extensiones sobre Janice |
| No vender “Cordis” al usuario final | No anunciar connectors / third-party MCP hasta mediación demostrable (ya lo es en F1) **y** plan de producto explícito |
| Atena no aparece en UI de grants | Atena puede vivir como cara de consejo / triage, nunca como botón “permitir” |

### Docs / contratos / Mind

| Usar | Evitar |
|------|--------|
| Janice = runtime; Atena = advisory; connectors = HOLD | Mezclar “Janice asesora” / “Atena ejecuta” |
| Apuntar a contratos en `docs/contracts/` como **ley de teatro** | Tratar `TECH-plugin-loading.md` o patches Cordis como ley portable de compañía |
| STT «Genes» → Janice al editar | Dejar “Genes” como nombre canónico |

## Roles de autoridad (invariantes)

```
A_efectiva = A_tarea ∩ A_plugin ∩ A_delegación ∩ A_política

authorize()     → único grantor mecánico (código determinista)
Janice          → ejecuta solo con grant vivo (executor / cell)
Atena           → propone / clasifica / aconseja; NUNCA entra en authorize()
datos (skills, docs, memory, tool-results, transcript) → no son plano de control
```

Deny canónicos relacionados (teatro Deep, espejo portable):

- `source: 'atena'` / `attestor: 'atena'` → `atena-cannot-grant`
- `attestor: 'janice'` → `janice-is-runtime`
- Identidad del caller = **canal**, no `plugin_id` del body

## Tip-of-spear (doctrine delta)

**Security ≠ stop evolution.**

- Efectos no autorizados: fail-closed (deny · `side_effect: false` · audit · contador).
- Plugins **admitidos** siguen un fast path; un deny a un tercero **no congela** a los admitidos.
- Ampliar autoridad en runtime solo vía evolución de contrato explícita + HITL (`proposeContractEvolution` / `acceptContractEvolution({ hitl: true })` en el teatro Deep).
- Pins / manifests: rotación en review-time, no API silenciosa de widen.
- Disabled set: no rehab automático.

## Qué NO cambia con este rename

- Mecánica provide / inject / `patch.yml` / preload allowlist.
- Compact Deep **0.90 / 0.12 / 8192**.
- Perfil usuario: nunca escribir `~/Library/Application Support/dsh-desktop/`.
- F1 day-14, broker, admission, F1.5, F2.1 ya cerrados en v0.4.26 — **no reabrir** para “arreglar el nombre”.

## Checklist de review (naming)

- [ ] `authorize()` / broker / pin verify: cero llamadas Atena
- [ ] Roles: Janice = runtime; Atena = advisor-never-grants
- [ ] Docs nuevas: no reintroducen “Janice = LLM guardián”
- [ ] Producto: no usa “connectors” como shipped feature mientras HOLD
- [ ] Oral/STT: “Genes” normalizado a Janice en el texto canónico

## Fuentes (teatro + Mind)

- Checkpoint: Mind `2026-09-11-f1-astra-janice-atena-checkpoint.md`
- Estado: Mind `2026-09-12-plugins-frontier-donde-estamos.md`
- Contratos tip: `docs/contracts/CONTRACT-F1-*.md`, `CONTRACT-F1.5-*.md`, `CONTRACT-F2.1-C-STT-MAC.md`
- Status mediación: `docs/STATUS-F1-MEDIACION.md`
- Índice: [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md)
- Portable Python: [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md)
