# Sweet-spot stress C — digest pin + SBOM admission

| Campo | Valor |
|-------|--------|
| **estado** | Stress C ejecutado en `Abaco-deep-Core` (Harnes). No merge a `main`. |
| **fecha** | 2026-09-22 |
| **base** | `820cc0d` (F1 cerrado, release ≤ v0.4.26) |
| **teatro** | Deep Core / Harnes plugin admission. No toca `abaco-python-core`. |
| **candados** | Jev / Atena nunca otorgan. Prompt ≠ grant. Connectors / marketplace siguen HOLD. |

## Hallazgo que obligó el cambio

Antes de este corte, `verifyAdmissions()` en el broker comparaba solo el digest canónico de `manifest.f1.yml` (`PINNED_MANIFEST_DIGEST`). La versión de `package.json` no entraba en la decisión. No existía SBOM. Cambiar bytes de `index.js` con la etiqueta `0.1.0` intacta seguía admitiendo. Un plugin sin SBOM se admitía en silencio.

Eso es FAIL de C2 y FAIL de C3. El arreglo es local: el broker ahora niega o pone HOLD antes de llenar `MANIFEST_CAPS`. Voice y el pilot siguen admitidos porque su subject actual coincide con el pin y traen `sbom.admission.json`. No hay freeze de flota ni rehab del set deshabilitado.

## Veredicto C

| Ángulo | Resultado | Evidencia |
|--------|-----------|-----------|
| **C1** Digest incorrecto → reject | **PASS** | `decideSupplyChainAdmission` niega `digest-mismatch` o `digest-missing`. `supply-chain-admission.mjs:133-143`. Test `C1` en `tests/stress/sweet_spot_c/admission.test.mjs`. |
| **C2** Tag/versión igual y digest distinto → reject | **PASS** | Misma versión `0.1.0` con otro sha256 → deny `tag-match-digest-mismatch`. Prompt y `advisor: atena` no cambian el resultado. `supply-chain-admission.mjs:136-143`. |
| **C3** SBOM ausente → fail-closed o HOLD, nunca admit | **PASS** | `sbom == null` → `hold` / `sbom-missing`, `admitted: false`. SBOM incompleto → `hold` / `sbom-incomplete`. Hash de dependencia `unknown` → `hold` / `sbom-unknown-hash`. `supply-chain-admission.mjs:146-148`. En el broker, cualquier decisión distinta de `admit` deja `admissionFailure` y `authorize()` cae a `manifest-integrity`. `index.js:250-255`, `index.js:841-852`. |
| **C4** SBOM presente + pin OK → admit | **PASS** | Árbol vivo de `abaco-voice` y `abaco-mediacion-pilot`: `evaluatePluginTree` → `admit`. `getAdmissionStatus().ok === true`. Caps de voz siguen en el happy path (suite G-broker, 50/50). |
| **C5** Rename / repackage de los mismos bytes | **PASS** | Mismo digest y mismo `plugin_id` con otro `packageName` o otra etiqueta de versión → admit (el nombre no es identidad). Otro `plugin_id` con los mismos bytes → deny `identity-mismatch`. `supply-chain-admission.mjs:129`. Copia en disco con `lib/extra-payload.js` → deny `artifact-unexpected-file`. Borrar el SBOM de esa copia → HOLD `sbom-missing`. |

Comando:

```bash
node --test \
  tests/stress/sweet_spot_c/admission.test.mjs \
  tests/stress/sweet_spot_c/a-broker-crosscheck.test.mjs
```

Resultado de esta corrida: **8 pass, 0 fail**.

Regresión del broker ya existente (admission immutable, day-14 fail-closed, mediación closeout): **50 pass, 0 fail**. `python3 -m unittest core.f1.tests.test_effect_broker_contract`: **5 pass**.

## Cross-check A (solo Harnes, no el barrido A–E)

**PASS** en el canal que no auto-emite grant.

`authorize()` sin grant vivo, canal `cordis.host`, efecto `proc.spawn` de `abaco-voice`: `deny` / `effect-not-in-grant`, `side_effect: false`, `a_tarea_ok: false`, `denyCount + 1`, `allowCount` quieto, `openGrants === 0`. Un `prompt` y `advisor: jev` en el request no crean grant. Un `grant_id` forjado → `delegation-invalid`. Código: `index.js:1194-1201`. Test: `tests/stress/sweet_spot_c/a-broker-crosscheck.test.mjs`.

Nota de alcance: `host.fetch` con trust `user` en la ruta de voz sigue mintiendo un grant efímero **dentro** de `authorize()` (`index.js:1173`). Ese mint es el broker, no un grant del caller, ni de Jev, ni del texto. No se usó esa ruta para declarar el deny. No es un FAIL de C.

## GAP (no son PASS de otra cosa)

| GAP | Qué no está cubierto |
|-----|----------------------|
| **Firma criptográfica del autor** | `author_signature` es un sello `sha256(producer, plugin_id, component_hash)`. Quien escribe el SBOM puede recomputarlo. No es Sigstore ni in-toto. D6 sigue abierto. |
| **TCB del host** | `abaco-effect-broker`, `abaco-mcp-schema-pin` y el peer `@deepseek-ai/cordis` van con scope `host-tcb` / `host-peer`. No se re-hashean dentro del admit del plugin (el verificador no puede pinchar su propio fuente como dependencia sin punto fijo). Omitirlos del SBOM es HOLD (`sbom-dependency-omitted`), no un admit silencioso. |
| **Sujeto del artefacto** | El pin cubre los `.js` / `.mjs` / `.cjs` shippable más `manifest.f1.yml` y `package.json`. Quedan fuera `tests/` y markdown (`README.md`, `CELL.md`). Un `.js` nuevo sí niega. |
| **Ids sin manifest pin** | Theme, documents, browser, memory, agent-status siguen fuera de `PINNED_MANIFEST_DIGEST`. No entran a `MANIFEST_CAPS`. Este corte no los admite y no les abre marketplace. |

## Qué se puede modificar / qué es candado

**Se puede modificar en review**

- La lista `ARTIFACT_FILES` y el digest `PINNED_ARTIFACT` cuando el subject cambia. Procedimiento: `node scripts/sign-manifest.mjs`, pegar el bloque, regenerar `author_signature` del `sbom.admission.json`, commit visible. No hay API de rotación en runtime.
- Añadir después una verificación Sigstore sobre el mismo subject, sin convertir a Jev en firmante.
- Una dependencia nueva que no sea host-tcb / host-peer tiene que traer hash igual a un pin conocido. Si no, HOLD.

**Candados (no mover)**

- Jev y Atena no llaman `authorize()`, no mintean caps, no firman admisión, no rotan pins.
- Un prompt, un campo `decision: admit` dentro del SBOM, o un advisor no convierten HOLD/deny en admit.
- Tag o versión iguales con digest distinto siguen en deny (`tag-match-digest-mismatch`).
- SBOM ausente = HOLD y el broker queda fail-closed. Nunca admit silencioso.
- Deny de un efecto no apaga la flota admitida. El set deshabilitado (brand, device-identity, cloud-sync, onboarding, experimental) no se rehabilita.
- Connectors y marketplace de terceros siguen HOLD. Este stress no reabre ese claim.
- `authorize()` sigue siendo el único grantor de efectos protegidos.
