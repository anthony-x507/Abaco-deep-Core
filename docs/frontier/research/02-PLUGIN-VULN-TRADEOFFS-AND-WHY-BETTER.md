# G47 research B — Plugin vulnerability tradeoffs (why better when governed)

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — borrador de investigación; **no** implementación; **no** merge automático |
| **fecha** | 2026-09-22 |
| **serie** | G47 research — **B** (hermanos: A=`01` traditional, C=`03` Jev rules; **no** paper unificado) |
| **teatro** | Plugin Frontiers / `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **naming** | **Jev** ≠ **Atena** ≠ **Janice** — Jev/Atena never grant; Janice = runtime |
| **Bind (Python Core, referencia)** | deny-by-default; `planned`/`blocked` no start; medium/high → human approval; Atena/Jev never grants |
| **honesty lock** | Plugins **≠** “más seguro mágicamente”. Claim permitido: **más preciso / fail-isolation / atribución** *si* broker+caps+Bind gobiernan. Claim prohibido: “plugins solucionan seguridad”. |

---

## 0 Thesis (one page)

**Traditional monoliths** concentrate power: one process identity, one redeploy unit, one blast radius. Many classic vulns (ambient authority, tangled imports, “everything can call everything”) are *structurally hard to see* and *structurally hard to attenuate* without restarting the whole organism.

**Plugin architecture** (Janice runtime + broker F1 + capability manifests + Bind doctrine) does **not** delete vulnerability. It **moves** it:

| What shrinks | What grows |
|--------------|------------|
| Ambient blast of a single bad module | Dynamic discovery / hot-reload races |
| “Who did this?” attribution fog | Confused-deputy across plugins |
| Coarse kill (restart monolith) | Third-party supply-chain / marketplace |
| One authz story for the whole app | Shared bus / shared context abuse |
| — | Catalog ≠ runtime dualism |
| — | Mediation bypass temptation |
| — | Self-reporting liars |

**Governed well**, plugins win on **tip-of-spear**: deny unauthenticated / unauthorized effects without freezing admitted actors; unload / revoke / attenuate **one** plugin instead of freezing product evolution. **Governed poorly** (labels without broker, caps without pin, load without admission seal, Jev/Atena near `authorize()`), plugins are *worse* than a small monolith — more surfaces, same process blast, false precision.

```text
                    TRADITIONAL                         GOVERNED PLUGINS
                 ┌─────────────────┐                 ┌──────────────────────┐
  power shape    │ one ambient blob│                 │ many contracts + caps│
  attribution    │ fuzzy logs      │                 │ plugin_id × canal    │
  response       │ restart / freeze│                 │ unload one actor     │
  new surfaces   │ fewer           │                 │ many (see §2)        │
  security claim │ “simpler TCB”   │                 │ “precise if governed”│
                 └─────────────────┘                 └──────────────────────┘
