# G47 research C — Jev rules → cleaner Frontiers Security Pulse

| Campo | Valor |
|-------|--------|
| **track** | **C** (rules → clean-pulse adhesion) |
| **estado** | **DOCS ONLY** — draft de adhesión; **no** implementación |
| **fecha** | 2026-09-22 |
| **piloto** | Firmado **Anthony 2026-09-22** — PILOT conditions from G47 analysis; this doc maps **rules → plugin invariants** |
| **teatro** | Plugin Frontiers / `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **doctrine (main)** | [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) · [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) · [`JANICE_ATENA_NAMING_LAW.md`](../JANICE_ATENA_NAMING_LAW.md) |
| **paralelos** | Track A / Track B escriben otros files bajo `research/` — **no** unificar aquí; Leader compila después |
| **merge** | Solo vía PR de docs + review humano; **no** merge automático; **no** cliente Jev; **no** llamadas System One |

---

## 0. Tesis (una página)

Adherir las **reglas de Jev** (CODE-first, banda gris %, never grants, `apply_ok` thresholds, platform + thin adapters, cadencia 60–90s) produce un Security Pulse **más limpio** como plugin de Frontiers: menos guardian-LLM, más **radar tip-of-spear**.

| Antes (trampa) | Después (adhesión) |
|----------------|--------------------|
| LLM cada 15s decide “¿permitir?” | CODE always; Jev solo en doubt/tie |
| Jev cerca de `authorize()` | Jev consume audit; breaker ejecuta |
| Un pulse gordo por face | Platform pulse + thin adapters |
| Features con secretos / transcripts | Counters + hashes; host-trusted only |
| Quarantine fácil | Alert-first; attenuate/quarantine vía CODE co-fire o HITL |

**Candados (inviolables):**

1. Jev **never grants**.  
2. Jev **never** authorize hot-path.  
3. Jev **never** mint caps.  
4. Jev **never** escribe `patch.yml` ni admission.  
5. **Janice** ejecuta acciones **ya** autorizadas por CODE/breaker.  
6. **Atena** narrative **OFF** hot-path (mismo candado que Jev para authorize).

Este doc **no** implementa el plugin. Mapea reglas → invariantes del manifiesto Bind, pipeline limpio, checklist de adhesión, anti-patterns, y criterios de éxito del piloto firmado.

---

## 1. Mapa de reglas Jev → invariantes del plugin pulse

### 1.1 Tabla de adhesión

| Regla Jev / doctrina G47 | Invariante del plugin pulse | Cómo se prueba (docs / futuro test) |
|--------------------------|-----------------------------|-------------------------------------|
| CODE-first | Hard trips (pin miss, canary, undeclared egress, digest dualism) **nunca** esperan a Jev | Import graph: CODE path sin Typesafe; tests M1–M10 offline |
| Banda gris % | Jev solo si doubt band / tie / novelty > τ | Gate: 0 Jev calls cuando features quiet + healthy |
| Never grants | Ningún `source: jev` / `attestor: jev` en grant, admission, pin | Deny canónico espejo `atena-cannot-grant`; naming tests |
| Never authorize hot-path | Cero imports Jev/Atena en `authorize()` / pin verify | Static import graph + suite mediación |
| Never mint caps | Pulse no propone widen de `A_plugin` / `A_efectiva` | Choice set sin `grant` / `widen` |
| Never write `patch.yml` / admission | Caps del pulse **excluyen** mutate admission / patch | Manifest caps mínimas (§1.3); admission sealed tests |
| `apply_ok` thresholds | `apply_ok = (choice_confidence ≥ 0.55) ∧ (safe_noul ≥ 0.5) ∧ ¬candado_conflict` | Journal schema; fail → camino más estricto (no allow) |
| Platform + adapters | Un cerebro portable; adapters solo `collectWindow → FeatureBag` | Un FeatureBag schema; N faces |
| Cadencia 60–90s | `interval_base ∈ [60, 90]`s piloto; 15s solo `interval_min` bajo stress | Config + budget hard max N/h |
| Tip-of-spear | Deny no autorizados; no congelar admitidos; acción por `plugin_id` | Doctrine delta; breakers security ≠ SLO |

### 1.2 Qué entra al manifiesto Bind (planned → installed)

Bind (Python Core Phase B / adhesión portable — **docs-only reference**; wire live **después** de que existan sensores host) es donde el contrato diferido encuentra runtime. El pulse se declara como plugin **admitido** con contrato explícito.

| Campo manifiesto (ley portable) | Valor para Security Pulse | Notas |
|---------------------------------|---------------------------|-------|
| `id` | `abaco-security-pulse` (o equivalente platform) | Un id de platform; **no** un pulse por face |
| `role` | `observer-proposer` (Janice-class executor de acciones ya autorizadas) | Nunca grantor / attestor |
| `status` (Bind lifecycle) | Empieza **`planned`** → review → **`installed`** solo tras checklist §4 | No auto-install por novelty |
| `risk` | **`medium`** en piloto alert-only; **`high`** si se habilita attenuate/quarantine auto | `high` ⇒ `requires_human_approval: true` |
| `requires_human_approval` | **true** para cualquier widen de acción más allá de `alert` + journal | HITL / ContractEvolution |
| `caps` | Mínimas (§1.3) | Deny-by-default todo lo demás |
| `sensors` | Declara adapters + provenance `host-trusted` | Plugin self-report ≠ sensor |
| `jev_policy` | `doubt_band_only`; `apply_ok` thresholds fijos | No tunable a “always call” sin review |
| `cadence` | `base: 60–90s`; `min: 15s`; `max: 5–15min`; adaptive | Reject fixed 15s fleet |
| `ledger` | Emite eventos §4.3 | Append-only; redactado |

**Adapters thin** (fuera del manifiesto platform, o filas hijas):

| Adapter | Teatro | Bind note |
|---------|--------|-----------|
| `adapter-deep-voice` | Deep Harnes broker/voice audit | Wire when `getAuditLog` / broker stats host-trusted exist |
| `adapter-python-hub` | Python Core bind/authorize audit | Wire **after** Phase B sensors exist — docs reference only hoy |

### 1.3 Caps mínimas (allowlist)

| Cap | Propósito | Obligatorio en piloto |
|-----|-----------|----------------------|
| `audit.read` | Leer contadores / deny reasons / broker stats host | Sí |
| `journal.write` | Journal JSON del window (redactado) | Sí |
| `alert.local` | Banner / log local | Sí |
| `breaker.propose` | Proponer attenuate/unload al breaker (no ejecutar grant) | Shadow en piloto; live solo con CODE co-fire / HITL |
| `plugin.unload` (vía broker) | Solo si acción ya autorizada por CODE/breaker | No auto en piloto |

### 1.4 PROHIBIDO en el plugin (denylist explícita)

| Prohibido | Por qué |
|-----------|---------|
| `grant.mint` / `grant.widen` / cualquier path a `authorize()` como caller de Jev | Never grants; never hot-path |
| `admission.mutate` / escribir `patch.yml` / preload keys | Admission sealed; datos≠control |
| `pin.write` / schema attest | Attestors host\|user only |
| `secret.read` / Keychain / ambient env as features | Exfiltración + inyección |
| `transcript.ingest` / free-text untrusted a System One | Guardian trap (PIONERO) |
| `self_health.trust` como única señal | Plugin puede mentir |
| Cap `net.external:any` hacia Typesafe **desde** el pulse sin budget + redaction | Budget hard; fall to CODE-only si cae |
| Choice options `grant` / `widen` / `allow_effect` | Decision map fail-closed sin grant |

---

## 2. Pipeline limpio (radar, no guardian)

```text
[1] SENSOR (host-trusted)
      broker audit · auth events · rate · integrity · resource · Phase S signals
      · NUNCA self-report del plugin atacante como sola verdad
                    │
                    ▼
