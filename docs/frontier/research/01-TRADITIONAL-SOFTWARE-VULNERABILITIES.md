# Research A — Traditional (monolithic) software vulnerabilities

| Campo | Valor |
|-------|--------|
| **estado** | **DRAFT** — paper-grade research; **DOCS ONLY**; no implementación |
| **fecha** | 2026-09-22 |
| **teatro** | Abaco Frontiers / tip-of-spear · `anthony-x507/Abaco-deep-Core` |
| **serie** | G47 research track — **A** (tradicional monolítico). Hermanos: **B** plugins, **C** Jev/rules/pulse. El paper unificado lo compila Leader. |
| **fuentes internas** | [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) §2; [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md); [`JANICE_ATENA_NAMING_LAW.md`](../JANICE_ATENA_NAMING_LAW.md); [`SECURITY.md`](../../SECURITY.md); [`TECH-plugin-loading.md`](../../TECH-plugin-loading.md); [`AUDIT-2026-09.md`](../../AUDIT-2026-09.md); contratos F1; DEEPSEEK-PLUGIN-CYBERSECURITY (externo / Mind — citado por nombre cuando no está en árbol) |
| **naming** | **Jev** ≠ **Janice** ≠ **Atena**. Jev **never grants**. Este draft no inventa autoridad para Jev. |
| **alcance** | Software **tradicional monolítico**: un proceso (o pocos), imports = poder, auth middleware único, feature flags gruesos, redeploy = remediación. No es el paper de plugins. |

---

## 0 Thesis (1 page)

**Claim.** En un monolito, las clases clásicas de vulnerabilidad (memory safety, authZ/authN, injection, SSRF/egress, supply-chain, config drift, privilege escalation, confused deputy *colapsado*, side channels, DoS/resource, secrets ambient) no son “bugs aislados”: son **fallos de atribución**. El atacante gana un *proceso-identidad*; el defensor pierde el *módulo-identidad*. Por eso el blast radius es casi siempre **proceso-wide**, las señales llegan **tarde** (logs globales, CPU, “algo raro”), y el remediado es **caro** (restart grande, flag grueso, freeze tip-of-spear).

