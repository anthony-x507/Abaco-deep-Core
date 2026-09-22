# PAPER — Plugins vs tradicional + Jev Security Pulse (G47 unificado)

| Campo | Valor |
|-------|--------|
| **estado** | **PAPER** — docs-only; síntesis Leader de research A+B+C |
| **fecha** | 2026-09-22 |
| **piloto** | Firmado **Anthony 2026-09-22** |
| **teatro** | Plugin Frontiers / tip-of-spear · `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **alcance** | Documentación únicamente — **sin** runtime, **sin** cliente Jev, **sin** merge automático |
| **naming** | **Jev** ≠ **Janice** ≠ **Atena** — Jev **never grants**; CODE-first; tip-of-spear |
| **fuentes primarias (no reescritas)** | [`research/01-…`](research/01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md) · [`research/02-…`](research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md) · [`research/03-…`](research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md) |
| **doctrina merged** | [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) · [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) · [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) |

---

## Abstract (EN) / Resumen (ES)

**EN.** Governed plugin hosts (Janice runtime + broker + caps + Bind) do **not** make software magically safer. They **reshape** risk: smaller blast radius and stronger attribution *when* mediation is real, while acquiring plugin-native surfaces (S1–S8) that demand CODE mitigations. A Frontiers Security Pulse adhering to Jev rules (CODE-first, gray-band %, never grants, platform + thin adapters, 60–90s cadence) becomes a cleaner tip-of-spear radar — not an LLM guardian. This paper unifies research A (traditional taxonomy T1–T12), B (plugin tradeoffs), and C (Jev→pulse adhesion) into one decision document for the Anthony 2026-09-22 pilot.

**ES.** Los hosts de plugins **gobernados** (Janice + broker + caps + Bind) **no** hacen el software mágicamente más seguro. **Reconfiguran** el riesgo: menos blast y mejor atribución *si* la mediación es real, a cambio de superficies nativas de plugin (S1–S8) que exigen mitigaciones CODE. Un Security Pulse de Frontiers que adhiere las reglas de Jev (CODE-first, banda gris %, never grants, platform + adapters delgados, cadencia 60–90s) es un radar tip-of-spear más limpio — no un guardián LLM. Este paper unifica research A (taxonomía T1–T12), B (tradeoffs de plugins) y C (adhesión Jev→pulse) como documento de decisión para el piloto Anthony 2026-09-22.

### Tesis (una página)

```text
TRADICIONAL                          PLUGINS GOBERNADOS                    PULSE LIMPIO
power = ambient blob                 power = contratos + caps              CODE always
identity = proceso                    identity = canal × plugin_id          Jev = doubt-band %
remedio = restart / freeze           remedio = unload / revoke / attenuate Janice ejecuta ya-autorizado
señal = tarde / global               señal = atribuible                    Atena/Jev fuera de authorize()
```

| Claim permitido | Claim prohibido |
|-----------------|-----------------|
| Plugins gobernados → **más precisos** / fail-isolation / atribución | “Plugins = magia segura” |
| Jev en banda gris → tip-of-spear **más limpio** que guardian@15s | “Jev decide allow/deny” |
| Monolito gana cuando equipo chico / un binario / sin marketplace | “Hay que pluginizar por moda” |

**Candados (inviolables):**

1. **Jev never grants** — nunca `authorize()`, nunca mint de caps, nunca escribe `patch.yml` / admission.  
2. **Janice** ejecuta con grant vivo; **Atena** aconseja; **connectors** = HOLD.  
3. **CODE-first** — hard trips no esperan a Jev.  
4. **Tip-of-spear** — deny no autorizados; **no** congelar admitidos.  
5. **Honesty** — sin broker+pin+Bind+sensores host, “plugins” = monolito con más superficie.

---

## Parte I — Vulnerabilidades tradicionales (síntesis de research A)

> Fuente canónica: [`research/01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md`](research/01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md). Este paper **cita**; no sustituye el draft.

### I.1 Por qué persisten

En un monolito, las vulnerabilidades clásicas no son bugs aislados: son **fallos de atribución**. El atacante gana un *proceso-identidad*; el defensor pierde el *módulo-identidad*. Blast ≈ proceso-wide; señales llegan tarde; remediado = restart grande / flag grueso → tip-of-spear death.

| Estructura | Efecto |
|------------|--------|
| Shared address space / heap | Un bug contamina el organismo |
| Ambient authority | Env, Keychain, FS, IAM — a todo el código que importa |
| Import = power | Sin grant lattice |
| Feature flags gruesos | Apagar producto ≈ “seguridad” |
| Long-lived process | Corrupción y side channels acumulan |

### I.2 Taxonomía maestra T1–T12

| ID | Clase | Blast monolito | Señal tardía típica |
|----|-------|----------------|---------------------|
| **T1** | Memory safety | Proceso + credenciales ambient | Crash loops, dumps |
| **T2** | AuthN failure | Dominio de la identidad forjada | “Unknown user/device” post-daño |
| **T3** | AuthZ failure | Tenant / admin APIs | Cross-tenant en logs *después* |
| **T4** | Injection | DB / host / users | WAF o spikes de error |
| **T5** | SSRF / egress | Cloud creds, mesh, localhost | Egress dst inusual |
| **T6** | Supply-chain | Full process (código “trusted”) | SBOM *post*-deploy |
| **T7** | Config drift | Misconfig silenciosa | “Prod era debug” |
| **T8** | Privilege escalation | Host o app-admin | Nuevos admins tarde |
| **T9** | Confused deputy (colapsado) | Ambient del helper privilegiado | Llamada “legítima” interna |
| **T10** | Side channels | Confidencialidad de secretos | A menudo nunca detectado |
| **T11** | DoS / resource | App completa caída | Health flaps |
| **T12** | Secrets ambient | Todos los secretos del proceso | Secret en status/log |

Detalle de cadenas, FeatureBag bridge y anclas de teatro Abaco: ver research **A** §2–§7.

### I.3 Puente FeatureBag (sin implementar)

| Rol | Regla |
|-----|-------|
| CODE | Canaries, pin/digest, undeclared egress, rate limits — **siempre** |
| Jev (opcional) | Solo empates / novelty *después* de integrity CODE — **nunca** grant |
| Prohibido en FeatureBag | Transcripts, secretos, “I’m healthy” del módulo, `source: jev` como autoridad |

Preguntas **awkward** en monolito (G47 §2 / research A §6.4): “¿qué módulo es hostil?” sin IDs; attenuate cuando attenuate = restart. Eso **empuja** a seams Janice — no a fingir precisión.

### I.4 Teatro tip aún monolítico

Auditoría sync/pairing/HMAC, unsigned redistribute, Electron+Python acoplados: fallos de **monolito clásico** (T2–T7, T11–T12). F1 ataca la *estructura* del remediado caro; no sustituye rotar un secreto débil (CODE). Ver A §7.

---

## Parte II — Tradeoffs de plugins (síntesis de research B)

> Fuente canónica: [`research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md`](research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md). Honesty lock: plugins ≠ magia segura.

### II.1 Qué alivia un host gobernado

| Fallo tradicional | Shrink (si broker+caps+Bind) | Respuesta precisa |
|-------------------|------------------------------|-------------------|
| Ambient authority | Caps ∩ grants ∩ canal; deny-by-default | Revoke grant / unload un `plugin_id` |
| Import spaghetti | Core conoce interfaces; negocio versionado | DAG + unload offender |
| Crash de una feature | Fail-isolation (cell / Phase S cuando exista) | Breaker **por** plugin |
| Freeze por flag grueso | Flag / budgets scoped | Admitidos siguen |
| Log soup | Audit broker + deny-reason enum | Histograma → attenuate actor |
| Privilege creep | Admission seal; datos≠control | Widen solo ContractEvolution+HITL |
| Secretos en env | Handles atenuados | Revoke handle sin redeploy core |
| Confused identity | Identidad = **canal**, no body | Deny mismatch (F1 M8) |

```text
plugin → broker.authorize() → grant? → Janice ejecuta
              │
              ├─ deny: side_effect=false · audit · counter
              └─ allow: efecto atenuado · ledger