[2] FeatureBag (deterministic, cheap, redacted)
      windowed counters + z/MAD vs baseline
      · hashes / digests (catalog ≠ runtime)
      · NO secretos · NO transcripts · capped size · provenance tags
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
[3a] CODE always          [3b] Jev only doubt-band
      pin / canary /            choice + conf + noul + score
      undeclared egress /       apply_ok iff conf≥0.55 ∧ noul≥0.5
      digest dualism            ∧ ¬candado_conflict
         │                     │
         └──────────┬──────────┘
                    ▼
[4] Decision map → fail-closed (NUNCA “Jev allow → grant”)
      alert | attenuate | quarantine | deny-new-high-risk
      · siempre vía breaker / authorize()-deny path / unload
      · Janice ejecuta la acción YA autorizada por CODE/breaker
      · Atena narrative OFF este hot-path
```

### 2.1 Decision map (fail-closed)

| Salida | Quién puede dispararla | Piloto Anthony 2026-09-22 |
|--------|------------------------|---------------------------|
| `hold` | CODE quiet o Jev `apply_ok` + choice hold | Sí — default |
| `alert` | CODE warn **o** Jev `apply_ok` + choice alert | Sí — acción viva |
| `attenuate` | CODE trip co-fire **o** HITL; Jev solo **shadow** en piloto | Shadow log only |
| `quarantine` | CODE co-fire **o** HITL; fuera de auto-piloto | **OFF** auto |
| `deny-new` (high-risk new effects) | Broker deny path existente; pulse propone, no inventa grant | Consume F1 audit |
| `grant` / `allow` | **Nunca** desde Jev | Candado rojo |

**Regla de oro:** `apply_ok` de Jev **no** puede convertirse en grant. Si Typesafe cae → CODE-only + journal `jev_unavailable` — **fail-closed a allow**, fail-open solo a “no llamar Jev”.

### 2.2 Salida Jev estándar (alineada decision-desk)

1. `choice` — `hold` \| `alert` \| `attenuate_budgets` (sin `grant` / `widen`)  
2. `noul` — P(acción segura bajo candados; no amplía autoridad)  
3. `score` 1–5 — convicción  
4. `confidence` 0–1  

`apply_ok = (choice_confidence ≥ 0.55) ∧ (safe_noul ≥ 0.5) ∧ ¬candado_conflict`

### 2.3 Cadencia (60–90s, no 15s fleet)

```text
interval_base     = 60–90s    # piloto firmado: prefer 90s tip Deep
interval_min      = 15s       # solo bajo stress score
interval_max      = 5–15min   # quiet + healthy baseline
trigger_immediate = CODE trip | canary | pin miss | deny-spike | novelty > τ
budget_hard       = max N Jev calls / hour (piloto: 40/h tip)
```

---

## 3. Por qué esto limpia Frontiers vs “LLM guardian cada 15s”

| Dimensión | Guardian LLM @15s | Pulse limpio (reglas adheridas) |
|-----------|-------------------|----------------------------------|
| **Ruido / FP ops** | ~5 760 decisiones/día; 99% “hold” enseña a ignorar alertas | Solo doubt band (~5–50/día quiet) + CODE trips |
| **TCB bloat** | Advisor en el camino de autoridad; surface de inyección | Advisor fuera; TCB = broker + pin + CODE; Jev journal |
| **Costo / cola** | N faces × M instancias × tick fijo → thundering herd System One | Adaptive + budget; platform una policy |
| **Contratos / CI** | No-determinismo en hot-path rompe M1–M10 | Tests mediación **sin** red a Typesafe |
| **Tip-of-spear** | Quarantine fácil → freeze cultural / ambient smuggling | Alert-first; attenuate un `plugin_id`; admitidos siguen |
| **Evolución** | Cada face inventa umbrales (fat pulse) | Un FeatureBag + adapters; doctrina en un lugar |

**Conclusión:** Frontiers se limpia porque el pulse deja de competir con el broker y pasa a ser **radar de duda con número** encima de F1 + (futuro) Phase S. Menos guardian → menos ruido, menos TCB, menos cola, más precisión tip-of-spear.

Referencia doctrine: G47 analysis §(d)(e)(g); plugin-vs-traditional §0–§6 (platform+adapters **porque** hay seams Janice).

---

## 4. Checklist de adhesión a Bind

Usar antes de pasar el pulse de **`planned` → `installed`**. Docs-only hoy; wire live **después** de sensores host.

### 4.1 Lifecycle status

- [ ] Manifest pulse en estado **`planned`** con caps mínimas (§1.3) y denylist (§1.4).  
- [ ] Risk: **`medium`** (alert+journal) o **`high`** (si attenuate/quarantine vivos).  
- [ ] Si `risk ∈ {medium, high}` y acciones > alert: **`requires_human_approval: true`**.  
- [ ] Review humano (Anthony / Integrador) firma checklist → status **`installed`**.  
- [ ] Widen posterior de caps o cadencia = ContractEvolution + HITL (no silent).

### 4.2 Riesgo y aprobación humana

| Acción del pulse | Risk mínimo | `requires_human_approval` |
|------------------|-------------|---------------------------|
| Journal only | low–medium | false (piloto OK) |
| `alert.local` | medium | false en piloto firmado |
| `attenuate` live | high | **true** (o CODE co-fire documentado) |
| `quarantine` / unload | high | **true** |
| Cualquier cap nueva (`net.*`, secret, admission) | high | **true** + denylist review |

### 4.3 Ledger events (mínimo)

Cada window / decisión debe poder emitir (redactado):

| Evento | Cuándo | Campos mínimos |
|--------|--------|----------------|
| `pulse.window` | Fin de ventana sensor | `ts`, `adapter_id`, `features_digest`, `interval_ms` |
| `pulse.code_trip` | CODE hard decision | `rule_id`, `plugin_id?`, `action` |
| `pulse.jev_call` | Solo si doubt band | `questions`, `usage`, `budget_remaining` |
| `pulse.jev_result` | Respuesta System One | `choice`, `confidence`, `noul`, `score`, `apply_ok` |
| `pulse.action` | Acción tomada | `action_taken`, `via` (`code`\|`breaker`\|`hitl`\|`shadow`), **nunca** `via: jev_grant` |
| `pulse.jev_unavailable` | Typesafe down / budget | `fallback: code_only` |
| `pulse.bind_status` | Cambio planned↔installed | `from`, `to`, `approver`, `risk` |

Espíritu journal = `decide_tech.py` / G47 §(h). Ruta bajo userData Abaco **ajeno** a `~/Library/Application Support/dsh-desktop/`.

### 4.4 Pre-install gates (must-pass)

1. Import graph: 0 refs Jev/Atena en `authorize()` / pin verify / admission mutate.  
2. FeaturePack schema: counters/hashes only; size cap; provenance `host`.  
3. Cadence config: base ≥60s; no fixed 15s fleet flag.  
4. Budget hard + CODE-only fallback.  
5. Day-14 / M1–M10 siguen PASS **sin** red.  
6. Naming: Jev ≠ Atena ≠ Janice documentado en roles del manifest.

---

## 5. Anti-patterns (lista explícita)

| # | Anti-pattern | Por qué es trampa | Remediation (adhesión) |
|---|--------------|-------------------|------------------------|
| 1 | **Jev in `authorize()`** | Viola candado Atena/Jev; timeout no-determinista; “smart broker” | Candado rojo; consume audit only |
| 2 | **Fixed 15s fleet** | Saturación, FP noise, costo cola, thundering herd | Base 60–90s; 15s = `interval_min` under stress |
| 3 | **One fat pulse per face** | Umbrales divergen; freeze cultural; duplica TCB client | Platform + thin adapters |
| 4 | **Trust plugin self-health** | Atacante miente; confused deputy | Host-trusted sensors only |
| 5 | **Ambient secrets in features** | Exfil + inyección al advisor | Counters/hashes; zero Keychain/transcripts |
| 6 | **“Jev allow → grant”** | Never grants violado | Decision map sin grant; Janice solo CODE/breaker |
| 7 | **Auto-quarantine on first warn** | Tip-of-spear death; ambient smuggling | Alert-first; CODE co-fire / HITL |
| 8 | **Jev escribe patch.yml / admission** | Datos≠control; admission sealed | Caps denylist; sealed graph |
| 9 | **Atena narrative on hot-path** | Misma doctrina authorize | Narrative OFF pulse path |
| 10 | **Pulse sustituye Phase S** | Aislamiento estructural ≠ detección gris | Sandbox first; pulse encima |
| 11 | **Fail-open a allow si Typesafe cae** | Bypass mediación | Fail-open solo a CODE-only |
| 12 | **Global threat % → kill core** | Congela admitidos | Acción por `plugin_id`; doctrine delta |

---

## 6. Criterios de éxito del piloto (qué medir antes de widen)

Piloto firmado **Anthony 2026-09-22**: 1 app tip (Deep Harnes voice/broker), 3 questions, journal + alert, cap 40 Jev/h, base ~90s, **sin** quarantine automático. Widen solo si gates pasan.

### 6.1 Gates cuantitativos

| Métrica | Gate (antes de widen) | Si falla |
|---------|----------------------|----------|
| Import graph Jev∩authorize/pin | **0** refs | Stop — no ship code path |
| FP alert rate (uso normal) | < X%/día tras semana-1 baseline (fijar X en review) | Bajar sensibilidad / subir interval; **no** subir freq |
| Quarantine flaps | **0** (quarantine OFF) | — |
| Day-14 / M1–M10 | PASS sin red Typesafe | Stop |
| Costo tip | < \$5 / semana / instancia | Cap más duro / fewer questions |
| Jev call rate quiet | Dentro budget; mayoría ventanas **sin** Jev | Si siempre llama → doubt band mal cableada |
| Utilidad gris | ≥1 caso documentado: choice Jev ≠ regla CODE ingenua **y** humano acuerda | Si 0 en 2 semanas → no widen; considerar stop |
| Flap alert | Sin oscilar hold↔alert en quiet con hysteresis | Tuning MAD/z; no auto-attenuate |

### 6.2 Gates cualitativos / tip-of-spear

| Pregunta | Respuesta requerida para widen |
|----------|--------------------------------|
| ¿Algún admitido quedó congelado por FP del pulse? | No |
| ¿Equipos pidieron “bypass ambient” al core? | No — si sí, alert-first falló |
| ¿Pulse compitió con broker o lo consumió? | Solo consumió audit |
| ¿Phase S sigue siendo el control estructural pendiente? | Sí — pulse no lo “compensa” |

### 6.3 Widen ladder (solo si gates OK)

```text
L0  docs + planned manifest          ← este research
L1  journal + alert (piloto vivo)
L2  shadow attenuate (log would-*)
L3  attenuate live + CODE co-fire
L4  quarantine + HITL
L5  multi-face adapters (python-hub) after sensors exist
```

**Nunca** saltar L0→L3. **Nunca** widen porque “plugins hacen Jev más fácil” (G47 compare §8).

---

## 7. Relación con tracks A/B y Leader

| Track | Archivo | Rol |
|-------|---------|-----|
| **A** | `01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md` (parallel / sibling PR) | Traditional vulns — **no editar desde C** |
| **B** | [`02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md`](02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md) (main / PR #38) | Plugin tradeoffs — **no editar desde C** |
| **C** | este doc | Rules → cleaner pulse adhesion |
| **Leader** | (después) | Compila paper unificado — **no** aquí |

Cross-links doctrine (main, no editar en este PR):

- [`../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) — PILOT feasibility  
- [`../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) — plugin vs monolith; Bind note  
- [`../JANICE_ATENA_NAMING_LAW.md`](../JANICE_ATENA_NAMING_LAW.md) — naming + never-grant  
- [`../PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](../PLUGIN_FRONTIERS_CONTRACT_INDEX.md) — ley vs teatro  
- [`../PORTABLE_RULES_FOR_PYTHON_CORE.md`](../PORTABLE_RULES_FOR_PYTHON_CORE.md) — herencia Python  