**Implicación Abaco (puente, no implementación).** El compare G47 ya dice que instrumentar un monolito para calidad FeatureBag es *recrear seams de plugin mal* ([`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) §2). Este draft fija **qué** hay que medir en el mundo tradicional — para que un radar CODE-first (y solo después Jev en banda gris) sepa qué preguntas son honestas en monolito vs cuáles son *awkward* y empujan a mediación Janice + broker.

**Anti-claims (candados):**

| No | Por qué |
|----|---------|
| “Jev decide allow/deny en el monolito” | Misma doctrina Atena: never grants; never en `authorize()` ([`JANICE_ATENA_NAMING_LAW.md`](../JANICE_ATENA_NAMING_LAW.md), pulse PILOT) |
| “Un % global de amenaza remedia el monolito” | Tip-of-spear death: freeze del organismo admitido |
| “Plugins son magia segura” | Fuera de alcance A; ver research B. Aquí solo: monolito *carece* de seams tipados |

**Vocabulary used here**

| Término | Significado en este draft |
|---------|---------------------------|
| **Monolito** | Un binario/proceso (o tight-coupled multi-thread) donde módulos comparten identity OS, memoria, env, filesystem, y a menudo un solo middleware de auth |
| **Blast radius** | Alcance efectivo tras compromiso inicial — en monolito suele ser *todo el proceso* + secretos ambient + credenciales de red del host |
| **Señal tardía** | Telemetría que aparece *después* de que el exploit ya cruzó el sink; típica en monolitos sin per-module counters |
| **FeatureBag (puente)** | Vector determinista de contadores/hashes que un Security Pulse *consumiría*; este doc solo nombra candidatos — no implementa adapters |
| **CODE vs Jev** | CODE = reglas/canaries/integrity; Jev = rankeo en duda con % — **nunca** grantor |

---

## 1 Why traditional vulns persist (economics + structure)

### 1.1 Structural reasons

| Estructura del monolito | Efecto en vulnerabilidades |
|-------------------------|----------------------------|
| **Shared address space / shared heap** | Un bug de memoria o de lógica en *cualquier* módulo contamina el resto |
| **Ambient authority** | Env vars, Keychain tokens, FS del user, IAM del host — disponibles a todo el código que importa |
| **Single process identity** | OS y red ven “la app”; no hay `plugin_id` nativo |
| **Import = power** | Añadir un `require` / `import` suele ser suficiente para alcanzar sinks; no hay grant lattice |
| **Coarse feature flags** | Remediación = apagar feature grande o reiniciar; tip-of-spear: frena admitidos |
| **Config as code-adjacent** | Drift entre “lo que CI cree” y “lo que corre” (dualismo catalog≠runtime *sin* digests por módulo) |
| **Long-lived process** | State corruption y side channels acumulan; hot-patch raro |

### 1.2 Organizational / remediation economics

| Coste | Por qué el monolito lo paga |
|-------|----------------------------|
| **Restart grande** | Un fix de auth en un módulo fuerza redeploy del organismo entero |
| **Atribución débil** | Post-mortem: “el proceso hizo X”; no “módulo Y con grant Z” |
| **Feature flags gruesos** | Apagar “sync” o “voice” mata producto; no attenuate budgets de un actor |
| **CI vs runtime gap** | SBOM en build; CVE runtime descubierta tarde; sin cap-diff por unidad |
| **FP caro** | Un false positive de quarantine ≈ downtime total → equipos desactivan sensores |
| **Debt compounding** | Cada exception “por velocidad” se vuelve ambient smuggling (imports al core) |

Esto es exactamente lo que G47 §2 llama *awkward questions* para Jev: “¿está este proceso bajo ataque?” → un score para todo; attenuate = restart o throttle all.

### 1.3 Persistence model (why class X keeps returning)

```text
incentives (ship speed)
    │
    ▼
shared ambient authority ──► more sinks reachable without grants
    │
    ▼
weak attribution ──► late signals ──► coarse remediation
    │                                    │
    ▼                                    ▼
“security = freeze” culture ◄── tip-of-spear regression (exceptions)
```

**Doctrine delta** ([`CONTRACT-F1-MEDIACION-DEEP.md`](../../contracts/CONTRACT-F1-MEDIACION-DEEP.md)): *Security ≠ stop evolution.* En monolito, la cultura por defecto *sí* detiene evolución porque no hay unload-one / revoke-one. Por eso las vulns “se arreglan” con flags y luego se reabren.

---

## 2 Taxonomy master table

Densidad: una fila = una clase. Detalle por clase en §3.

| ID | Clase | Definición corta | Cadena típica (1 línea) | Blast radius monolito | Señal tardía típica | Persistencia |
|----|-------|------------------|-------------------------|----------------------|---------------------|--------------|
| T1 | Memory safety | UAF/overflow/type confusion → RCE o corruptión | Input → unsafe parse → corrupt control flow → shell/code | Proceso + hijack de credenciales ambient | Crash loops, weird hex dumps, AV late | Languages unsafe + perf culture |
| T2 | AuthN failure | Identity wrong / missing / spoofable | Missing check → forge session → act as user | Todo lo que el “user” podía | Audit “unknown user” after damage | Middleware gaps; fail-open |
| T3 | AuthZ failure | Authenticated but over-privileged | AuthN ok → missing object check → IDOR/escalate | Dominio completo del recurso | Access logs show cross-tenant *después* | Role soup; ambient “admin” |
| T4 | Injection | Untrusted data → interpreter | Input → concat → SQL/OS/HTML/LLM → exfil/RCE | DB / host / users | WAF or error spikes late | Stringly APIs; ORM escape hatches |
| T5 | SSRF / egress | Server fetches attacker URL | User URL → internal fetch → IMDS/metadata/LAN | Cloud creds, mesh peers, localhost admin | Unusual egress dst after breach | “URL helper” convenience |
| T6 | Supply-chain | Compromised dep / build / update | Typosquat or backdoored release → load at boot | Full process (same as trusted code) | SBOM alert *post*-deploy | Trust once, update forever |
| T7 | Config drift | Declared ≠ running | Stale flag / wrong secret / unsigned build | Misconfig-wide (often silent open) | Incident reveals “prod was debug” | Dual catalog/runtime without digests |
| T8 | Privilege escalation | Low → high within app/OS | Bug → write controlled path → SUID/admin API | Host or app-admin | New admin accounts noticed late | Confused ambient + weak boundaries |
| T9 | Confused deputy (monolith form) | Privileged code acts for untrusted input | Untrusted request → privileged helper → abuse | Privileged helper’s full ambient | “Legitimate” internal call in logs | Collapse of A/B into one identity |
| T10 | Side channels | Leak via timing/cache/logs/errors | Probe → measure → recover secret/bit | Confidentiality of secrets/keys | Rare; often never detected | Shared process resources |
| T11 | DoS / resource | Exhaust CPU/mem/FD/locks | Amplify request → deadlock/OOM → availability loss | Whole app unavailable | Health checks flap | Shared pools; no per-module quotas |
| T12 | Secrets ambient | Secrets reachable without broker | Env/disk/log → any module reads → exfil | All secrets in process + logs | Secret in public status/log scrape | Convenience + missing redaction |

**Abaco tip anchors (examples, not exhaustive):** unsigned redistribute ([`SECURITY.md`](../../SECURITY.md), [`ADR-003`](../../ADRs/ADR-003-unsigned-build.md)); sync HMAC / pairing / path traversal patterns in [`AUDIT-2026-09.md`](../../AUDIT-2026-09.md); renderer isolation positives in [`SECURITY.md`](../../SECURITY.md); plugin *loading* as product surface in [`TECH-plugin-loading.md`](../../TECH-plugin-loading.md) (border with research B).

---

## 3 Class deep-dives

Cada subsección: **qué es** · **cómo se rompe** · **blast radius** · **señales tardías** · **por qué persiste en monolito** · **señales FeatureBag candidatas** (puente).

### 3.1 T1 — Memory safety

**Qué es.** Uso incorrecto de memoria (buffer overflow, use-after-free, double-free, type confusion, unbounded copy). En managed languages (Python/JS) el clasificador se estrecha a: native extensions, WASM bridges, Electron/Chromium bugs, deserialization gadgets, prototype pollution (JS), y corruptión lógica de estructuras compartidas.

**Cadena de explotación típica (monolito).**

```text
1. Attacker controls length/type of input at a sink (parser, image, IPC frame)
2. Unsafe native path or polluted prototype mutates shared object
3. Control flow / vtable / callback corrupted OR privilege object swapped
4. Arbitrary code OR data-only attack (flip auth flag in shared heap)
5. Persist via ambient secrets / write to durable runtime/
```

**Blast radius.** Proceso completo. En Electron monolito: main+renderer si isolation falla; en Python core embebido: mismo intérprete, mismos threads ([`ARCHITECTURE.md`](../../ARCHITECTURE.md) — shell + core + sync en un organismo acoplado).

**Señales tardías.**

| Señal | Por qué llega tarde |
|-------|---------------------|
| Crash / segfault / FATAL Electron | Ya hubo corruptión |
| Heap spray patterns in dumps | Post-mortem |
| Sudden native addon load | Si no hay allowlist de native modules |

**Por qué el monolito encarece remediado.** No hay “unload the image parser plugin”; hay rebuild + full restart. Feature flag “disable uploads” es grueso. Atribución: crash en proceso, no en unidad con digest.

**FeatureBag bridge (candidatos CODE-first).**

| Feature | Tipo | Notas |
|---------|------|-------|
| `native_crash_count` | counter | CODE trip inmediato |
| `unexpected_native_module_load` | event+hash | allowlist digest |
| `ipc_framing_reject_rate` | rate | proto pollution / deep JSON |
| `oom_killer_events` | counter | overlap T11 |

Jev **solo** si empate “crash por deploy vs crash por exploit” *después* de CODE integrity — nunca para “allow this native module.”

---

### 3.2 T2 — Authentication (AuthN) failure

**Qué es.** Fallo en *quién eres*: missing auth, broken session, predictable tokens, spoofable identity headers (`X-Forwarded-For`), QR/pairing without secret binding, default shared secrets.

**Cadena típica.**

```text
1. Endpoint missing Depends/auth OR trust client-supplied identity
2. Attacker forges token / replays / spoofs forwarded-for
3. Session accepted as peer/user/device
4. Follow-on AuthZ irrelevant — identity already wrong
```

**Ejemplo teatro (histórico / auditoría).** [`AUDIT-2026-09.md`](../../AUDIT-2026-09.md) §6.1: pairing sin auth fuerte; `X-Forwarded-For` spoofeable; sync HMAC derivado de constante — AuthN del mesh *colapsa* a “conoce el fuente.” [`SECURITY.md`](../../SECURITY.md) documenta el *modelo deseado* (HMAC, UUID nodo, 0600) — la gap docs↔runtime es ella misma T7.

**Blast radius.** Todo el dominio de la identidad forjada: peers sync, devices, admin APIs.

**Señales tardías.** “Unknown device” en logs; divergencia de ledger; usuarios reportan datos ajenos.

**Persistencia.** Fail-open middleware (“si no hay token, modo dev”); secretos de desarrollo que llegan a prod; un solo middleware que “casi” cubre todas las rutas.

**FeatureBag bridge.**

| Feature | CODE vs Jev |
|---------|-------------|
| `authn_fail_rate` z-score | CODE warn; Jev triage severity |
| `identity_spoof_header_hits` | CODE deny pattern |
| `default_or_weak_secret_marker` | CODE hard trip (canary) |
| `pairing_mint_rate` | CODE rate-limit |

---

### 3.3 T3 — Authorization (AuthZ) failure

**Qué es.** Sabes *quién* es, pero no *qué puede*. IDOR, missing object-level checks, role confusion, client-chosen `device_type` que escala permisos.

**Cadena típica.**

```text
1. AuthN succeeds for low-priv principal
2. Handler trusts body fields for role/resource id
3. Read/write cross-tenant or escalate capability
4. Persist or exfil under “legitimate” session
```

**Ejemplo teatro.** AUDIT: `device_type ∈ {mac,windows,linux}` concedía `read_files`/`write_files` — el cliente elige su privilegio. Contraste F1: `A_efectiva = ∩(tarea, plugin, delegación, política)` y **identidad = canal**, no body ([`CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md)). El monolito sin broker *no tiene* esa intersección como objeto runtime.