```

**Verdict line:** Prefer plugins when you need multi-actor evolution, marketplace/third-party, or per-actor fail-isolation — and you will fund CODE (broker, pin, admission, Bind, ledger, min caps). Prefer a monolith when one binary, one team, no marketplace is enough. Never sell plugins as magic armor.

---

## 1 Traditional vulns that plugins *alleviate* (when governed)

Honesty first: “alleviate” means **shrink blast radius**, **improve attribution**, or **enable precise response** — not “CVE disappears.” Without Janice mediation + Bind, plugin *labels* alone do nothing.

| Traditional vuln / failure mode | How a governed plugin host shrinks blast | Attribution gain | Per-plugin unload / revoke / attenuate |
|---------------------------------|------------------------------------------|------------------|----------------------------------------|
| **Ambient authority** (“host can do X ⇒ module can do X”) | Caps ∩ grants ∩ canal; Bind deny-by-default so undeclared effects never start | Audit chain carries `plugin_id` + channel + grant id | Revoke live grant ≤1s (F1 M7); unload one plugin; leave core + admitidos |
| **Import spaghetti / god-module** | Core knows **interfaces**; business lives in versioned plugins; no silent cross-imports for sinks | Call edges declared in dep DAG / manifest | Unload offender; dep graph shows who else to check |
| **Process-wide crash from one feature** | Fail-isolation (curso L6): one plugin crash ≠ core death (Phase S / strangler cell when present) | Crash counters tagged per plugin | Kill/breaker **por plugin**; tip-of-spear: don’t freeze fleet |
| **Coarse feature-flag freezes product** | FeatureFlag / breaker scoped to one `plugin_id` | Which flag flipped is in ledger | Attenuate budgets / unload one actor vs “security mode” global |
| **Log soup / weak incident response** | Host-collected broker audit: allow/deny reason enum, four asserts | Deny-reason histogram per plugin | Human or CODE maps reason → revoke/attenuate that actor |
| **Privilege creep via “just one more import”** | Admission seal + datos≠control: skills/docs/memory cannot widen caps | Cap-diff visible at admit / update | Cap widen only via ContractEvolution + HITL; else deny |
| **Shared secrets in env for everything** | Secrets brokered; plugins get attenuated handles, not ambient Keychain dump | Egress / secret-touch events per plugin | Revoke handle; rotate without redeploying core |
| **All-or-nothing redeploy for a bad line** | Hot path: revoke + unload; cold path: pin rotate at review-time | Runtime digest vs catalog digest per plugin | Tip-of-spear: deny unauth’d; admitted keep shipping |
| **Confused identity in monolith logs** | Identity = **canal**, not body claim (F1 M8) | Channel mismatch is a first-class deny | Spurious body `plugin_id` ignored — no false grant |
| **SLO breaker = security breaker** | Separate security breakers from SLO (pulse doctrine) | Security vs latency signals tagged | Quarantine one noisy plugin without killing UX for all |

### 1.1 Mechanism map (why the table works)

```text
Traditional sink call
  module → OS/API directly
  identity ≈ process
  response ≈ restart

Governed Janice path
  plugin → broker.authorize() → grant? → Janice executes
                │
                ├─ deny: side_effect=false · audit · counter
                └─ allow: attenuated effect · ledger
  identity = canal ∩ manifest caps ∩ task grant ∩ policy
  response = unload | revoke | attenuate | (HITL widen)