**Python Core Bind adhesion:** referenciar como planned/in-flight (platform pulse + thin adapters; wire live **AFTER** sensors exist). Este PR no implementa Bind ni cliente Jev.

---

## 8. Fuera de alcance (candado de este research)

- Implementar cliente Jev / llamadas System One.  
- Implementar plugin Janice Security Pulse o adapters.  
- Editar `research/01*`, `research/02*`, o los `JEV_*.md` ya en main.  
- Paper unificado (Leader).  
- Reabrir F1 / meter Jev en broker.  
- Merge a `main` sin review humano.

---

## Resumen ejecutivo

1. **Adhesión = reglas Jev → invariantes de manifiesto Bind + pipeline + denylist.**  
2. **Pipeline limpio:** host sensor → FeatureBag (counters/hashes) → CODE always → Jev doubt-band → decision map fail-closed vía breaker — **nunca** “Jev allow → grant”.  
3. **Limpia Frontiers** vs guardian@15s: menos ruido, menos TCB, menos cola, tip-of-spear.  
4. **Bind:** `planned→installed`, risk medium/high + `requires_human_approval`, ledger events.  
5. **Anti-patterns** explícitos (§5): Jev in authorize, 15s fleet, fat pulse, self-health, ambient secrets, etc.  
6. **Piloto Anthony 2026-09-22:** medir gates §6 antes de cualquier widen.