**Blast radius.** Tenant data plane; a menudo admin APIs si roles son strings globales.

**Señales tardías.** Access logs con resource IDs ajenos; compliance scan post-facto.

**Persistencia.** “Estamos autenticados” confundido con “estamos autorizados”; tests que solo cubren happy path.

**FeatureBag bridge.**

| Feature | Nota monolito |
|---------|---------------|
| `authz_deny_rate` global | Existe, pero **sin** `plugin_id` |
| `cross_tenant_access_suspect` | Requiere resource-owner tagging — caro de retrofit |
| `role_mutation_events` | Si roles viven en DB mutable |

Pregunta Jev *awkward*: “¿este acceso es IDOR?” sin object-owner labels → Jev alucina; CODE necesita el label primero.

---

### 3.4 T4 — Injection

**Qué es.** Datos no confiables interpretados como código/consulta: SQL, OS command, LDAP, template, HTML/JS XSS, header injection, y en stacks LLM: prompt/tool injection (dato → control).

**Cadena típica.**

```text
1. Untrusted string reaches concat / shell / eval / template / tool-arg
2. Interpreter boundary crossed
3. Read secrets / write files / call privileged APIs
4. Optional: pivot to T5/T8
```

**Monolito specifics.** Un sink en un módulo “lejos” del HTTP handler sigue siendo alcanzable por shared helpers. En Abaco theater: skills generator enviando datos sin redactar a APIs externas (AUDIT) = injection/exfil híbrido. F1 doctrine: **datos ≠ control** — skills/docs/memory/tool-results no entran al plano de control ([`CONTRACT-F1-ADMISSION-IMMUTABLE.md`](../../contracts/CONTRACT-F1-ADMISSION-IMMUTABLE.md)).