```

| Control | Role in shrinking traditional blast |
|---------|-------------------------------------|
| **Broker F1** | Single deterministic grantor; timeout/throw = deny |
| **Caps / manifests** | Declared ceiling before code runs |
| **Bind (Python Core ref.)** | Deferred contract meets runtime: `planned`/`blocked` never start; medium/high need human approval |
| **Admission seal** | Session graph immutable; datos≠control |
| **Ledger / audit** | Attribution for IR and for tip-of-spear decisions |
| **Min caps** | Least privilege per plugin; marketplace default restrictive |

**Bind doctrine (portable reference — Python Core Phase B):**

| Bind status / severity | Runtime behavior | Who decides |
|------------------------|------------------|-------------|
| deny-by-default | No effect without live grant | CODE (`authorize()` / Bind) |
| `planned` / `blocked` | **Must not start** | CODE — no soft-start |
| medium / high risk bind | **Human approval** before start | HITL — not Atena, not Jev |
| Atena / Jev signal | Advisory / gray-band rank only | **Never** grants, never attest admit |

---

## 2 New surfaces plugins *acquire*

These are **structurally stronger** (or uniquely native) on Janice-class hosts. A monolith can approximate some via dynamic linking; Abaco makes them product features — so they need CODE mitigations, not hope.

### 2.1 Surface catalog (overview)

| # | New surface | One-line break | Primary CODE mitigation |
|---|-------------|----------------|-------------------------|
| S1 | Dynamic load / discovery | Extra package appears that was never sealed | Admission seal + pin + discovery allowlist |
| S2 | Hot-reload races | Half-old handlers still on bus during swap | Quiesce→drain→swap; Integrador forbids unsafe reload; mark `reload_in_progress` |
| S3 | Confused deputy (cross-plugin) | Weak B asks privileged A to act | Canal identity; caller-bound handles; child ⊆ parent |
| S4 | Supply-chain third-party | Malicious update / typosquat / rug-pull cap widen | Hash pin, signature, SBOM, cap-diff, ring rollout |
| S5 | Shared bus / context abuse | Flood, poison, covert channel | Schema validate; backpressure; topic ACL; IPC size/depth caps |
| S6 | Catalog ≠ runtime dualism | Catalog says v1.2, Janice runs v1.3 | Dual digests; mismatch = CODE trip |
| S7 | Mediation bypass | Legacy path / advisor-as-grant / soft-timeout allow | Four asserts; no Atena/Jev in `authorize()`; fail-closed timeout |
| S8 | Self-reporting liars | Malicious plugin says “I’m healthy” | Host-only sensors; never sole-trust plugin telemetry |

---

### 2.2 Per-surface: how it breaks → CODE mitigation

#### S1 — Dynamic load / discovery

| | |
|--|--|
| **How it breaks** | Loader/discovery (curso L3) finds an “extra” entry point, side-loaded tarball, or typosquat path not in the sealed admission graph. Baseline looks clean until first invoke. |
| **Blast if ungoverened** | Hostile code shares process (T0/T1) with core; ambient imports reappear. |
| **CODE mitigations** | **Admission seal** after boot; discovery only from pinned roots; **hash pin** of package digests; preload allowlist; deny `compose-mutate-forbidden` (F1 M9); Bind: undeclared = no start. |
| **Not Jev’s job** | Jev must not “allow this discovery.” Novelty after CODE admit = optional gray-band triage only. |

#### S2 — Hot-reload races

| | |
|--|--|
| **How it breaks** | Quiesce incomplete → drain incomplete → swap: old handler still subscribed; new handler also live; grants point at wrong generation; deny spikes look like attack. |
| **Blast if ungoverened** | Dual execution, orphan grants, TOCTOU on caps. |
| **CODE mitigations** | Controlled reload FSM; **broker** suspends grants for target `plugin_id` during window; Integrador default: no hot-reload of stateful privileged plugins without drain proof; host sets `reload_in_progress` for pulse FP control; Bind blocked mid-reload. |
| **Not Jev’s job** | Suppress auto-attenuate during marked reload; don’t invent intent from flapping counters. |

#### S3 — Confused deputy (cross-plugin)

| | |
|--|--|
| **How it breaks** | Plugin B without caps asks privileged A (“host can do it”) to read/send/spawn. Or body forges `plugin_id`. Or A holds a handle that should have been attenuated for B. |
| **Blast if ungoverened** | Capability leakage between tenants/plugins; audit blames the wrong actor. |
| **CODE mitigations** | **Identity = canal** (F1 M8 — ignore body id); caller-bound handles; child grant ⊆ parent; **min caps** so A cannot be asked for undeclared methods; ledger records A←B call chain; Bind deny if deputy edge not in policy. |
| **Not Jev’s job** | Never mint temporary grant to “unblock collaboration.” |

#### S4 — Supply-chain third-party plugins

| | |
|--|--|
| **How it breaks** | Trusted plugin updates with widened caps; typosquat on registry; compromised signed build (XZ-class); permission-diff missed in review. |
| **Blast if ungoverened** | Marketplace becomes remote code execution with brand trust. |
| **CODE mitigations** | Manifest **pin** + signature + SBOM; **cap-diff** gate on bump (widen = HITL); install rings; Bind medium/high = human approval; no auto-rehab of disabled; default trust tier restrictive for new plugins. |
| **Not Jev’s job** | Jev is weak here. Cap-diff / pin / ring are CODE. Post-admit behavioral novelty may be gray-band only. |

#### S5 — Shared bus / context abuse

| | |
|--|--|
| **How it breaks** | Shared context + event bus (curso L5/L9) replace spaghetti — then flood (DoS), poisoned payloads, covert topics between colluding plugins, oversized JSON parser DoS. |
| **Blast if ungoverened** | Cross-plugin corruption; false SLO trips; starving admitidos. |
| **CODE mitigations** | Schema reject; framing limits; per-plugin dispatch deadlines; topic ACL / subscription caps; **broker** for any bus event that triggers protected effects; backpressure counters in **ledger**; kill switch per publisher. |
| **Not Jev’s job** | Don’t call Jev every bus tick (PIONERO trap). Host counters first. |

#### S6 — Catalog ≠ runtime dualism

| | |
|--|--|
| **How it breaks** | Declared catalog (manifests, `patch.yml`, version feeds) diverges from what Janice actually loaded / which grants are live / which schemas are pinned. Hot-swap incomplete; cache stale; update-feed branding ≠ packaged app. |
| **Blast if ungoverened** | Operators trust the wrong digest; pin theater without pin reality; Jev asked to guess authority. |
| **CODE mitigations** | Feature/ops must carry **both** catalog digest and runtime digest per `plugin_id`; mismatch → CODE trip; MCP schema pin (F1.5); admission immutable (control-3); Bind attest from **host** bind/authorize audit only — never plugin “bind success” story. |
| **Not Jev’s job** | Asking Jev without dual digests = asking it to invent authority — forbidden. |

#### S7 — Mediation bypass

| | |
|--|--|
| **How it breaks** | Legacy unmediated path (`LEGACY_UNMEDIATED`); direct spawn; `source: atena` / `jev` as grant; skill/tool-result mutates admission; timeout→allow soft middleware; “smart broker” that consults SLM on hot path. |
| **Blast if ungoverened** | Entire F1 story collapses; plugins become ambient again with extra complexity. |
| **CODE mitigations** | Protected effect ⇒ `authorize() → allow` **or** deny + `side_effect: false` + audit + counter; **Atena/Jev never in authorize / admission / pin**; four asserts; tests M1–M10 green **offline**; Bind planned/blocked never soft-start. |
| **Not Jev’s job** | Pulse **consumes** F1 audit; never becomes alternate path to `authorize()`. |

#### S8 — Self-reporting liars

| | |
|--|--|
| **How it breaks** | Compromised plugin emits “health=ok”, fake deny counts, or sweet FeatureBag text. Guardian that trusts plugin telemetry is deceived. |
| **Blast if ungoverened** | False calm; or FP storms if liar floods alerts the other way. |
| **CODE mitigations** | **Host-only sensors** (broker stats, cgroup, pin miss, canary, canal events); axiom: trust boundary ≠ plugin; ledger written by host; min caps so plugin cannot write host audit; Bind approvals from human/CODE only. |
| **Not Jev’s job** | Zero free-text untrusted features to Jev; counters/hashes only if pulse exists. |

---

## 3 Mitigation matrix (CODE-first checklist)

Cross-cut of §2 → concrete Abaco levers. **All rows are CODE / ops.** Atena/Jev appear only as “must not.”

| Surface | Broker F1 | Pin | Admission seal | Bind deny-by-default | Ledger | Caps mínimos |
|---------|-----------|-----|----------------|----------------------|--------|--------------|
| S1 Discovery | deny undeclared compose | package digest pin | sealed roots only | undeclared → no start | load/deny events | no ambient “all” |
| S2 Reload | suspend grants in window | generation digest | no mid-reload admit mutate | blocked mid-reload | `reload_in_progress` | stateful privileged: no casual reload |
| S3 Deputy | canal identity; handle bind | — | — | deputy edge must be policy | A←B chain | A cannot exceed own caps for B |
| S4 Supply chain | — | sig + SBOM + cap-diff | no silent rehab | medium/high → HITL | install ring events | default restrictive tier |
| S5 Bus | protect effectful topics | schema pin if tool-like | — | undeclared publish deny | drops / schema rejects | subscribe allowlist |
| S6 Dualism | authorize on **runtime** truth | catalog↔runtime both | seal matches runtime | host audit only | dual digests | — |
| S7 Bypass | sole grantor; timeout=deny | pin verify no SLM | datos≠control | planned/blocked no start | four asserts | — |
| S8 Liars | host counters | — | — | never trust plugin bind tale | host-written only | no audit.write for plugins |

**Candado rojo (naming law):** Janice executes; Atena advises; **Jev never grants**; Bind/authorize never import Atena/Jev.

---

## 4 Why tip-of-spear: plugins can work *better* than traditional — if governed

### 4.1 Doctrine

**Security ≠ stop evolution.**

| Traditional reflex | Tip-of-spear plugin reflex |
|--------------------|----------------------------|
| Attack suspected → freeze app / global flag / restart | Deny unauth’d effects; **admitted** plugins keep fast path |
| One bad deploy → rollback everything | Unload / revoke / attenuate **one** `plugin_id` |
| Security review blocks all change | Cap widen only via ContractEvolution + HITL; other admitidos ship |
| “Safe mode” = product death | Safe / recovery profile blocks third-party; core + admitidos still usable |

### 4.2 Precision beats monolith “simplicity” *when* multi-actor

```text
Monolith incident:
  signal → "the process is sick" → restart / freeze flags
  collateral: all features, all users of that binary

