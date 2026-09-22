# G47 — Jev on plugin hosts vs traditional monoliths

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — comparación profunda; **no** implementación |
| **fecha** | 2026-09-22 |
| **teatro** | Plugin Frontiers / `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **base** | Extiende el pulse analysis [PR #36](https://github.com/anthony-x507/Abaco-deep-Core/pull/36) → [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) |
| **fuentes** | DEEPSEEK-PLUGIN-CYBERSECURITY; PIONERO (evolución segura); mind-plugin-system-v2; propuesta seguridad-escala; curso Python 10; catorce defaults Integrador; F1 mediación + naming law; Jev decision-desk PLAN |
| **naming** | **Jev** ≠ **Atena** ≠ **Janice** — Jev never grants; CODE-first; tip-of-spear |
| **merge** | Solo vía PR de docs + review humano; **no** merge automático; **no** plugins |

---

## 0 Verdict (1 page): where plugin architecture makes Jev-assisted security easier / harder

**Short answer:** Jev’s Security Pulse (CODE-first, gray-band %, never grants) is **easier to instrument and more tip-of-spear effective on a real Janice plugin host** than on a traditional monolith — *because* plugin seams already produce typed, attributable, fail-isolated signals that map cleanly to System One questions. It is **not** safer by magic: plugins also create attack surfaces a monolith barely has (dynamic load, confused deputy, third-party supply chain, shared bus, catalog≠runtime dualism, mediation bypass). Those surfaces make Jev *more necessary* as a doubt-band ranker and *more dangerous* if miswired as a guardian or grantor.

| Dimension | Plugin host (Janice + broker F1) | Traditional monolith | Winner for Jev ROI |
|-----------|----------------------------------|----------------------|--------------------|
| **Signal attribution** | Native `plugin_id` / channel / grant / deny-reason | Must invent module tags after the fact | **Plugin** |
| **FeatureBag shape** | Per-plugin counters + dep graph + lifecycle events | Global counters; cross-cutting noise | **Plugin** |
| **Action granularity** | Unload / revoke / attenuate **one** plugin | Restart process / feature flag / big bang | **Plugin** |
| **Instrumentation cost** | Thin adapter on existing audit/broker | New sensors across entangled layers | **Plugin** |
| **False-positive risk** | Higher combinatorial state (N plugins × reload × bus) | Lower combinatorial, higher blast on FP | **Tie / monolith quieter** |
| **Grant/authority risk if Jev misused** | Catastrophic (looks like “smart broker”) | Also bad, but ambient imports already blur authority | **Monolith slightly less tempting to misuse** |
| **Supply-chain / third-party** | First-class threat; Jev sees cap-diff / novelty | Mostly CI + deps; less runtime plugin marketplace | Plugins need more CODE; Jev only on gray |
| **Tip-of-spear** | Deny unauth’d; don’t freeze admitted; attenuate one actor | Security often freezes the whole app | **Plugin (if pulse stays alert-first)** |

**Verdict line (extends PR #36 PILOT):** Keep **PILOT** — CODE always, Jev only in doubt/tie, platform pulse + thin adapters, no fixed 15s fleet, no Jev in `authorize()`. The plugin comparison **strengthens** that design: platform+adapters wins *because* of plugin seams, not despite them. Do **not** claim “plugins make Jev safer”; claim “plugins make Jev’s gray-band job cheaper to wire and more precise to act on — if host sensors are trusted and features stay counter/hash-only.”

**Honest asymmetry:**

- **Easier for Jev:** typed features per `plugin_id`, dependency DAG, lifecycle events, capability manifests, fail-isolation → natural FeatureBag for System One.
- **Harder for Jev:** combinatorial states, noisy event bus, plugins that lie about self-health, reload races, dual catalog vs runtime (Abaco dualism), confused-deputy patterns that look like “legitimate collaboration.”

---

## 1 Plugin-unique attack surface (vs traditional)

These are threats that are **structurally stronger** (or uniquely native) in plugin architectures. A monolith can approximate some via dynamic linking or script plugins, but Abaco’s Janice model makes them first-class.

### 1.1 Dynamic load / hot reload / discovery

| Threat | What happens | Monolith analogue | Why plugins are worse |
|--------|--------------|-------------------|------------------------|
| Hostile discovery | Loader finds “extra” package / entry that was not in sealed admission | Rare (static link / one binary) | Discovery is **product feature** (curso L3) |
| Hot-reload swap | Quiesce→drain→swap races; half-old handlers still on bus | Redeploy whole process | Stateful plugin + reload = Integrador default #8 forbids; still a footgun |
| Lazy activation | Malicious code wakes only on rare event — baseline looks clean | Feature flags, less common | Novelty appears late; CODE canaries help; Jev may FP on first activation |

**Jev role:** Rank “novel activation + deny cluster” as deploy vs attack **only** when CODE integrity (pin, signature, admission seal) already passed. Never decide “allow this discovery.”

### 1.2 Confused deputy / capability leakage between plugins

Axiom (cyber digest): *“the host can do it” never means “this plugin can do it.”* Plugin B without caps asks privileged A to read/send.

| Pattern | Signal for pulse | CODE must do | Jev must not do |
|---------|------------------|--------------|-----------------|
| Cross-plugin call with forged `plugin_id` in body | Channel mismatch deny (F1 M8) | Identity = **canal**, ignore body id | Invent “intent” from prose |
| A acts for B without B’s attenuated handle | Caller-bound handle miss | Broker binds caller; child ⊆ parent | Mint temporary grant |
| Shared secret / ambient env | Undeclared egress / canary | Secrets brokered; no ambient | Trust plugin “health” text |

Plugins make confused deputy **measurable** (two `plugin_id`s in one audit chain). Monoliths collapse A and B into one process identity — harder to ask Jev a crisp question, easier for ambient authority to hide.

### 1.3 Supply-chain third-party plugins

| Vector | Plugin-native | Traditional |
|--------|---------------|-------------|
| Malicious update after trust | Cap widen in patch release; rug pull | Dependency update in one deploy |
| Typosquat / registry confuse | Marketplace / extra-index | Mostly lockfile at build |
| Compromised signed build | Signature ≠ safe (XZ-class) | Same, but fewer independent “apps” in-process |
| Permission-diff miss | New `net.external:any` ships | New import / IAM role — review once |

**Jev is a weak tool here.** Cap-diff, signature, SBOM, hash pin, ring rollout are **CODE**. Jev at best ranks “post-update behavioral novelty vs expected migration” after CODE admitted the artifact.

### 1.4 Shared context / event bus abuse

Curso L5/L9 + mind-v2: shared context and event bus replace spaghetti imports — and become a **security surface**.

| Abuse | Effect | Pulse feature (host-collected) |
|-------|--------|--------------------------------|
| Flood / DoS on bus | Starves other plugins; false SLO trips | Queue depth, drop rate, per-plugin dispatch deadline hits |
| Poisoned payload / prototype pollution (JS) | Cross-plugin state corruption | Schema reject rate; framing errors |
| Covert channel via bus topics | Colluding plugins coordinate | Cross-plugin correlation of rare topics |
| Oversized / deep JSON | Parser DoS | IPC size/depth reject counters |

Monoliths have IPC too, but not usually a **productized multi-tenant plugin bus**. Noise here is the #1 reason Jev-on-every-tick fails (PIONERO trap).

### 1.5 Version skew / dual catalog vs runtime (Abaco dualism)

Abaco already lives a dualism: **declared catalog** (manifests, `patch.yml`, admission graph, version catalogs, update feeds) vs **live runtime** (what Janice actually loaded, which grants are live, which schemas are pinned).

| Dualism failure | Example | Who catches |
|-----------------|---------|-------------|
| Catalog says v1.2, runtime runs v1.3 | Hot-swap incomplete / cache | Host integrity: digest mismatch → CODE |
| Admission sealed; skill tries to widen | Datos≠control (F1 control-3) | Broker deny |
| Update feed branding ≠ packaged app | Deep Harnes `version-catalog` residual URLs | Ops/CODE, not Jev |
| MCP schema approved ≠ schema served | F1.5 pin/witness | CODE trip; Jev may triage severity only |

**Pulse implication:** FeatureBag must carry **both** catalog digest and runtime digest per `plugin_id`. Asking Jev without that dual is asking it to guess authority — forbidden.

### 1.6 Mediation bypass attempts (F1-relevant)

F1: protected effect = `authorize() → allow` with live grant, else deny + `side_effect: false` + audit + counter. Janice executes; Atena/Jev outside hot-path.

| Bypass attempt | Plugin-shaped | Traditional-shaped |
|----------------|---------------|--------------------|
| Direct spawn / legacy unmediated path | `LEGACY_UNMEDIATED` voice path | Call internal API without authz layer |
| Body spoof of `plugin_id` | M8: ignored | Spoof user id in HTTP body |
| Advisor-as-grant (`source: atena` / `jev`) | Deny `atena-cannot-grant` | “Ops bot approved” in config |
| Skill/tool-result mutates admission | Admission immutable | Config reload from untrusted doc |
| Timeout→allow soft path | Four-assert forbids | Fail-open middleware |

**Jev must consume F1 audit, never become an alternate path to `authorize()`.** That trap is *more tempting* on plugins (“smart mediation”) than on a monolith with a single auth middleware everyone already trusts.

---

## 2 Traditional monolith surface (what Jev would see instead)

If Abaco were still “folders + import = power,” a Security Pulse would see something like:

| Monolith signal class | Typical shape | Blind spots vs plugins |
|-----------------------|---------------|------------------------|
| Process metrics | One CPU/mem/IO time series | Cannot quarantine a “module” without redeploy |
| App logs | Unstructured or request-id | Weak actor attribution |
| Authn/authz | User/session/role | No `plugin_id` × grant × budget lattice |
| Dependency CVE | Build-time SBOM | No runtime plugin marketplace events |
| Feature flags | Global toggles | Coarse; tip-of-spear freeze risk high |
| Network | Host firewall / egress | Hard to map to one author module |

**What Jev would be asked (awkward):**

- “Is this process under attack?” → one score for everything; attenuate = restart or throttle all.
- “Is this deploy malicious?” → conflates product release with adversary.
- “Should we open the circuit?” → binary kill of the organism.

**Cost of instrumenting a monolith for Jev-quality features:** invent artificial module IDs, wrap every sink, rebuild audit — i.e. **recreate plugin seams poorly**. That is why the Integrador move (broker + manifests) is the real security upgrade; Jev rides those seams, it does not create them.

| Monolith “security with Jev” anti-pattern | Outcome |
|------------------------------------------|---------|
| LLM scans every log line | Cost, FP, injectable guardian |
| Jev decides allow/deny on each request | Non-deterministic contracts; CI breaks |
| One global threat % drives quarantine | Tip-of-spear death: freezes admitted evolution |

---

## 3 Comparison matrix

| Criterion | Plugin host (Janice + F1) | Traditional monolith | Notes for Abaco pilot |
|-----------|---------------------------|----------------------|------------------------|
| **Signal quality** | High if host-collected (broker audit, channel id, pin miss, cgroup per plugin) | Medium; attribution fuzzy | Never trust plugin self-report as sole truth |
| **Instrumentation cost** | Low–medium: thin `collectWindow → FeatureBag` adapter on existing audit | High: retrofit sinks | Platform pulse + adapters (PR #36) |
| **False positives** | Higher state space (N plugins, bus, reload) | Lower volume, higher impact per FP | Adaptive interval; alert-first; separate security vs SLO breakers |
| **Time-to-instrument** | Days per face once platform exists | Weeks–months for comparable attribution | Deep voice adapter ~50–100 LOC estimate still holds |
| **Portable pulse adapters** | Natural: one FeatureBag schema, many faces | Forced: each app invents schema | **Wins on plugins** |
| **Grant/authority risk** | High if Jev wired near broker | High if Jev near auth middleware | Same candado: never grants; same as Atena |
| **Action precision** | Unload/revoke/attenuate one plugin | Coarse flags / restart | Tip-of-spear favors plugins |
| **Supply-chain visibility** | Cap-diff + install rings first-class | Build SBOM only | CODE owns; Jev optional post-admit |
| **Testability** | M1–M10 / four-assert without Jev | Authz unit tests | Pulse tests must stay green offline |

---

## 4 Why Jev fits plugins MORE EASILY (mechanism)

System One wants a **small, typed, comparable** feature vector and a **finite choice set**. Janice hosts already emit those if mediation is real.

```text
plugin_id ──► counters(deny, allow, egress_bytes, token_burn, …)
         ──► lifecycle(load|activate|reload|unload|crash)
         ──► caps_manifest_digest  ≠  runtime_digest   (dualism check)
         ──► dep_edges (declared DAG)
         ──► bus(queue_depth, drops, schema_rejects)
         ──► isolation(tier, cgroup OOM, framing rejects)
                    │
                    ▼
            FeatureBag (deterministic, redacted, capped)
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
    CODE hard trips      Jev only if doubt/tie
    (pin, canary,        choice / noul / score / conf
     undeclared egress)  apply_ok → alert|shadow attenuate