**Blast radius.** Del intérprete tocado: DB, shell host, browser session, LLM tool loop.

**Señales tardías.** 500s con SQL fragments; CSP reports; “model did unexpected tool.”

**Persistencia.** Stringly APIs; “solo interno”; ORM raw queries; LLM features shipped without pin/witness (F1.5 existe precisamente para tools externos).

**FeatureBag bridge.**

| Feature | CODE |
|---------|------|
| `shell_true_or_exec_hits` | hard deny inventarios |
| `raw_sql_counter` | static+runtime |
| `schema_pin_miss` (MCP/tools) | F1.5 CODE |
| `secret_marker_in_outbound_prompt` | canary |

---

### 3.5 T5 — SSRF / egress abuse

**Qué es.** El servidor (o el proceso desktop) realiza requests hacia destinos controlados por el atacante: cloud metadata (IMDS), localhost admin, Tailscale peers, link-local.

**Cadena típica.**

```text
1. App accepts URL / webhook / “fetch preview” / avatar URL
2. Server-side fetch without allowlist / no block of link-local
3. Reach 169.254.169.254 or 127.0.0.1 admin or mesh peer
4. Steal cloud role / forge local API / pivot mesh
```

**Monolito + Abaco mesh.** Sync sobre Tailscale confía en WireGuard *de red*, pero el *proceso* que puede hablar HTTP local sigue siendo un SSRF pivot si algún módulo fetcha URLs de usuario ([`SECURITY.md`](../../SECURITY.md), [`ADR-004`](../../ADRs/ADR-004-tailscale.md)). Desktop: `security-policy.ts` restringe permisos de ventana a harness/trusted URLs — patrón correcto de **egress/permission allowlist** a nivel UI; el análogo server-side debe existir para todo fetch.

**Blast radius.** Credenciales cloud, peers HMAC, localhost control planes.

**Señales tardías.** Unusual destinations in host firewall; IMDS access logs; peer seeing forged envelopes.

**Persistencia.** “URL helpers”; preview features; SSRF tests ausentes porque “no somos SaaS multi-tenant.”

**FeaturePack bridge.**

| Feature | Prioridad |
|---------|-----------|
| `egress_dst_class_histogram` (public/rfc1918/link-local/imds) | CODE |
| `undeclared_egress_bytes` | CODE trip (pulse doc) |
| `localhost_admin_hit_count` | CODE |

G47: “global egress to IMDS” es pregunta **válida en monolito y plugin** — CODE trip, no diferenciador Jev.

