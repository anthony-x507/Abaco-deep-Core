# THREAT-MODEL — Memoria 3 fases (profile / log / note)

F2-W5 · 2026-09-13 · Módulo: `packages/abaco-memory/threat-model.js`

## Por qué la memoria es el objetivo de mayor valor

El `profile` de la memoria durable se reinyecta como sección del system prompt
en **cada** request y sobrevive a la compactación por construcción. Un hecho
envenenado en el profile no es un dato corrupto: es una instrucción persistente
al agente. Por eso la memoria 3 fases tiene threat model propio (hallazgo del
red team, deep-dive 2026-09-11): procedencia por hecho, cuarentena de profile y
log con hash chain.

## 1. Procedencia por hecho

Cada hecho lleva su procedencia como dato de primera clase:

```js
provenance = { claim, channel, effective }
effective  = min(claim, channel)   // sobre el ordinal congelado del contrato
```

Ordinal (F2-CONTRACT, congelado): `system(5) > developer(4) > guardian(3) >
user(2) > plugin-data(1) > untrusted(0)`.

- `claim` = lo que el productor del hecho DECLARA ("esto viene del usuario").
- `channel` = la fuente VERIFICADA por el harness (por dónde llegó realmente).
- `effective` = el mínimo de ambos. **La misma regla de F1-P2**, ahora como
  módulo reusable y coherente con W3 `provenance.js`.

Ningún plugin puede auto-elevar su procedencia: declarar `claim:'user'`
mientras el canal verificado es `plugin-data` produce `effective:'plugin-data'`.

## 2. Cuarentena de profile

**Todo hecho nuevo nace `quarantined`.** `readProfile()` —la única lectura que
alimenta el prompt— solo expone hechos `admitted`. No existe camino de
"escritura directa al profile".

La promoción `admit(fact, reviewer)` exige, en este orden determinista:

1. **Integridad**: el hash del hecho debe coincidir (hecho modificado tras su
   creación → rechazo `INTEGRITY`).
2. **Estado**: solo se admite desde `quarantined` (doble admisión → `STATE_POLICY`).
3. **Anti-disfraz**: si `claim` supera al `channel` verificado → rechazo
   `MASQUERADE`. Esto es exactamente el escenario rojo del red team.
4. **Piso de procedencia**: `effective >= 'user'` (nada `untrusted` ni
   `plugin-data`, disfrazado o no, entra al profile → `PROVENANCE_POLICY`).
5. **Revisor válido**: `{ id, trust }` con `trust >= 'guardian'`
   (→ `REVIEWER_POLICY` en caso contrario). El usuario **no** puede
   auto-admitir: la promoción exige un revisor independiente de la capa de
   auditoría (coherente con Janice/G3 como auditora en la cascada F2).

`admit()` devuelve un hecho NUEVO (no muta la entrada) con hash recalculado
sobre `state:'admitted'` + `admittedBy`/`admittedAt`, y registra la revisión en
`reviewHistory`. Códigos de rechazo documentados en el módulo:
`MALFORMED_FACT`, `INTEGRITY`, `STATE_POLICY`, `MASQUERADE`,
`PROVENANCE_POLICY`, `REVIEWER_POLICY`.

Flujo recomendado: `makeFact` → (revisión humana o de la capa guardian) →
`admit` → `appendToLog`.

## 3. Hash chain (log append-only)

`appendToLog(fact)` agrega entradas `{ seq, factHash, prevHash, entryHash,
recordedAt }` donde `entryHash = sha256(seq|factHash|prevHash|recordedAt)` y el
primer `prevHash` es `GENESIS`. No existe API de borrado ni edición.

`verifyChain()` recorre la cadena y devuelve `false` ante CUALQUIER anomalía:
secuencia rota, `prevHash` que no enlaza con la entrada anterior, o
`entryHash` recalculado distinto (edición de `factHash`, `recordedAt`, etc.).
Cadena vacía → `true` (vacuidad, no falsedad).

## 4. Escenario rojo del red team: inyección indirecta → memoria

Ataque: un plugin procesa datos externos (p. ej. contenido web, salida de otro
plugin) y los reescribe como hechos "del usuario". Sin este módulo, el claim
`'user'` viaja directo al profile y de ahí al system prompt de cada turno
(persistencia del ataque a través de compactaciones).

Defensa verificada (tests 5, 6 y repro):

| Paso del ataque | Qué lo frena |
|---|---|
| Plugin declara `claim:'user'` | `effective = min('user','plugin-data') = 'plugin-data'` |
| Intento de admisión | `MASQUERADE` (claim supera al canal verificado) |
| Lectura del profile | el hecho sigue `quarantined`; `readProfile()` no lo expone |
| Tamper del journal de admisiones | `verifyChain()` → `false` |

El hecho inyectado queda en cuarentena indefinidamente hasta que un revisor
válido lo descarte o lo admita con procedencia real verificada. No hay
"silencio administrativo": la cuarentena es el estado por defecto, no una
excepción.

## 5. Decisiones abiertas (pendientes de Anthony / del líder)

1. **Memoria opt-in vs por defecto.** Este módulo implementa el **default
   seguro: cuarentena ON** (todo hecho nuevo en cuarentena, promoción explícita
   requerida). **La decisión final del default NO se toma aquí**; queda
   declarada como pendiente de Anthony.
2. **Piso del revisor en `guardian`.** Conservador por diseño (el usuario no se
   auto-admite). El líder puede bajarlo a `user` con revisión registrada, o
   exigir doble revisor para `system`/`developer`; el módulo lo soporta
   cambiando `MIN_REVIEWER_TIER`.
3. **Cableado con el store real.** `threat-model.js` es deliberadamente
   standalone (sin FS, sin dependencias): el cableado a `MemoryStore` y a las
   `abaco_memory_*` tools (`index.js`/`lib/`, NO tocados en este worker) es un
   paso de integración posterior (W6 o worker dedicado). Hasta entonces, el
   store existente NO tiene cuarentena — se declara por escrito, no se asume.

## 6. Garantías y límites

- Determinista: sin red, sin FS, sin reloj salvo `createdAt`/`recordedAt`
  (ISO strings, nunca asertados por valor en tests).
- ESM, cero dependencias externas; hash con `node:crypto` (built-in).
- `readProfile()` devuelve copias profundas: el profile interno no es
  alcanzable por aliasing.
- Límite conocido: la integridad del hecho cubre identidad
  (contenido+procedencia+estado+tiempos), no `reviewHistory` (metadato de
  auditoría, cubierto por el hash chain del log).
- Límite conocido: `tamperForTests` es el simulador de atacante con acceso de
  escritura al journal; en producción esa superficie es el FS del host
  (`<DSH_HOME>/abaco-memory`), fuera del alcance de este módulo.