```

| Mechanism | Why it helps Jev |
|-----------|------------------|
| **Typed features per `plugin_id`** | Questions can be scoped: “is *this* actor hostile?” not “is the Mac hostile?” |
| **Dependency graph** | Novelty “A suddenly calls B” is a feature; monolith call graphs are greyer |
| **Lifecycle events** | Reload/activate windows are natural doubt bands (deploy vs compromise) |
| **Capability manifests** | Cap-diff and undeclared method are CODE; residual gray is method-*mix* under valid caps |
| **Fail-isolation** | Recommended action maps to product APIs (`unload`, revoke, breaker) without killing core |

This is the **mechanical** reason platform + thin adapters works: seams → questions. Atena may narrate offline; Janice executes CODE-authorized actions; **Jev only ranks gray options with %**.

---

## 5 Why Jev is HARDER on plugins (traps)

| Trap | Why plugins amplify it | Mitigation |
|------|------------------------|------------|
| **Combinatorial states** | N plugins × versions × tenants × time-of-day baselines | Per-plugin×tenant baselines; MAD/z-score; don’t globalize one threat % |
| **Noisy bus** | Shared context chatter looks like “anomaly” | Cap features to security-relevant topics; backpressure counters only |
| **Plugin that lies** | Self-health / “I’m fine” telemetry | Host-only sensors; axiom: trust boundary not plugin |
| **Reload races** | Dual handlers; transient deny spikes | Suppress pulse apply during controlled reload windows; CODE marks `reload_in_progress` |
| **Collusion / covert bus** | Two “benign” plugins | Cross-plugin correlation features; still CODE for caps; Jev ranks suspicion only |
| **Guardian temptation** | “Ask Jev before every authorize” feels natural near broker | Candado rojo — same as Atena |
| **FP → ambient smuggling** | Teams route around pulse into core imports | Alert-first pilot; no auto-quarantine without CODE co-fire / HITL |
| **Third-party marketplace volume** | More updates → more novelty | Cap-diff CODE gate; Jev budget hard max N/h |

**Skeptical line:** If Janice is still mostly T0/T1 in-process (honest gap today on Deep Harnes), plugin *labels* without isolation make FeatureBag **look** precise while blast radius remains process-wide. Jev cannot compensate for missing Phase S sandboxes.

---

## 6 Design implication for Abaco: platform pulse + thin adapters wins BECAUSE of plugin seams

PR #36 already chose platform + adapters over “one pulse plugin per product.” The plugin-vs-monolith lens explains **why**:

| Seam (already law / theater) | Maps to System One question family |
|------------------------------|------------------------------------|
| Broker allow/deny + reason enum | `threat_level` / abuse-of-caps |
| Channel identity ≠ body `plugin_id` | Confused-deputy suspicion (noul) |
| Admission seal / datos≠control | Integrity (CODE); Jev silent |
| MCP schema pin (F1.5) | Drift = CODE; severity triage optional |
| Lifecycle + kill/breaker APIs | `next_action`: hold / alert / attenuate_budgets |
| Manifest digests vs runtime digests | Dualism check feature bit |
| Per-plugin budgets / cgroup | Resource abuse score |
| Dep DAG | Unexpected edge novelty |

**Python Core Phase B Bind (upcoming):** Bind is where deferred contracts meet runtime. Pulse adapters should hang off **host audit of bind/authorize**, not off plugin-provided “bind success” stories. Same portable law as Deep: identity = canal; Janice runs; Atena/Jev never attest admit.

```text
abaco-security-pulse (platform)
    ├── FeatureBag schema (portable)
    ├── CODE rules (portable)
    ├── Jev client + apply_ok (portable)
    └── journal + action map → breaker APIs
            ▲
            │ thin adapters
   adapter-deep-voice   adapter-python-hub   …
   (theater sensors)    (Phase B bind audit) …