```

### II.2 Superficies nuevas S1–S8

| # | Superficie | Rotura en una línea | Mitigación CODE primaria |
|---|------------|---------------------|--------------------------|
| **S1** | Dynamic load / discovery | Paquete extra no sellado | Admission seal + pin + allowlist |
| **S2** | Hot-reload races | Half-old handlers en el bus | Quiesce→drain→swap; suspend grants |
| **S3** | Confused deputy cross-plugin | B débil pide a A privilegiado | Canal identity; child ⊆ parent |
| **S4** | Supply-chain third-party | Update malicioso / cap widen | Pin+sig+SBOM+cap-diff+HITL |
| **S5** | Shared bus / context | Flood, poison, covert channel | Schema; ACL; backpressure; broker |
| **S6** | Catalog ≠ runtime | Digests divergen | Dual digest → CODE trip |
| **S7** | Mediation bypass | Legacy / advisor-as-grant / soft-timeout | Four asserts; Atena/Jev fuera |
| **S8** | Self-reporting liars | Plugin dice “healthy” | Sensores **host-only** |

Matriz broker/pin/admission/Bind/ledger/caps: research **B** §3. **Jev no mitiga** S1–S8 como grantor — como mucho rankea novelty gris *después* de CODE.

### II.3 Cuándo el monolito gana (racional)

| Condición | Por qué monolito |
|-----------|------------------|
| Equipo 1–3 | TCB de broker/admission/pin/Bind > beneficio de blast |
| Un binario, un deploy | Sin marketplace; un SBOM |
| Sin bus multi-tenant | S5 no aparece |
| Sin discovery dinámico | S1/S2 ≈ redeploy |
| Latencia/determinismo sagrado | Hops de broker = failure modes innecesarios |
| Sin presupuesto de aislamiento | “Plugins” T0 in-process = falsa precisión |
| Amenaza ≈ solo build-time | Review+signed release basta |

**Regla:** si no financiarás broker + admission seal como producto, **no** vendas seguridad de plugins. Ship monolito chico; deja la puerta a “plugin = contrato” cuando aparezca multi-actor / marketplace.

### II.4 Scorecard

| Criterio | Monolito | Janice+broker+Bind | “Plugins” sin gobernar |
|----------|----------|--------------------|-------------------------|
| Blast de una feature | Proceso | Un plugin (si aislado) | Proceso — **peor** |
| Atribución | Débil | Fuerte | Labels falsos |
| Tip-of-spear | Congela todo | Deny; admitidos evolucionan | Caos + freeze |
| Superficies nuevas | Pocas | Muchas, mitigadas CODE | Muchas, sin mitigar |
| Advisor/LLM | Tentación guardian | Candado never grant | “Smart broker” |

**Claim de review permitido:** *“Plugins gobernados cambian un catálogo de superficie más grande por blast menor, mejor atribución y respuesta tip-of-spear — no son mágicamente más seguros.”*

---

## Parte III — Adhesión reglas Jev → pulse limpio Frontiers (síntesis de research C)

> Fuente canónica: [`research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md`](research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md). Doctrina: [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md).

### III.1 Antes / después

| Antes (trampa) | Después (adhesión) |
|----------------|--------------------|
| LLM cada 15s “¿permitir?” | CODE always; Jev solo doubt/tie |
| Jev cerca de `authorize()` | Jev consume audit; breaker ejecuta |
| Un pulse gordo por face | Platform pulse + thin adapters |
| Features con secretos / transcripts | Counters + hashes; host-trusted |
| Quarantine fácil | Alert-first; attenuate vía CODE co-fire / HITL |

### III.2 Mapa reglas → invariantes

| Regla Jev / G47 | Invariante pulse |
|-----------------|------------------|
| CODE-first | Pin miss / canary / undeclared egress / dual digest **nunca** esperan a Jev |
| Banda gris % | Jev solo doubt / tie / novelty > τ |
| Never grants | Cero `source: jev` en grant / admission / pin |
| Never authorize hot-path | 0 imports Jev/Atena en `authorize()` / pin verify |
| Never mint caps | Choice set sin `grant` / `widen` |
| `apply_ok` | `(conf ≥ 0.55) ∧ (noul ≥ 0.5) ∧ ¬candado_conflict` |
| Platform + adapters | Un cerebro; adapters = `collectWindow → FeatureBag` |
| Cadencia 60–90s | Base piloto ∈ [60, 90]; 15s = `interval_min` bajo stress |
| Tip-of-spear | Acción por `plugin_id`; security ≠ SLO breaker |

### III.3 Pipeline limpio

```text
[1] SENSOR host-trusted  →  [2] FeatureBag (counters/hashes)
         │
    ┌────┴────┐
    ▼         ▼