---

### 3.6 T6 — Supply-chain

**Qué es.** Código de terceros o del pipeline de build/update se vuelve hostil: typosquat, dependency confusion, compromised maintainer, malicious postinstall, unsigned redistribute, rug-pull update.

**Cadena típica.**

```text
1. Trust established once (npm/pip/GitHub Release)
2. Malicious version enters lockfile OR user installs unsigned ZIP
3. Code runs with full ambient of the monolith at boot
4. Optional persistence in runtime/ or updater path
```

**Teatro Abaco.** [`SECURITY.md`](../../SECURITY.md) / ADR-003: **unsigned build** → redistribución maliciosa trivial. Auto-updater apuntando a feed GitHub ([`ARCHITECTURE.md`](../../ARCHITECTURE.md)) amplifica T6 si no hay firma/notarización. [`TECH-plugin-loading.md`](../../TECH-plugin-loading.md): patch-package + mirror de closure — supply-chain *de face*; investigado en research B, pero el **monolito shell** ya carga lo que el patch inyecta.

**Blast radius.** Máximo: el update *es* el proceso.

**Señales tardías.** VirusTotal / SBOM CVE weeks later; “behavior changed after update.”

**Persistencia.** Speed of deps; “pin majors only”; signing deferred (ADR-003 aceptado temporalmente — deuda consciente).

**FeatureBag bridge.**

| Feature | CODE |
|---------|------|
| `artifact_signature_valid` | hard |
| `sbom_cve_gate` | CI |
| `update_feed_url_digest_match` | dualism catalog≠runtime |
| `post_update_behavior_novelty` | **gray** → optional Jev rank hold vs alert |

Jev es **herramienta débil** pre-admit (G47 §1.3); post-admit novelty ranking sí.

---

### 3.7 T7 — Config drift / catalog≠runtime (monolith dualism)

**Qué es.** Lo declarado (docs, CI flags, env templates, version catalog) diverge de lo que el proceso ejecuta (debug secrets, wrong ports, feature flags, unsigned bits).

**Cadena típica.**

```text
1. Config path A documented; runtime reads path B or default
2. Operator believes hardened; attacker finds open default
3. Exploit uses the open door (often AuthN/AuthZ/secret)
```

**Ejemplos teatro.** AUDIT: docs afirman sync “COMPLETO” mientras `get_state()` crashea y secreto default es determinista; FEATURES_STATUS vs realidad; `SECURITY.md` describe 0600/HMAC mientras hallazgos muestran gaps. G47 §1.5 nombra el dualismo catalog≠runtime como *plugin-native*, pero el monolito lo sufre **sin digests por unidad** — peor para remediación porque no hay `plugin_id` digests que comparar.

**Blast radius.** Silencioso y amplio: toda función que creyó estar detrás de un control.

**Señales tardías.** Incident + “oh, we were on the debug secret.”

**Persistencia.** Docs as wishful thinking; no runtime attestation; no pin of config digest in health.

**FeatureBag bridge.**

| Feature | Esencial |
|---------|----------|
| `config_digest` vs `expected_digest` | CODE |
| `debug_or_default_secret_active` | CODE canary |
| `doc_claim_vs_probe_mismatch` | ops — optional |

---

### 3.8 T8 — Privilege escalation

**Qué es.** Pasar de low-priv a high-priv dentro de la app o del OS: writable update path, symlink races, admin API exposed, compaction `force=True` archiving open tickets via HTTP, client-chosen roles (overlap T3).

**Cadena típica.**

```text
1. Find writable control plane (config, plugin dir, updater, admin route)
2. Plant payload or flip role bit
3. Restart or hot path loads elevated authority
4. Abuse ambient secrets at new privilege
```

**Blast radius.** App-admin → host user → (raro) root si hay SUID helpers.

**Señales tardías.** New admin users; unexpected binary hashes; “force compact wiped prod.”

**Persistencia.** Admin endpoints “temporales”; Electron main powerful by design; sync daemon in-process ([`SECURITY.md`](../../SECURITY.md) roadmap: mover a proceso separado — hoy no).

**FeatureBag bridge.** `admin_route_hit_rate`, `role_escalation_event`, `writable_control_plane_probe` (CODE).

---

### 3.9 T9 — Confused deputy (monolith version)

**Qué es.** Un componente privilegiado actúa *en nombre de* entrada no confiable, transfiriendo su ambient authority. En plugins, A y B son medibles (dos `plugin_id`). En monolito, **A y B colapsan** a una sola identidad de proceso — el deputy es “el helper interno” y el principal es “el request,” pero los logs no distinguen bien.

**Cadena típica.**

```text
1. Untrusted input asks privileged helper to “do the thing”
2. Helper has ambient FS/network/Keychain
3. Helper does not attenuate to caller’s rights (no grant lattice)
4. Effect succeeds with helper’s power
```

