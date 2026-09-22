# G47 — Jev Security Pulse Plugin: feasibility & effectiveness

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — análisis; **no** implementación |
| **fecha** | 2026-09-22 |
| **teatro** | Plugin Frontiers / `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **fuentes** | Jev decision-desk PLAN + `decide_tech.py`; DEEPSEEK-PLUGIN-CYBERSECURITY; mind-plugin-system-v2; informe PIONERO (evolución segura); propuesta seguridad-escala; F1 mediación + naming law Janice/Atena |
| **naming** | **Jev** ≠ **Atena** ≠ **Janice** — ver §0 |
| **merge** | Solo vía PR de docs + review humano; **no** merge automático a `main` |

---

## 0. Naming (candado)

| Nombre | Rol | Nunca |
|--------|-----|-------|
| **Jev** (System One `jev-1.13.0`; STT «Jeff») | Mesa de decisión con **% / choice / confidence / noul** | Grantor, hotspot de authorize, frontera de seguridad sola |
| **Janice** | Runtime de plugins (executor) | SLM, grantor, attestor de admisión |
| **Atena** | Advisor SLM; never grants / never authorize hot-path | Hot-path authorize, grants, pin attest |

**Misma doctrina Atena para authorize:** Jev **nunca** crea grants, **nunca** escribe `patch.yml`, **nunca** es el único límite de seguridad. Si `choice_confidence < 0.55` **o** `safe_noul < 0.5` **o** hay conflicto de candado escrito → **fail-closed** (no auto-aplicar).

Tip-of-spear: **security ≠ stop evolution.** Deny a no autorizados; no congelar admitidos; widen solo vía ContractEvolution + HITL.

---

## (a) Idea en plain language

Hoy Abaco ya tiene (o está cerrando) una **espina determinista**: broker `authorize()`, admission sellada, pin de schemas, kill/quarantine como producto. Eso responde “¿este efecto tiene grant?”.

La idea del **Security Pulse** es otra pregunta, periódica y con criterio de atacante:

> Cada ~N segundos, mirar señales locales (logs, métricas, rate, auth events) y preguntar a Jev: *¿nos están atacando?, ¿hay visitantes/comportamiento malicioso?, ¿hay anomalía que merezca alerta/cuarentena/deny?* Devolver **porcentaje de amenaza + confianza**, y si cruza umbral → acción fail-closed **sin** que Jev otorgue poder.

Es un **radar de duda con número**, no un muro. El muro sigue siendo CODE + broker + sandbox.

**Honestidad:** sin sensores buenos y sin puerta CODE-first, esto es un LLM-guardian camuflado — el informe PIONERO ya lo clasifica como **trampa** (costo, FP, inyección, no-determinismo, TCB bloat). El valor aparece solo si Jev entra en la **banda gris**, no en cada tick.

---

## (b) Arquitectura propuesta

```text
┌─────────────────────────────────────────────────────────────────┐
│  Face / app (Deep Harnes, Python Core hub, futuro producto)     │
│                                                                 │
│  [1] SENSOR LOCAL (host-collected; plugin ≠ sole truth)         │
│      · broker audit: allow/deny rates, reason histogram         │
│      · auth events: failed grant, channel mismatch, revoke      │
│      · rate: RPC/tool/egress bytes, LLM token burn              │
│      · integrity: schema-pin miss, hash drift, canary hits      │
│      · resource: CPU/mem/IO, worker crash/restart               │
│                         │                                       │
│                         ▼                                       │
│  [2] FEATURE PACK (deterministic, cheap, redacted)              │
│      windowed counters + z/MAD vs baseline · NO raw secrets     │
│      · NO full transcripts · capped size · provenance tags      │
│                         │                                       │
│            ┌────────────┴────────────┐                          │
│            ▼                         ▼                          │
│  [3a] CODE RULES (always)     [3b] Jev pulse (only if…)         │
│      thresholds, canaries,         doubt band / tie /           │
│      pin miss, undeclared          novel pattern / HITL ask     │
│      egress, budget trip                                    │
│            │                         │                          │
│            │              choice + conf + noul + score          │
│            │              apply_ok iff conf≥0.55 ∧ noul≥0.5     │
│            └────────────┬────────────┘                          │
│                         ▼                                       │
│  [4] DECISION MAP → acción fail-closed (NO grant)               │
│      alert | attenuate | quarantine | deny-new-high-risk        │
│      · siempre vía breaker / authorize() / unload               │
│      · journal JSON (igual espíritu decide_tech.py)             │
│                                                                 │
│  Janice = ejecuta la acción ya autorizada por CODE/breaker      │
│  Atena  = opcional triage narrativo OFF hot-path (no este pulse)│
│  Jev    = % en la banda gris; nunca mint de caps                │
└─────────────────────────────────────────────────────────────────┘
```

### Contratos de cableado

| Capa | Qué hace | Qué **no** hace |
|------|----------|-----------------|
| Sensor | Solo lee host audit / cgroup / broker stats | No confía en “self-report” del plugin atacante |
| Features | Compacta a vectores/contadores + hashes | No manda secretos, Keychain, ni prompts completos a Typesafe |
| CODE | Decide hard cases (pin miss, canary, undeclared egress) | No espera a Jev |
| Jev | Rankea opciones en duda (`alert` vs `attenuate` vs `hold`) | Nunca `source: jev` en grant / admission / pin |
| Acción | Usa APIs ya fail-closed (revoke, unload, breaker, deny) | No “Jev dijo allow → grant” |

**Salida Jev estándar** (alineada a decision-desk):

1. `choice` — acción recomendada (p.ej. `hold` / `alert` / `attenuate` / `quarantine`)
2. `noul` — P(acción segura bajo candados; no amplía autoridad)
3. `score` 1–5 — convicción
4. `confidence` 0–1

Regla Leader: `apply_ok = (choice_confidence ≥ 0.55) ∧ (safe_noul ≥ 0.5) ∧ ¬candado_conflict`; si no → documentar + camino más estricto.

---

## (c) ¿Un plugin por sistema? ¿o platform + adapters?

**Veredicto: un plugin platform + thin adapters por face/app. No un Security Pulse completo por cada software.**

| Opción | Pros | Contras | Tip-of-spear |
|--------|------|---------|--------------|
| **1 plugin monolito por producto** | Empieza rápido | Duplica sensor/CODE/Jev client; umbrales divergen; freeze cultural (“cada face inventa seguridad”) | Malo — frena evolución cruzada |
| **Platform pulse + adapters** | Un cerebro de features/CODE/Jev policy; adapters solo mapean señales locales (voice audit, MCP pin misses, Python broker counters) | Requiere contrato de telemetría portable | Bueno — misma ley, teatro distinto |
| **Solo core TCB embebido** | Máxima autoridad de lectura | Engorda TCB; mezcla negocio/observabilidad | Malo — Integrador: negocio fuera del TCB |

**Diseño portable (ley):**

- **Núcleo pulse** (paquete `abaco-security-pulse` o equivalente): feature pack, reglas CODE, cliente Jev, journal, mapa acción→breaker API.
- **Adapters thin** (`adapter-deep-voice`, `adapter-python-hub`, …): implementan `collectWindow(t0,t1) → FeatureBag` desde el teatro local.
- **Janice** carga el pulse como plugin **admitido** con caps mínimas: `audit.read`, `breaker.propose` / `plugin.unload` vía broker — **no** `admission.mutate`, **no** grant mint.

Un adapter nuevo = PR chico. Cambiar la doctrina de % = un solo lugar.

---

## (d) Cadencia 15s — costo, saturación, qué NO llamar

### Aritmética (orden de magnitud)

Del PLAN Jev: ~**\$0.0001–0.0002** por llamada corta (pocas questions).

| Cadencia fija | Llamadas / día / instancia | Costo \$/día (banda) | Costo \$/mes |
|---------------|----------------------------:|----------------------:|-------------:|
| 15 s | 5 760 | 0.58 – 1.15 | ~17 – 35 |
| 60 s | 1 440 | 0.14 – 0.29 | ~4 – 9 |
| Solo doubt band (~5–50/día típico quiet) | 5–50 | ~0.001 – 0.01 | negligible |

**Costo \$ no es el asesino en un solo Mac de desarrollo.** Sí lo son:

1. **Saturación / cola:** System One no es infinito; N faces × M instancias × tick fijo → thundering herd.
2. **Latencia p99:** si el pulse espera a Jev en el hot-path de `authorize()`, rompes mediación F1 (timeout = deny, pero UX y flapping).
3. **Ruido de journal + FP ops:** 5 760 decisiones/día de las que 99% son “hold” enseña a ignorar alertas.
4. **Exfiltración de features:** cada tick es superficie; más ticks = más riesgo de meter contexto de más.

### Política de cadencia (recomendada)

```text
interval_base     = 60–120s   (no 15s fijo en piloto)
interval_min      = 15s       (solo bajo stress score)
interval_max      = 5–15min   (quiet + healthy baseline)
trigger_immediate = CODE trip | canary | pin miss | deny-spike | novelty > τ
```

**Adaptive:** subir frecuencia cuando z-score/MAD de deny-rate, egress, o novelty cruza warn; bajar con hysteresis (misma lección PIONERO §3).

### Qué NO llamar a Jev cada tick

| Nunca a Jev en tick | Por qué |
|---------------------|---------|
| `authorize()` hot-path | Candado Atena/Jev; timeout no-determinista rompe contratos |
| Pin miss / schema drift / undeclared egress / canary hit | CODE ya sabe deny |
| Aritmética de rate limits, presupuestos, TTL | CODE |
| “¿Ampliar grant / admission?” | Jev nunca grants; HITL + ContractEvolution |
| Transcripts / tool results crudos | Datos≠control; inyección al advisor |
| Gustos de producto / branding | Fuera de mesa técnica |

**Sí a Jev (budgeted):** empate entre `alert` vs `attenuate` vs `hold` cuando features están en doubt band; priorizar incidentes en journal; “¿este novelty score parece ataque o deploy legítimo?” con opciones explícitas.

**15s fijo forever = reject de diseño.** 15s como `interval_min` bajo ataque = OK.

---

## (e) Efectividad — ayuda vs falsos positivos

### Cuándo ayuda

| Escenario | Por qué Jev aporta |
|-----------|-------------------|
| Novelty comportamental sin regla clara (mix de métodos nuevo + deny parcial) | Rankea attenuate vs hold con % |
| Empate entre dos lecturas de telemetría post-deploy | Evita paralizar admitidos (tip-of-spear) |
| Triage de severidad para humano (journal) | Conviction score prioriza cola |
| Shadow dual-run de umbrales nuevos | Advisor offline; no grant |

### Cuándo duele (FP / FN)

| Fallo | Efecto | Mitigación |
|-------|--------|------------|
| FP alto en quiet → alerta constante | Equipos apagan el pulse | Adaptive interval + umbral apply_ok estricto |
| FP attenuate en plugin admitido sano | “Seguridad frena evolución” | Separar breakers **security** vs **SLO**; no quarantine en primer warn |
| FN si features pobres / adversario lento bajo baseline | Falsa calma | Canaries + CODE integrity siguen siendo el piso |
| Modelo inyectable vía feature text | Guardian trap | Solo contadores/hashes; zero free-text untrusted |
| No-determinismo en CI | Contratos frágiles | Tests de mediación **sin** Jev; Jev solo journal en piloto |

### Comparación: CODE deterministic + Jev solo en empates

| Enfoque | Efectividad defensiva | Costo | Tip-of-spear | Ajuste Abaco |
|---------|----------------------|-------|--------------|--------------|
| **A. Jev cada 15s como guardian** | Marketing alto; real mediocre (FP/bypass) | Alto | Malo | **Reject** |
| **B. Solo CODE/reglas** | Fuerte en conocidos; ciego en gris | Bajo | Bueno | Base obligatoria |
| **C. CODE always + Jev doubt/tie** | Mejor ROI; gris cubierto con % | Bajo–medio | Bueno | **Pilot** |
| **D. Atena/Jev dentro de authorize()** | Viola candado | — | — | **Candado rojo** |

**Conclusión efectividad:** el pulse **no sustituye** T3/T4 sandbox, broker, pin, canaries. Añade valor marginal medible solo en (C). Si el piloto no reduce tiempo-a-atenuación en casos grises **sin** subir FP de quarantine, matarlo sin drama.

---

## (f) Relación con Phase S (sandbox providers) y mediación F1

### F1 — deny-by-default mediación

F1 ya fija: efecto protegido = `authorize() → allow` con grant vivo, **o** deny + `side_effect: false` + audit + contador. Janice ejecuta; Atena fuera.

El Security Pulse debe ser **consumidor** de esa auditoría y **productor** de propuestas de attenuate/quarantine que **reutilizan** las mismas APIs fail-closed (`unloadAdmittedPlugin`, revoke grants, breaker).  

**Invariantes:**

1. Pulse **no** es un path alternativo a `authorize()`.
2. `apply_ok` de Jev **no** puede convertirse en grant.
3. Deny de un tercero **no** congela admitidos (doctrine delta).
4. Tests M1–M10 / day-14 **siguen verdes sin** red a Typesafe.

### Phase S — sandbox providers

En el roadmap Frontiers / Integrador / mind-v2, el siguiente endurecimiento estructural es el **ladder T0–T4** (subprocess/Wasm/container) — aquí llamado **Phase S: sandbox providers**: proveedores de aislamiento enchufables (T3 default third-party, T4 sensible) detrás del mismo broker.

| Pulse × Phase S | Relación correcta |
|-----------------|-------------------|
| Contención dura | Phase S / sandbox **contiene** blast radius |
| Detección gris | Pulse **observa** y propone attenuate / subir tier en *nuevas* invocaciones |
| Orden | **No** usar Jev para “compensar” falta de sandbox. Primero mediación F1 (hecha) + avanzar Phase S; pulse es capa adaptativa **encima**, no sustituto |
| Señales Phase S | Crashes, cgroup OOM, syscall deny, IPC framing rejects → features del adapter; CODE trip inmediato; Jev solo si hay empate “¿quarantine ya o attenuate budgets?” |

**Riesgo tip-of-spear:** si el pulse cuarentena agresiva por FP mientras Phase S aún no aísla, el equipo pedirá excepciones ambient → regresión a carpetas. Por eso el piloto es **alert + journal** primero, quarantine solo con CODE co-fire o HITL.

---

## (g) Verdict

### **PILOT** — no ship producto; no reject de la idea

| Criterio | Nota |
|----------|------|
| ¿Potencia seguridad tip-of-spear? | **Sí, condicional** — como doubt-band advisor con %, no como tick guardian |
| ¿Frentra evolución? | **Sí si 15s fijo + quarantine fácil**; **no** si adaptive + alert-first + CODE piso |
| ¿Un plugin por sistema? | **No** — platform + thin adapters |
| ¿Jev como frontera? | **Nunca** — misma doctrina Atena |
| ¿Listo para ship en Deep Harnes? | **No** — falta sensor contract, budget caps, métricas FP, y Phase S sigue siendo el control estructural pendiente |

**Condiciones para pasar de pilot → ship (todas):**

1. CODE trips cubren integridad (pin, canary, undeclared egress) sin Jev.  
2. Jev solo si doubt band o tie; `interval_min=15s`, base ≥60s.  
3. Acciones: piloto = `alert` + journal; `attenuate`/`quarantine` requieren CODE co-fire **o** HITL.  
4. Cero Jev en `authorize()` / admission / pin verify (tests naming + import graph).  
5. Budget hard: max N llamadas/hora; fail-open a CODE-only si Typesafe cae (no fail-open a allow).  
6. Métricas 2 semanas: FP alert rate, flap count, tiempo-a-attenuate en harness sintético, \$/día.  
7. No bloquea ni reabre F1; no merge sin review.

**Reject parcial explícito:** “Security Pulse que pregunta a Jev cada 15s en todo el fleet y decide quarantine solo” — **reject**.

---

## (h) Minimal pilot design (si pilot)

**Alcance:** 1 app (ABACO DEEP HARNES voice/broker path), **3 questions**, journal only (+ alerta local), **sin** quarantine automático.

### App

Deep Harnes tip: leer `getAuditLog()` / `getBrokerStats()` + contadores del voice host (deny reasons M1–M10 family). Adapter ≈ 50–100 LOC. Plugin pulse **no** inyecta UI grants.

### Tres questions (dict paralelo, estilo `decide_tech.py`)

| id | type | Instrucción corta |
|----|------|-------------------|
| `threat_level` | `score` 1–5 | “Given these **counters only**, how severe is active abuse right now?” |
| `visitor_malicious` | `noul` | “P(current session/plugin behavior is hostile or compromised) under Abaco candados.” |
| `next_action` | `choice` | Options: `hold` \| `alert` \| `attenuate_budgets` — **no** `grant`, **no** `widen` |

Post-proceso local: `apply_ok` solo puede disparar **alert** (banner/log). `attenuate_budgets` en piloto = **shadow** (log would-attenuate). Quarantine **fuera** del piloto.

### Journal

Misma forma que decision-desk:

```json
{
  "ts": "...",
  "title": "security-pulse-window",
  "features_digest": "sha256:...",
  "choice": "alert",
  "choice_confidence": 0.62,
  "safe_noul": 0.71,
  "conviction_score": 3,
  "apply_ok": true,
  "action_taken": "alert",
  "rule": "apply if choice_confidence>=0.55 and safe_noul>=0.5 and no written candado conflict",
  "usage": {}
}
```

Ruta sugerida (teatro): bajo userData Abaco **ajeno** a `~/Library/Application Support/dsh-desktop/` — p.ej. journal del pulse en runtime Abaco ya permitido. Redactar siempre.

### Cadencia piloto

- Base **90s**; min **15s** solo si `denyRate` o novelty > warn.  
- Cap **40 llamadas Jev / hora**.  
- Offline Typesafe → CODE-only, journal `jev_unavailable`, **no** allow nuevo.

### DoD del piloto (2 semanas de paper/log)

| Métrica | Gate |
|---------|------|
| Import graph | 0 refs Jev dentro de `authorize()` / pin verify |
| FP alert | < X%/día en uso normal (fijar X tras semana 1 baseline) |
| Flap | 0 quarantine flaps (quarantine ni está on) |
| Day-14 / M1–M10 | Siguen PASS sin red |
| Costo | < \$5 / semana en una instancia tip |
| Utilidad | ≥1 caso gris documentado donde choice Jev ≠ regla CODE ingenua y humano acuerda |

Si falla gates → **stop**; no “subir frecuencia”.

---

## Resumen ejecutivo (10 líneas)

1. **Idea:** radar periódico con criterio atacante → % amenaza/confianza; no sustituye broker/sandbox.  
2. **Arquitectura:** sensor host → features CODE → Jev solo en gris → acción fail-closed **sin grants**.  
3. **Plugin model:** **platform + thin adapters**, no un pulse completo por cada sistema.  
4. **15s fijo:** caro en saturación/FP; OK solo como `interval_min` adaptativo.  
5. **Efectividad real:** CODE + Jev-on-tie; guardian-every-tick es trampa (PIONERO).  
6. **F1:** pulse consume audit; nunca bypass de `authorize()`.  
7. **Phase S:** sandbox contiene; pulse detecta/adapta — no compensar aislamiento faltante con Jev.  
8. **Naming:** Jev ≠ Atena ≠ Janice; Jev never grants (misma doctrina authorize).  
9. **Verdict:** **PILOT** con condiciones; ship producto = no; reject de la idea = no; reject de 15s-guardian = sí.  
10. **Piloto mínimo:** 1 app, 3 questions, journal+alert, cap 40/h, 90s base — docs first, código después de review.

---

## Referencias internas

- [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md)  
- [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md)  
- [`STATUS-F1-MEDIACION.md`](../STATUS-F1-MEDIACION.md)  
- [`CONTRACT-F1-MEDIACION-DEEP.md`](../contracts/CONTRACT-F1-MEDIACION-DEEP.md)  
- Adjunto análisis: `jev-decision-desk/PLAN.md`, `decide_tech.py`; PIONERO §6–7 (LLM guardian trap / defense funnel); DEEPSEEK-PLUGIN-CYBERSECURITY; mind-plugin-system-v2  

## Fuera de alcance de este doc

- Implementar el plugin Janice.  
- Abrir cuentas Typesafe / meter API keys en el tip.  
- Reabrir F1 / cambiar broker.  
- Merge a `main` sin review humano.