[3a] CODE   [3b] Jev doubt-band (apply_ok)
    └────┬────┘
         ▼
[4] Decision map fail-closed → alert | attenuate | quarantine | deny-new
    · vía breaker / authorize()-deny / unload
    · NUNCA “Jev allow → grant”
    · Janice ejecuta YA autorizado; Atena narrative OFF
```

| Salida | Piloto Anthony 2026-09-22 |
|--------|---------------------------|
| `hold` / `alert` | Vivos |
| `attenuate` | **Shadow** only |
| `quarantine` | **OFF** auto |
| `grant` / `allow` | **Nunca** desde Jev |

Si Typesafe cae → CODE-only + `jev_unavailable` — fail-open **solo** a “no llamar Jev”, **nunca** a allow.

### III.4 Por qué limpia Frontiers vs guardian@15s

| Dimensión | Guardian @15s | Pulse adherido |
|-----------|---------------|----------------|
| Ruido / FP | ~5 760 dec/día | Doubt-band + CODE trips |
| TCB | Advisor en autoridad | Broker+pin+CODE; Jev journal |
| Costo / cola | N faces × tick fijo | Adaptive + budget (piloto 40/h) |
| CI / M1–M10 | No-determinismo hot-path | Tests mediación **sin** red |
| Tip-of-spear | Quarantine → freeze cultural | Alert-first; un actor |

Comparación ROI plugin vs monolito para cablear Jev: [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) — seams tipados hacen el FeatureBag *más barato*; superficies S* lo hacen *más necesario* como ranker y *más peligroso* si se cablea como grantor.

---

## Parte IV — Mapa Bind / checklist piloto / anti-patterns / widen

> Síntesis operativa de research **C** §1–§6 + Bind portable ([`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md)). **Referencia**, no clonar runtime.