```

A monolith would force the platform to **fake** these seams. Abaco should not: finish mediation + Phase S; let pulse stay thin.

---

## 7 Concrete example questions Jev can ask in a plugin host that are awkward in a monolith

All questions assume **counters/hashes only** in the feature pack (no raw transcripts). Options never include `grant` / `widen`.

| # | Plugin-host question (parallel dict style) | Why awkward in a monolith |
|---|--------------------------------------------|---------------------------|
| 1 | `choice`: Given deny-reason histogram for `plugin_id=abaco-voice` vs its 7d baseline, pick `hold` \| `alert` \| `attenuate_budgets`. | Monolith has one deny pile; no per-module budget to attenuate |
| 2 | `noul`: P(caller channel and callee `plugin_id` show confused-deputy pattern) under F1 candados. | No first-class two-actor capability model |
| 3 | `score` 1–5: Severity of **catalog digest ≠ runtime digest** for plugin X after reload window. | Single binary; no dual catalog/runtime product concept |
| 4 | `choice`: Post-update, cap set unchanged but method-mix novelty high — `hold` vs `alert` vs `shadow_attenuate`. | Update = whole app deploy; “cap set unchanged” not a runtime object |
| 5 | `noul`: P(bus drop spike is DoS by plugin Y vs host overload). | No per-publisher backpressure identity |
| 6 | `choice`: Plugin Y crash-looping in T3 cell — `alert` vs `unload` vs `hold` (core healthy). | Crash usually takes the process; unload-one is rare |
| 7 | `score`: How much does cross-edge A→B (not in declared DAG) look like collusion vs missing manifest dep. | Import graph is compile-time; rarely audited as live DAG |
| 8 | `noul`: P(this MCP schema pin miss is rug-pull vs deploy skew) — **advisory only**; CODE already denied. | MCP pin is plugin/tool ecosystem specific |
| 9 | `choice`: Admitidos healthy; third-party Z trip — attenuate Z only vs global warn. | Tip-of-spear doctrine needs per-plugin actions |
| 10 | `score`: Conviction that reload_in_progress explains deny spike (suppress apply). | Monolith redeploy usually stops traffic entirely |

**Monolith-friendly questions that remain valid everywhere:** global egress to IMDS, canary token in logs, process OOM — those stay **CODE trips**, not Jev differentiators.

---

## 8 Recommendation: keep / adjust prior PILOT verdict

### Keep from PR #36 (unchanged)

| Item | Status |
|------|--------|
| Verdict **PILOT** (not ship product; not reject idea) | **Keep** |
| CODE-first; Jev gray-band / tie only | **Keep** |
| Jev never grants; never in `authorize()` / admission / pin | **Keep** |
| No fixed 15s fleet; adaptive base ≥60–90s; `interval_min=15s` under stress | **Keep** |
| Platform pulse + thin adapters | **Keep — strengthened** by this compare |
| Pilot: alert + journal; attenuate/quarantine need CODE co-fire or HITL | **Keep** |
| Phase S sandbox first-class; pulse does not replace isolation | **Keep** |
| Naming: Jev ≠ Atena ≠ Janice | **Keep** |

### Adjust / sharpen (docs only)

| Adjustment | Why |
|------------|-----|
| Explicitly document **plugin-unique surfaces** (§1) in pulse threat notes | Avoid “Jev solves plugins” hype; sensors must cover dualism, bus, deputy |
| FeatureBag **must** include catalog≠runtime bits + `reload_in_progress` | Abaco dualism; reload FP control |
| Prefer questions **scoped by `plugin_id`** in pilot (table §7 #1,#6,#9) | Where plugins beat monoliths for tip-of-spear |
| Call out **harder traps** (§5) in pilot DoD | Combinatorial FP / lying plugin / bus noise |
| Do **not** raise cadence or widen auto-actions because “plugins help Jev” | Easier instrumentation ≠ more automation |
| Phase B Bind adapters: bind/authorize **host audit only** | Upcoming Python Core; same candado |

### One-line recommendation to Anthony

**Keep PILOT.** Plugin architecture makes Jev’s doubt-band pulse *easier to wire and more precise to act on* than a monolith, and simultaneously *noisier and more authority-dangerous* if misused — so the prior CODE-first / platform+adapters / alert-first design is the correct tip-of-spear fit, not a softer one.

---

## Cross-links

| Doc | Role |
|-----|------|
| [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) | Prior pulse feasibility — **PR #36**; this doc extends it |
| [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) | Naming + never-grant |
| [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md) | F1–F2.1 law vs theater |
| [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md) | Phase A/B portable inheritance |
| [`CONTRACT-F1-MEDIACION-DEEP.md`](../contracts/CONTRACT-F1-MEDIACION-DEEP.md) | Mediation invariants |
| [`CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md) | Channel identity; M8 |

## Fuera de alcance

- Implementar Security Pulse plugin o adapters.  
- Merge a `main` / merge PR #36.  
- Reabrir F1 o meter Jev en broker.  
- Phase S implementation.