**Axiom (DEEPSEEK-PLUGIN-CYBERSECURITY / G47):** *“the host can do it” never means “this plugin can do it.”* En monolito la frase degenera a: *“the process can do it” always means “this request can do it”* — false.

**Blast radius.** Todo el ambient del helper (casi siempre = app completa).

**Señales tardías.** “Internal API call looked legit”; hard for Jev to ask crisp `noul` (G47 §7 #2 awkward).

**Persistencia.** Shared services folders; god-objects; no channel-bound identity.

**FeatureBag bridge (honest).** Sin reinventar `plugin_id`, lo máximo es:

| Feature | Límite |
|---------|--------|
| `privileged_sink_call_rate` by **route** | coarse |
| `channel_vs_body_identity_mismatch` | only if you invent channels |
| — | Mejor remedio estructural: mediación F1, no más features |

---

### 3.10 T10 — Side channels

**Qué es.** Fuga por timing, cache, errores diferenciales, logs, contadores observables, power (raro en desktop).

**Cadena típica.**

```text
1. Attacker probes endpoint with crafted inputs
2. Measures time / error type / log line
3. Recovers bit(s) of secret or user existence
```

**Monolito.** Shared CPU caches and shared log pipelines make isolation hard; redaction gaps ([`SECURITY.md`](../../SECURITY.md) markers) son side channels de *contenido*.

**Blast radius.** Confidencialidad (secrets, user enumeration).

**Señales tardías.** Casi nunca; necesita hunting activo.

**FeatureBag bridge.** `auth_error_type_histogram` (CODE normalize errors); avoid shipping high-res timing to clients.

---

### 3.11 T11 — DoS / resource exhaustion

**Qué es.** Negar disponibilidad: CPU, memoria, FDs, locks, event-loop blocking, bus flood (monolito: thread pool / asyncio loop).

**Cadena típica.**

```text
1. Amplify expensive path (STT sync on event loop, huge upload, zip bomb)
2. Exhaust shared pool / deadlock Lock
3. Health fails; all features die together
```

**Ejemplos teatro.** AUDIT: uploads deadlock `Lock` no reentrante; voice `/stt` bloqueante en event loop; sync sin `Content-Length` limits. En monolito, **no hay cgroup por módulo** — un path tumba el organismo ([`SECURITY.md`](../../SECURITY.md): plugins Python same process).

**Blast radius.** Availability total del producto.

**Señales tardías.** SLO burn, restart loops — después del daño a usuarios.

**FeatureBag bridge.** `event_loop_lag_p99`, `lock_wait_ms`, `request_amplification_ratio`, `fd_count` — CODE breakers; Jev solo empate alert vs restart.

---

### 3.12 T12 — Secrets ambient

**Qué es.** Secretos disponibles por env, disco plano, logs, status endpoints, transcripts, memory dumps — sin broker de capacidades.

**Cadena típica.**

```text
1. Secret placed in env / ~/.file / log for convenience
2. Any module (or XSS/log scrape/backup zip) reads it
3. Exfil via egress or sync envelope or LLM prompt
```

**Teatro.** [`SECURITY.md`](../../SECURITY.md): qué NUNCA en disco plano; redaction markers; Keychain para API keys — modelo correcto. AUDIT: tokens en `/tmp`, secretos sin 0600, generator sin redactar. Ambient secrets son el **combustible** de T1–T9: sin ellos el blast radius baja.

**Blast radius.** Unión de todos los secretos del proceso.

**Señales tardías.** Secret scanning; canary tokens en GitHub; “key appeared in status JSON.”

**FeatureBag bridge.**

| Feature | CODE |
|---------|------|
| `canary_token_hit` | immediate |
| `secret_marker_in_public_status` | test already cited in SECURITY |
| `chmod_violation_on_secret_paths` | host integrity |

---

## 4 Exploit-chain patterns that cross classes (monolith kill chains)

Las clases raramente viajan solas. Patrones recurrentes:

| Kill chain | Clases | Por qué el monolito las encadena fácil |
|------------|--------|----------------------------------------|
| **Forge → exfil** | T2/T3 → T12 → T5 | Una identidad falsa abre ambient secrets y egress |
| **Inject → escalate** | T4 → T8 → T12 | Shell/SQL escribe control plane |
| **Update → own** | T6 → T7 → all | Unsigned/malicious update *is* RCE with trust |
| **Exhaust → bypass** | T11 → T2 | Fail-open under load; skip auth “to stay up” |
| **Deputy → SSRF** | T9 → T5 | Privileged fetcher serves untrusted URL |
| **Drift → auth break** | T7 → T2 | Debug HMAC in “prod” |

```text
                    ┌──────── T6 supply-chain ────────┐
                    ▼                                 │
Untrusted input → T4/T9 sink → shared ambient (T12) ─┴→ T5 egress / T8 escalate
        │                      │
        └─ T2/T3 identity ─────┘
                    │
                    ▼
              T11 if noisy; T10 if quiet probe
```

**Tip-of-spear lesson.** Romper la cadena en monolito exige **controles en sinks + no ambient**; en Abaco la respuesta estructural es mediación (grants) + Phase S (aislamiento) — no un % de Jev.

---

## 5 Remediation cost matrix (why fixes are expensive)

| Remediation lever | Costo en monolito | Efecto tip-of-spear | Alternativa plugin/broker (referencia, no scope A) |
|-------------------|-------------------|---------------------|-----------------------------------------------------|
| Restart / redeploy | Alto (todo el org.) | Congela admitidos durante ventana | Unload one actor |
| Global feature flag | Medio–alto | Apaga producto entero | Attenuate budgets per grant |
| WAF / edge rule | Medio | No cubre desktop/local | Host allowlists + broker |
| Patch dependency | Medio | Espera ciclo release | Cap-diff + ring + revoke |
| Add auth middleware | Alto retrofit | Riesgo fail-open gaps | `authorize()` único desde día 0 |
| Secret rotation | Alto (ambient copies) | Downtime sync/peers | Brokered secrets, short TTL |
| Quarantine “the app” | Muy alto | Tip-of-spear death | Quarantine plugin cell |
| Post-incident forensics | Alto (weak attribution) | Lento | Audit con `plugin_id` / channel |

**Falsos positivos.** G47: en monolito el volumen de FP puede ser menor, pero **el impacto por FP es mayor** — por eso los equipos apagan sensores (PIONERO trap / pulse doc). Un radar que quarantine el monolito entero enseña a bypass → ambient smuggling.

---

## 6 Signals a security radar wants (FeatureBag bridge)

### 6.1 Design constraints (from pulse PILOT — apply to monolith)

Reutilizar doctrina de [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) **sin** implementar:

1. Host-collected sensors; no confiar en self-report del código sospechoso.  
2. Features = counters/hashes capped; **no** raw secrets/transcripts.  
3. CODE always; Jev only doubt/tie; `apply_ok` thresholds; **never grants**.  
4. Alert-first; no auto-quarantine del organismo sin CODE co-fire / HITL.  
5. Adaptive cadence (base ≥60–90s); no 15s guardian fleet.

### 6.2 Monolith FeatureBag candidate schema (docs only)

```text
FeatureBag_monolith_v0 (conceptual)
├── identity: { app_id, instance_id, config_digest, binary_digest }
├── authn: { fail_rate, spoof_header_hits, weak_secret_canary }
├── authz: { deny_rate, cross_tenant_suspect }          # weak without labels
├── injection: { sink_reject_rate, schema_pin_miss }
├── egress: { dst_class_hist, undeclared_bytes, imds_hits }
├── supply: { signature_ok, sbom_gate, update_novelty }
├── resource: { cpu, mem, fd, loop_lag, lock_wait, crash }
├── secrets: { canary_hits, public_status_marker_hits }
└── provenance: { sensor_version, window_t0, window_t1 }
```

### 6.3 Mapping: class → primary signals → CODE vs gray

| Class | Primary signals | CODE hard | Gray (optional Jev) |
|-------|-----------------|-----------|---------------------|
| T1 | crashes, native loads, IPC rejects | yes | deploy vs exploit novelty |
| T2 | authn fails, canary weak secret | yes | — |
| T3 | deny rate, cross-tenant | partial | only with owner labels |
| T4 | sink rejects, pin miss | yes | — |
| T5 | dst class, IMDS | yes | — |
| T6 | signature, SBOM | yes | post-update behavior mix |
| T7 | digest mismatch | yes | severity triage |
| T8 | admin hits, role mutate | yes | — |
| T9 | privileged sink by route | weak | awkward — prefer structural fix |
| T10 | error normalization | hygiene | rare |
| T11 | lag, locks, OOM | breakers | alert vs restart tie |
| T12 | canaries, chmod, status | yes | — |

### 6.4 Honest monolith questions for Jev (vs awkward)

| Viable (still limited) | Awkward (don’t pretend) |
|------------------------|-------------------------|
| Global IMDS egress severity (after CODE) | “Which module is hostile?” without module IDs |
| Post-deploy novelty vs attack (counters only) | Per-actor attenuate when attenuate=restart |
| Alert vs hold on resource exhaustion tie | Confused-deputy `noul` without two-actor model |
| Rank journal incidents for human | Grant / widen / open circuit on whole app |

### 6.5 What NOT to put in FeatureBag

| Prohibido | Motivo |
|-----------|--------|
| Raw transcripts / tool results | Injection into advisor; datos≠control |
| Secrets / Keychain material | T12 amplification |
| Free-text plugin “I’m healthy” | Lying sensor |
| `source: jev` as authority | Candado naming |
| Per-tick authorize consultation | Breaks F1; non-determinism |

---

## 7 Abaco theater lens (traditional surfaces still present)

Aunque Frontiers empuja a Janice + broker, el tip **aún contiene** superficies monolíticas:

| Superficie | Doc | Clases |
|------------|-----|--------|
| Electron shell + Python core + sync acoplados | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) | T1,T11,T12 |
| Unsigned redistribute | [`SECURITY.md`](../../SECURITY.md), ADR-003 | T6,T7 |
| HMAC mesh / pairing / uploads / voice paths | [`AUDIT-2026-09.md`](../../AUDIT-2026-09.md) | T2,T3,T4,T5,T11,T12 |
| Renderer isolation positives | [`SECURITY.md`](../../SECURITY.md) | mitiga XSS→T8 |
| Window permission allowlist | `desktop/.../security-policy.ts` | mitiga T5/UI |
| Plugin loader/patch overlay | [`TECH-plugin-loading.md`](../../TECH-plugin-loading.md) | frontera → research B |
| In-process Python plugins | [`SECURITY.md`](../../SECURITY.md) sandbox gap | T9,T11 blast |