### IV.1 Bind (adhesión portable — Python Core / platform)

| Status / severidad | Runtime | Quién decide |
|--------------------|---------|--------------|
| Deny-by-default | Sin grant vivo → no efecto | CODE (`authorize()` / Bind) |
| `planned` / `blocked` | **Must not start** | CODE — no soft-start |
| medium / high | **HITL** antes de start / widen | Humano — no Atena, no Jev |
| Señal Atena / Jev | Advisory / gray-band rank | **Never** grants / attest admit |

**Pulse como plugin admitido (ley portable):**

| Campo | Valor piloto |
|-------|--------------|
| `id` | `abaco-security-pulse` (platform) |
| `role` | `observer-proposer` |
| lifecycle | `planned` → review → `installed` |
| `risk` | `medium` (alert+journal); `high` si attenuate/quarantine vivos |
| `requires_human_approval` | **true** para acciones > alert |
| caps mínimas | `audit.read`, `journal.write`, `alert.local`; `breaker.propose` shadow |
| denylist | `grant.*`, `admission.mutate`, `pin.write`, `secret.read`, `transcript.ingest`, `self_health.trust` sola |
| cadence | base 60–90s (prefer **90s** tip Deep); budget ≤ **40** Jev/h |
| adapters | thin: `adapter-deep-voice` ahora; `adapter-python-hub` **después** de sensores Phase B |

### IV.2 Checklist piloto (planned → installed)

**Lifecycle**

- [ ] Manifest `planned` + caps mínimas + denylist  
- [ ] Risk + `requires_human_approval` correctos  
- [ ] Review humano (Anthony / Integrador) → `installed`  
- [ ] Widen posterior = ContractEvolution + HITL  

**Pre-install must-pass**

1. Import graph: 0 Jev/Atena en `authorize()` / pin / admission mutate  
2. FeaturePack: counters/hashes; size cap; provenance `host`  
3. Cadence base ≥60s; no fixed 15s fleet  
4. Budget hard + fallback CODE-only  
5. Day-14 / M1–M10 PASS **sin** red Typesafe  
6. Naming roles documentados en manifest  

**Ledger mínimo:** `pulse.window` · `pulse.code_trip` · `pulse.jev_call` · `pulse.jev_result` · `pulse.action` (`via` ≠ `jev_grant`) · `pulse.jev_unavailable` · `pulse.bind_status`

### IV.3 Anti-patterns

| # | Anti-pattern | Remediation |
|---|--------------|-------------|
| 1 | Jev in `authorize()` | Consume audit only |
| 2 | Fixed 15s fleet | Base 60–90s |
| 3 | Fat pulse por face | Platform + thin adapters |
| 4 | Trust plugin self-health | Host-trusted sensors |
| 5 | Ambient secrets en features | Counters/hashes only |
| 6 | “Jev allow → grant” | Decision map sin grant |
| 7 | Auto-quarantine on first warn | Alert-first; CODE/HITL |
| 8 | Jev escribe patch/admission | Caps denylist |
| 9 | Atena narrative on hot-path | Narrative OFF |
| 10 | Pulse sustituye Phase S | Sandbox first |
| 11 | Fail-open a allow si Typesafe cae | Fail-open a CODE-only |
| 12 | Global threat % → kill core | Acción por `plugin_id` |