Governed plugin incident:
  signal → plugin_id=Z deny-spike + cap intact + novelty
  CODE: attenuate Z budgets | unload Z | revoke Z grants
  collateral: Z only (if isolation tier real)
  admitidos: still evolve
```

| Tip-of-spear property | Enabled by |
|-----------------------|------------|
| Deny unauth’d without freezing admitidos | Broker + doctrine delta (F1) |
| FeatureFlag / unload of **one** actor | Janice lifecycle + kill/breaker APIs |
| Human gate on risky binds only | Bind medium/high → HITL; low/denied automatic |
| Gray novelty without guardian paralysis | CODE floor + optional Jev doubt-band (PILOT elsewhere) — **not** this doc’s ship claim |
| Measurable “path to yes” | `proposeContractEvolution` + HITL, not silent widen |

### 4.3 Honest conditions for “better”

Plugins are **better than traditional** for security *operations* only if **all** hold:

1. Mediation is real (every protected sink → `authorize()` / Bind).  
2. Isolation is real enough for the claim (Phase S ladder — pulse/labels alone ≠ containment).  
3. Admission + pin + cap-diff are enforced (marketplace not “npm install hope”).  
4. Host sensors + ledger beat plugin self-report.  
5. Atena/Jev stay off the grant path.  
6. Response APIs exist: unload, revoke, attenuate, breaker **per plugin**.

If any of (1)–(6) is theater, prefer honesty: **you have a monolith with extra attack surface.**

---

## 5 When a monolith is still simpler (and rationally preferred)

Do **not** pluginize for fashion. Monolith (or single binary / single team deploy) remains the better security *and* product choice when:

| Condition | Why monolith wins |
|-----------|-------------------|
| **Equipo chico** (1–3 engineers) | Broker/admission/pin/Bind/ledger/ops is real TCB cost; docs+tests tax > blast benefit |
| **Un binario, un deploy unit** | No marketplace; no third-party; CVE story = one SBOM at build |
| **No multi-tenant plugin bus** | Shared-context surface (§2 S5) never appears |
| **No dynamic discovery product** | Load path is static link / one process tree — S1/S2 shrink to redeploy |
| **Latency / determinism sacred** | Extra hops through broker + reload FSM add failure modes you don’t need |
| **Isolation budget unavailable** | T0 in-process “plugins” without Phase S = false precision (honest gap on many tips) |
| **Threat model = mostly build-time** | Dependency review + signed release already matches risk; runtime plugin governance is overkill |

**Rule of thumb:** If you would not fund a capability broker and an admission seal as first-class product, **do not** advertise plugin security. Ship a small monolith; keep the door open to Janice later via “plugin = contrato” when the marketplace or multi-actor need appears.

---

## 6 Comparison scorecard (research B summary)

| Criterion | Traditional monolith | Governed Janice + broker + Bind | Ungoverned “plugins” |
|-----------|----------------------|----------------------------------|----------------------|
| Blast of one bad feature | Process / redeploy | One plugin (if isolated) | Process — **worse** (more load paths) |
| Attribution | Weak | Strong (`plugin_id` × canal × grant) | Fake labels |
| Tip-of-spear | Often freezes all | Deny unauth’d; admitidos evolve | Chaos + freeze culture |
| New surfaces | Few | Many — mitigated by CODE | Many — unmitigated |
| Supply chain | Build SBOM | Cap-diff + rings + HITL binds | Marketplace RCE |
| Advisor/LLM risk | Tempting log guardian | Candado: Atena/Jev never grant | “Smart broker” disaster |
| Fit | Small team, one binary | Multi-actor, marketplace, evolution | Never |

**One-line claim allowed in reviews:**  
*“Governed plugins trade a larger attack *surface catalog* for smaller blast, better attribution, and tip-of-spear response — they are not magically safer.”*

---

## 7 Cross-links (read, do not merge into this paper)

| Doc | Role vs this research B |
|-----|-------------------------|
| [`../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) | Sibling merged G47 compare — Jev ROI on plugin vs monolith; **do not edit here** |
| [`../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) | Pulse PILOT — CODE-first; never grants; **do not edit here** |
| [`../JANICE_ATENA_NAMING_LAW.md`](../JANICE_ATENA_NAMING_LAW.md) | Naming lock |
| [`../PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](../PLUGIN_FRONTIERS_CONTRACT_INDEX.md) | F1–F2.1 ley vs teatro |
| [`../PORTABLE_RULES_FOR_PYTHON_CORE.md`](../PORTABLE_RULES_FOR_PYTHON_CORE.md) | Bind/broker portable inheritance |
| [`../../SECURITY.md`](../../SECURITY.md) | App security model today (unsigned; plugin sandbox still roadmap) |
| [`../../TECH-plugin-loading.md`](../../TECH-plugin-loading.md) | Teatro DSH load path — not Python Core blueprint |
| [`../../contracts/CONTRACT-F1-MEDIACION-DEEP.md`](../../contracts/CONTRACT-F1-MEDIACION-DEEP.md) | Doctrine delta / tip-of-spear |
| [`../../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md) | Canal identity; M1–M10 |
| Research **A** `01-*` (parallel) | Traditional deep-dive — **out of scope; do not collide** |
| Research **C** `03-*` (parallel) | Jev rules — **out of scope; do not collide** |

---

## 8 Fuera de alcance

- Runtime / broker / Bind implementation.  
- Unified paper merging A+B+C.  
- Editing merged `JEV_*.md` or sibling `research/01-*` / `research/03-*`.  
- Shipping Security Pulse or raising Jev automation because “plugins help.”  
- Claiming Phase S isolation already complete on Deep Harnes T0/T1 paths.

---

## 9 Review checklist (docs PR)

- [ ] No claim “plugins = más seguro mágicamente”  
- [ ] Traditional→alleviate table includes blast / attribution / unload-revoke-attenuate  
- [ ] All eight new surfaces have break + CODE mitigation  
- [ ] Bind doctrine: deny-by-default; planned/blocked no start; medium/high HITL; Atena/Jev never grants  
- [ ] Tip-of-spear: deny unauth’d without freezing admitidos; one-actor unload vs monolith restart  
- [ ] Monolith-still-simpler section present and non-dismissive  
- [ ] Naming: Janice / Atena / Jev lock respected  
- [ ] No edits to sibling research A/C or merged JEV docs  