**Lectura tip-of-spear:** los hallazgos de auditoría no son “fallos de plugins”; son **fallos de monolito clásico** (auth, secretos, DoS, path traversal). La mediación F1 ataca la *estructura* que hace caros esos remediados; no sustituye rotar un HMAC débil (CODE).

---

## 8 Why “folders + import = power” loses to mediation (bridge only)

| Propiedad | Monolito tradicional | Meta Frontiers (ley, no este PR) |
|-----------|----------------------|----------------------------------|
| Authority | Ambient import | `A_efectiva` intersection |
| Identity | Process / user session | Channel-bound |
| Remediation | Restart / coarse flag | Unload / revoke / attenuate |
| Attribution | Request-id maybe | `plugin_id` × grant × reason |
| Advisor | Tempting LLM guardian | Atena/Jev outside authorize |
| Evolution | Security freezes flags | Deny unauth’d; don’t freeze admitted |

Este draft **no** implementa mediación. Solo fija el inventario de vulns tradicionales que el paper Leader contrastará con B/C.

---

## 9 Open questions for Leader (compilation hooks)

1. ¿Cuánto del FeatureBag_monolith_v0 merece adapter real vs “force plugin seams first”? (G47 recomienda lo segundo.)  
2. ¿Canaries de secreto débil en sync/pairing como CODE trips de piloto — sin Jev?  
3. ¿Cómo etiquetar dualismo docs↔runtime (T7) en el paper unificado sin reabrir F1?  
4. Research B debe contrastar T9 monolith-collapse vs T9 plugin-measurable.  
5. Research C debe mapear solo la columna “Gray (optional Jev)” de §6.3 — nunca CODE rows.