### IV.4 Criterios de widen (gates del piloto firmado)

Piloto: **1** app tip (Deep voice/broker), **3** questions, journal+alert, 40 Jev/h, ~90s, **sin** quarantine auto.

| Métrica | Gate |
|---------|------|
| Jev ∩ authorize/pin | **0** refs |
| Quarantine flaps | **0** (OFF) |
| M1–M10 / day-14 | PASS offline |
| Costo tip | < \$5 / semana / instancia |
| Jev en quiet | Mayoría ventanas **sin** Jev |
| Utilidad gris | ≥1 caso: choice Jev ≠ regla CODE ingenua **y** humano acuerda |
| Admitidos congelados por FP | **No** |
| Pulse vs broker | Solo **consume** audit |

```text
L0  docs + planned          ← research + este paper
L1  journal + alert         ← piloto vivo
L2  shadow attenuate
L3  attenuate + CODE co-fire
L4  quarantine + HITL
L5  multi-face adapters (python-hub) after sensors
```

**Nunca** L0→L3. **Nunca** widen porque “plugins hacen Jev más fácil.”

---

## Conclusiones

1. **Tradicional (A):** T1–T12 persisten por ambient authority + atribución débil + remediado grueso. FeatureBag monolito es *awkward*; honestidad empuja a seams, no a % globales.  
2. **Plugins (B):** Gobernados → precisión/fail-isolation/tip-of-spear; **no** magia. Adquieren S1–S8; sin mediación real son peores que un monolito chico. Monolito sigue racional bajo las condiciones §II.3.  
3. **Pulse (C):** Adherir reglas Jev limpia Frontiers: radar de duda con número encima de F1, no guardian. Platform + adapters; CODE-first; never grants.  
4. **Piloto:** Anthony 2026-09-22 fija L1 (alert+journal). Widen solo con gates §IV.4. Bind Python Core = referencia portable; wire live **después** de sensores host.  
5. **Naming law:** Jev ≠ Janice ≠ Atena — cualquier doc o PR que colapse roles está out of contract.

---

## Open questions

1. ¿Cuánto FeatureBag_monolith_v0 merece adapter real vs forzar seams plugin primero? (G47 recomienda lo segundo.)  
2. ¿Canaries de secreto débil (sync/pairing) como CODE trips de piloto — sin Jev?  
3. ¿Cómo etiquetar dualismo docs↔runtime (T7/S6) en ops sin reabrir F1?  
4. T9 monolito-colapsado vs T9 plugin-medible: ¿misma fila de journal o esquemas distintos?  
5. Umbral FP alert rate (X%/día) — fijar X en review de semana-1 del piloto.  
6. ¿Cuándo Phase S / isolation ladder basta para claim “blast = un plugin” en Deep Harnes T0/T1?  
7. Adapter `python-hub`: ¿qué sensores Bind mínimos antes de L5?  
8. ¿Un único FeatureBag schema versionado entre faces, o extensions tipadas por adapter?

---

## Bibliografía interna

| Doc | Rol en este paper |
|-----|-------------------|
| [`research/01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md`](research/01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md) | **Parte I** — taxonomía T1–T12 (fuente A, PR #39) |
| [`research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md`](research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md) | **Parte II** — alivio + S1–S8 + monolito gana (fuente B, PR #38) |
| [`research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md`](research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md) | **Parte III–IV** — adhesión, Bind, anti-patterns, widen (fuente C, PR #40) |
| [`research/README.md`](research/README.md) | Índice serie G47 A/B/C |
| [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) | Doctrina pulse PILOT (PR #36) |
| [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) | Compare ROI Jev en plugin vs monolito |
| [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) | Lock Jev ≠ Janice ≠ Atena; never grants |
| [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md) | Ley vs teatro F1–F2.1 |
| [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md) | Herencia Bind/broker para hub Python |
| [`../SECURITY.md`](../SECURITY.md) | Modelo seguridad tip (unsigned; sandbox roadmap) |
| [`../TECH-plugin-loading.md`](../TECH-plugin-loading.md) | Teatro carga UI plugins (borde B) |
| [`../contracts/CONTRACT-F1-MEDIACION-DEEP.md`](../contracts/CONTRACT-F1-MEDIACION-DEEP.md) | Doctrine delta / tip-of-spear |
| [`../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md) | `A_efectiva`; canal; M1–M10 |

---

## Changelog

| Fecha | Cambio |
|-------|--------|
| 2026-09-22 | Paper unificado Leader — síntesis A+B+C; drafts intactos como fuentes |