---

## 10 Fuera de alcance

- Implementar Security Pulse, adapters, o FeatureBag runtime.  
- Editar drafts B/C (`02-PLUGIN-VULN-TRADEOFFS.md`, `03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md`).  
- Editar [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md), [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md), [`JANICE_ATENA_NAMING_LAW.md`](../JANICE_ATENA_NAMING_LAW.md).  
- Merge a `main`; grants inventados para Jev; paper unificado.  
- Exploit PoCs o código ofensivo — este doc es taxonomía y señales, no cookbook.

---

## Cross-links

| Doc | Rol |
|-----|-----|
| [`../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) | Compare; §2 monolito awkward |
| [`../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) | Pulse PILOT; FeatureBag doctrine |
| [`../JANICE_ATENA_NAMING_LAW.md`](../JANICE_ATENA_NAMING_LAW.md) | Naming lock |
| [`README.md`](README.md) | Índice research A/B/C |
| [`../../SECURITY.md`](../../SECURITY.md) | Modelo seguridad tip |
| [`../../TECH-plugin-loading.md`](../../TECH-plugin-loading.md) | Loader face (borde B) |
| [`../../AUDIT-2026-09.md`](../../AUDIT-2026-09.md) | Hallazgos monolito concretos |
| DEEPSEEK-PLUGIN-CYBERSECURITY | Fuente externa / Mind (deputy axiom) — no en árbol al 2026-09-22 |

---

## Changelog draft

| Fecha | Cambio |
|-------|--------|
| 2026-09-22 | Initial research A draft — taxonomy T1–T12, kill chains, remediation costs, FeatureBag bridge |
