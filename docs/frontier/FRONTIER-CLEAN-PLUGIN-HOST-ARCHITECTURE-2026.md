# Frontier — clean architecture for strong plugin hosts (2026)

**Resumen (ES).** Esta nota no reescribe el core ni fusiona nada: mapea arquitectura pública sobre el host Abaco.
El plano de control sigue siendo código: Bind y `authorize()` conceden; Janice ejecuta con grant vivo.
Atena aconseja y Jev solo rankea la banda gris; ninguno entra en Bind ni en `authorize()`.
Hexagonal y Clean Architecture coinciden en lo útil: el host posee los puertos; sandbox, face y bus son adaptadores.
El catálogo (`DEFAULT_PLUGIN_MANIFESTS`) no es el runtime: Bind es donde el contrato diferido se vuelve efecto o se niega.
FacePlugin es un contrato versionado (caps, activación, tier de sandbox), no una carpeta; la face Studio queda para después.
OSGi, Eclipse y VS Code repiten la misma higiene: pocos puntos de extensión, activación perezosa, API estable distinta de la propuesta, y el host llama al plugin.
Wasm fija el candado estructural: sin import declarado no hay acceso, y la composición no abre autoridad nueva.
Microkernel: política mínima en el host; el negocio vive en plugins. La evolución usa fitness functions y no un big-bang.
Los cinco refactors de los próximos 30 días son solo `docs/contracts`. Cero runtime en este documento.

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — investigación de arquitectura; **no** runtime; **no** merge automático |
| **fecha** | 2026-09-22 |
| **repo** | `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **serie** | Frontier clean-plugin-host. **No** es el research C de G47 ([`research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md`](research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md)), que sigue siendo la adhesión Jev→pulse |
| **plan Python Core** | Master Plan v2 **COMPLETE** en la secuencia N → A → A+ → B → F → P → S. **Studio FacePlugin = LATER** |
| **naming** | **Janice** ejecuta. **Atena** aconseja. **Jev** rankea duda. **Bind** es el mecanismo CODE donde el contrato diferido encuentra runtime. No se mezclan |
| **honesty** | En *este* checkout no hay una clase `FacePlugin` ni la constante `DEFAULT_PLUGIN_MANIFESTS`. Esos nombres son la forma del hub Python que el brief da por construida. Aquí se alinean a esa forma y a los contratos que sí viven en este árbol |

---

## 0 Verdict

A strong plugin host is a **small policy core** that owns a few versioned ports, plus **adapters** that can be swapped without moving authority. Abaco already has the policy names. What is still thin, in docs, is the map that stops those names from collapsing into one another.

| Seam (Python Core shape) | Owns | Must not own |
|--------------------------|------|----------------|
| **Catalog** (`DEFAULT_PLUGIN_MANIFESTS`) | Declared contracts: id, version, caps ceiling, activation, sandbox *requirement* | Live grants, running code, advisor prose |
| **Bind** | CODE resolution: catalog row → running binding, or refuse | Advice, ranking, narration |
| **FacePlugin** | The contract a face implements | Host policy, Studio product slots (later) |
| **Dispatcher** | Host calls a bound export | Plugin-pushed authority, Atena/Jev |
| **Sandbox** | Isolation adapter behind a host port | A method the plugin implements to “be safe” |
| **Broker `authorize()`** | The only grantor | Atena, Jev, Janice-as-attestor |

```text
catalog row  --Bind (CODE)-->  runtime binding  --dispatcher-->  Janice executes
                    |                              |
                    | refuse: planned/blocked,     | grant required
                    | range miss, tier miss        v
                    v                         authorize()
              no start                        Atena/Jev stay outside
```

**Verdict line.** Keep the Python Core seams. Write the missing contracts (ports, manifest schema, digest dualism, fitness, version coexistence). Do not restage the host as a framework, and do not pull Studio into the core catalog.

---

## 1 What this note is allowed to claim

### 1.1 In this repository (verified)

| Artifact | Role for this note |
|----------|-------------------|
| [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) | Janice = runtime; Atena = advisor-never-grants; connectors HOLD |
| [`CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md) | `authorize()` only grantor; `A_efectiva` intersection; canal identity; M1–M10 |
| [`f1-broker-deny-reasons.json`](../contracts/f1-broker-deny-reasons.json) | Closed deny vocabulary. Loaded by `core/f1/effect_broker_contract.py` — a docs mirror, not a grantor |
| [`CONTRACT-F1-ADMISSION-IMMUTABLE.md`](../contracts/CONTRACT-F1-ADMISSION-IMMUTABLE.md) | Sealed admission; data ≠ control |
| [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md) | What the hub may inherit. Curso 10 is the Python skeleton; Cordis is not |
| Research B / G47 | Bind doctrine already written: deny-by-default; `planned` / `blocked` do not start; medium/high need a human; Atena/Jev never grant |
| [`SECURITY.md`](../SECURITY.md) | Deep Harnes plugin sandbox is still a product gap on the Electron face |

F1 is closed. This note does not reopen it.

### 1.2 Python Core shape (brief, not re-audited here)

The brief states that Python Core Master Plan v2 is complete through phase S, and that the hub already has **FacePlugin**, **`DEFAULT_PLUGIN_MANIFESTS`**, a **dispatcher**, and a **sandbox**. Phase letters other than the ones already used in this tree are not redefined here:

| Letter | Meaning used in *this* tree | This note |
|--------|-----------------------------|-----------|
| **B** | Bind — deferred contract meets runtime | Keep the doctrine in §4 |
| **S** | Sandbox providers (isolation port) | Adapter, not a FacePlugin method |
| N, A, A+, F, P | Completed in the Python Core plan | Not restated; no new semantics invented |
| Studio FacePlugin | **LATER** | Must not appear as rows in the core catalog |

Deep Harnes (this repo) and the Python hub stay different stacks. Same naming law, same mediation semantics, no Cordis loader inside the hub ([portable rules](PORTABLE_RULES_FOR_PYTHON_CORE.md)).

---

## 2 Patterns worth adopting

Each pattern below is tied to a public source that was checked for this note. The Abaco column is the adoptable slice, not a rewrite plan.

### 2.1 Ports and adapters — the host owns the interfaces

Cockburn’s 2005 pattern asks for an application that runs without a UI or a database, driven by users, programs, tests, or batch, with a test harness as a first-class adapter on the same port ([Cockburn 2005](https://alistair.cockburn.us/hexagonal-architecture)). A port is a purposeful conversation. Several adapters may plug one port. The later strong-conformance note is stricter: a driven port is expressed in domain language, not in the technology behind it (a port that speaks SQL is only weakly hexagonal) ([Cockburn, *Hexagonal Architecture Explained*](https://alistaircockburn.com/hexarch%20v1.1b%20DIFFS%2020250420-1012%20paper+epub.docx.pdf)).

Martin’s dependency rule is the same constraint in layers: source-code dependencies point inward; an inner name must not mention an outer name; data crossing a boundary is a structure the inside chose, not a framework row ([Martin 2012](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html); the 2017 book restates that essay). Crossing a boundary the “wrong” way is an inner port that the outer adapter implements.

Fowler’s Plugin links an implementation at configuration time, not compile time, and centralizes that configuration so it is not a scatter of factories ([Fowler, Rice, Foemmel 2003](https://martinfowler.com/eaaCatalog/plugin.html)). Separated Interface puts the interface in the client package and the implementation elsewhere ([Fowler 2003](https://martinfowler.com/eaaCatalog/separatedInterface.html)).

**Adopt.**

| Port the host owns | Adapters (outside) | Test seam |
|--------------------|--------------------|-----------|
| Catalog read | Built-in `DEFAULT_PLUGIN_MANIFESTS`; a fixture catalog | Dispatcher tests never touch Electron |
| Bind | In-process binder now; later out-of-process | A binder that only returns refuse/allow |
| FacePlugin | Python face implementations; Studio **later**, as another adapter | Fake face with scripted exports |
| Dispatcher | In-process call; RPC later | Records calls, throws on demand |
| Sandbox | Subprocess / Wasm / container (phase S) | Null sandbox that still *reports* tier `T0` honestly |
| `authorize()` | The real broker | The existing four-assert mirror |

The host names `FacePlugin`, `Bind`, and `SandboxPort`. A face implementation does not name the broker’s private types. Atena and Jev are outer adapters. They are not ports of the policy core.

### 2.2 Microkernel — policy in the core, product in plugins

The microkernel pattern (Buschmann, Meunier, Rohnert, Sommerlad, Stal, *Pattern-Oriented Software Architecture, Volume 1*, Wiley, 1996) keeps a minimal core of mechanisms and places extended function in servers reached through adapters. Eclipse’s own write-up of the same idea: a core of services, tools wrapped as plug-ins that conform to a contract, new plug-ins adding processing elements to existing ones (Bolour, [Notes on the Eclipse Plug-in Architecture](https://www.eclipse.org/articles/Article-Plug-in-architecture/plugin_architecture.html), 2003).

**Adopt, already stated as Integrador defaults.** The host keeps identity, tenancy, event log, capability broker, registry, audit. Product behavior is a versioned plugin. Deep Harnes UI slots and Cordis `provide`/`inject` stay theater of the Electron face; they are not the hub’s microkernel API.

**Do not adopt.** A microkernel that is “minimal” only in a diagram, while every plugin is an in-process import with the process’s ambient authority. That is a monolith with extra packages. Research B’s honesty lock still holds: plugins are more precise when broker + caps + Bind govern them.

### 2.3 The manifest is data; code loads later

Three public hosts converged on this, for different reasons:

| Host | Declared contract | When code runs |
|------|-------------------|----------------|
| Eclipse | Extension point = XML schema + interface. The registry is built by scanning manifests. Classes load on use (lazy activation). Exported packages are API; the rest is private ([Moir, AOSA ch. Eclipse](https://aosabook.org/en/v1/eclipse.html); [Eclipse PDE](https://help.eclipse.org/latest/topic/org.eclipse.pde.doc.user/concepts/extension.htm)) | The extended plug-in evaluates contributions. It does not know the extender beyond the contract |
| VS Code | `package.json` contribution points + `activationEvents`. `*` exists and is discouraged; a specific event is the default. `activate` runs once; `deactivate` cleans up ([activation events](https://code.visualstudio.com/api/references/activation-events), [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)) | A separate extension host. `extensionKind` says `ui` vs `workspace` |
| Wasm component model | WIT defines types, functions, interfaces, and worlds. A world is imports plus exports. WIT does not define behavior ([WIT](https://component-model.bytecodealliance.org/design/wit.html), [worlds](https://component-model.bytecodealliance.org/design/worlds.html)) | A component interacts only by its exports being called or by calling its imports. No import for a store means no access to that store, even in-process |

**Adopt for FacePlugin.** `DEFAULT_PLUGIN_MANIFESTS` is the registry of contracts. Bind is the moment a row becomes a live binding. The dispatcher calls exports the row declared. An undeclared effect is not a “dynamic feature”; it is an unsatisfied import and it does not start.

OSGi Core Release 8 states the same split as layers: the module layer resolves requirements and capabilities (including package version ranges); the life-cycle layer installs, starts, stops, updates, and uninstalls; the service layer binds a consumer to an interface and chooses an implementation at runtime ([OSGi Core R8 introduction](https://docs.osgi.org/specification/osgi.core/8.0.0/framework.introduction.html)). FacePlugin corresponds to the interface plus the manifest. Bind corresponds to resolve + start. The dispatcher corresponds to the service call. The sandbox corresponds to the isolation the framework owes the bundle, which OSGi did not make structural — Wasm did. Prefer Wasm’s closed import set over OSGi’s class-loader sharing when the question is blast radius.

### 2.4 Versioning — consumers and providers are not the same range

SemVer 2.0.0 (Preston-Werner, [semver.org](https://semver.org/spec/v2.0.0.html)) requires a declared public API. MAJOR breaks it, MINOR adds compatible surface, PATCH fixes behavior. A released version is immutable. `0.y.z` is not a stable contract. The string `v1.2.3` is not a SemVer version.

OSGi’s semantic-versioning white paper adds the lesson SemVer leaves implicit: **API consumers and API providers have different compatibility**. A consumer of an exported package can often accept `[1.2,2)`. A provider of that package (an implementer) must be tighter, typically `[1.2,1.3)`, because a minor change can add a method the provider must implement ([OSGi semantic versioning](https://docs.osgi.org/whitepaper/semantic-versioning/040-semantic-versions.html)).

**Adopt on FacePlugin.**

| Party | Range when the host contract is `1.4.x` | Why |
|-------|------------------------------------------|-----|
| Face that *calls* a host port | `[1.4,2)` | New optional host calls must not strand it |
| Face that *implements* a host port | `[1.4,1.5)` | A new method on the port is a provider break |
| Catalog row itself | Exact `MAJOR.MINOR.PATCH` pin in `DEFAULT_PLUGIN_MANIFESTS` | The catalog is a release, not a range. Ranges live on dependencies |

A cap added to a manifest is a MINOR only if it is unused by default and does not widen `A_efectiva` for existing grants. A cap that starts authorizing a new effect is a MAJOR, or it is not a version bump at all: it is ContractEvolution + HITL (F1 M9 already denies a semver PATCH that mutates composition without HITL).

VS Code’s API process is the second half of this lesson. Proposals live in `vscode.proposed.d.ts`, are tried, and **cannot be published** until they move into the stable `vscode.d.ts`. Breaking a stable API is out of policy; a change to an existing API must be backward compatible ([extension API process](https://github.com/microsoft/vscode-wiki/blob/2dc037b1/Extension-API-process.md), [guidelines](https://github.com/microsoft/vscode/wiki/Extension-API-guidelines)). **Studio fields are proposed.** They do not enter `DEFAULT_PLUGIN_MANIFESTS` and they do not enter the stable FacePlugin schema.

### 2.5 The host calls the plugin

VS Code’s guideline on providers: define a provider interface so the host decides when to ask, including when several providers exist. Globally visible objects emit events from a namespace (`onDid…`), not from a private channel the host cannot see ([guidelines](https://github.com/microsoft/vscode/wiki/Extension-API-guidelines)). Eclipse states the same direction: the plug-in that declared the extension point evaluates the extensions ([PDE](https://help.eclipse.org/latest/topic/org.eclipse.pde.doc.user/concepts/extension.htm)).

Wasm composition wires the imports of a primary component to the exports of dependencies. The result keeps the primary exports, hides the dependency’s exports, and retains imports that were not satisfied ([composing components](https://component-model.bytecodealliance.org/composing-and-distributing/composing.html)). Unsatisfied imports are still visible. They are not silently granted.

**Adopt.** The dispatcher is the only caller of a FacePlugin export. A plugin does not push an effect into `authorize()`. Composition of two plugins does not union their caps. Child authority is a subset of the parent grant (`A_efectiva` already says this). An unsatisfied sandbox provider, version range, or cap is a visible refuse at Bind, not a best-effort start.

### 2.6 Observability is a host port, and a fitness function

Ford, Parsons, Kua, and (2nd ed.) Sadalage define an architectural fitness function as an objective integrity check of one or more architectural characteristics, implemented with tests, metrics, monitors, or logs, and run on a cadence so evolution does not silently rot a chosen property (*Building Evolutionary Architectures*, O’Reilly, 1st ed. 2017; [2nd ed. 2023](https://www.thoughtworks.com/content/dam/thoughtworks/documents/books/bk_building_evolutionary_architectures_second_edition_free_chapter.pdf); summary on [nealford.com](https://nealford.com/books/buildingevolutionaryarchitectures.html)). An evolutionary architecture supports incremental, guided change across several dimensions.

Forsgren, Humble, and Kim’s four keys are a *delivery* measure, not a plugin-host paper: lead time for changes, deployment frequency, mean time to restore, change fail rate ([Accelerate, 2018](https://itrevolution.com/articles/measure-software-delivery-performance-four-key-metrics/); [DORA 2018](https://dora.dev/research/2018/dora-report/)). They belong here only as **fitness functions applied to the host’s change stream**. Accelerate did not study Abaco, Janice, or plugin marketplaces. Using the four numbers that way is an adaptation, and it is labeled as one.

**Adopt.**

| Fitness function | Protects | Owner | Cadence |
|------------------|----------|-------|---------|
| Four asserts on every deny | Fail-closed mediation | Broker contract | Every deny (already specified) |
| Import graph: `authorize` / Bind do not import Atena or Jev | Role separation | Architecture test | CI |
| Catalog digest ≠ runtime digest → refuse | Dualism S6 | Bind | Every bind and reload |
| Cap-diff on manifest bump matches SemVer class | No silent widen | Catalog review | Every catalog change |
| Dependency rule: policy package does not import face, Electron, or sandbox technology | Hexagonal strong conformance | Architecture test | CI |
| Plugin change-fail rate; time to unload/revoke one plugin | Forsgren keys **adapted** to one actor | Ops fitness, not Jev | Continual, per `plugin_id` |

Jev may *read* a gray residue after these functions have run. Jev does not define them and does not replace a red fitness result with a percentage. Atena does not narrate a fitness failure into an allow.

VS Code’s extension host adds the mechanical version of the same idea: a fault in an extension is a fault in that host, and lazy activation keeps unused extensions out of the steady-state profile ([extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)). Host-emitted counters (`plugin_id` × canal × reason) are the sensor. A plugin’s own “I am healthy” field is not.

### 2.7 Evolution without a big-bang

Guided change, in Ford et al., is incremental *and* guarded by fitness functions. SemVer’s deprecation rule is the small version of the same idea: deprecate in a MINOR, remove in the next MAJOR, never edit a released version in place. VS Code finalizes an API only after it has lived as a proposal. Wasm composition produces a new component; it does not mutate the dependencies’ worlds.

F1 already has the authority half: `proposeContractEvolution` + `acceptContractEvolution({ hitl: true })` is the only runtime widen; it does not write the admission pin; a deny does not freeze admitted plugins.

**Adopt as a documentation rule for the next contracts.**

- A new FacePlugin schema version is added beside the old one. Bind accepts the majors it lists and refuses the rest.
- Studio does not land by rewriting `DEFAULT_PLUGIN_MANIFESTS`. It lands as a proposed schema that is absent from the default catalog until its own contract says otherwise.
- Removing a cap is a MAJOR of that plugin’s contract, with one MINOR that marks it deprecated first.
- No “hexagonal rewrite” milestone. The ports in §2.1 are names for seams the plan already shipped.

---

## 3 Anti-patterns

Two columns: failure modes already visible when a monolith grows features by import, and failure modes plugin hosts recreate if the seams are only labels. The plugin column cites either a public lesson or a surface already named in this tree (S1–S8 in research B). It does not invent a new threat taxonomy.

| # | Monolith habit | Plugin-host relapse | What to do instead |
|---|----------------|---------------------|--------------------|
| AP1 | Any module can call any sink because it can import it | A plugin imports host internals, or the host imports the face’s concrete class | Separated Interface owned by the host. Faces depend on the port, not on `authorize`’s module |
| AP2 | One process identity in the logs | Body `plugin_id` trusted as the caller | Canal identity (F1 M8). Bind records the canal that admitted the row |
| AP3 | Feature flag or “security mode” freezes the product | A deny or a reload pauses every admitted plugin | Doctrine delta: attenuate one id. Fitness: time-to-restore is per plugin |
| AP4 | Tests need the UI, the database, and a running app | Dispatcher tests boot Electron or a real sandbox | Cockburn’s test adapter on the same port. `DEFAULT_PLUGIN_MANIFESTS` is the fixture |
| AP5 | “We’ll clean the boundaries in the rewrite” | Big-bang port of Studio, Wasm, and the broker in one contract | Schema versions coexist. Studio stays proposed |
| AP6 | Shared mutable globals | A context bus every plugin can read and write; Eclipse-style `Platform` singleton as ambient authority | Host-owned context port, schema-validated, topic ACL. Curso 10’s shared context is this port, not a grab-bag |
| AP7 | One version number for the whole binary | One SemVer used both as “what I implement” and “what I accept” | OSGi consumer range vs provider range. Catalog rows are pins |
| AP8 | Unversioned internal calls | Shipping a draft hook as a stable manifest field | VS Code proposed-vs-stable. Studio fields cannot be published in the default catalog |
| AP9 | Start-up runs every subsystem | `activation: "*"` or `start()` that performs effects | Specific activation events. `*` only with a written exception, never for third-party |
| AP10 | No distinction between declared and running | Catalog digest treated as proof of what Janice loaded (S6) | Two digests. Mismatch refuses at Bind before any advisor sees it |
| AP11 | Security review is a meeting | Cap widen hidden inside a PATCH (F1 M9) | Cap-diff is a contract check. Widen is HITL, not a version cosmetic |
| AP12 | The clever service decides allow/deny | Atena or Jev imported by `authorize()` or by Bind | Advisors are outer adapters. They consume audit; they do not grant |
| AP13 | In-process try/catch called “isolation” | A sandbox *method on the plugin*, or a tier the plugin picks | Sandbox is a driven adapter. The host selects the tier. Honesty: a missing provider is tier `T0`, not “sandboxed” |
| AP14 | Composition by merging modules | Wiring two plugins unions their caps; Wasm-style composition that adds an import the world did not declare | Composition retains unsatisfied imports and hides dependency exports. Caps intersect; they do not union |
| AP15 | Resolver accepts anything | OSGi-style open-ended requirements, split packages, ranges of `*` | Few ports, explicit ranges, no split of a FacePlugin contract across packages |
| AP16 | Health is whatever the component prints | Plugin self-report is the pulse sensor (S8) | Host-emitted counters only. Jev ranks residue; it does not interview the plugin |
| AP17 | One more hook is cheap | Dozens of unversioned hooks “for flexibility” | Integrador default: a few versioned slots. New slot = schema MINOR or MAJOR, not a free-form string |
| AP18 | Framework types leak inward | FacePlugin methods that accept Electron events, Cordis inject bags, or SQL rows | Strong hexagonal conformance: the port’s data is the host’s DTO. Deep theater stays in the Electron adapter |

AP6 needs one careful sentence. Curso 10 (portable rules) says plugins communicate through a shared context, not through import spaghetti. That context is a **port with a schema**, owned by the host. It is not a singleton every face mutates. The Eclipse registry is a useful catalog; a global mutable `Platform` used as authority is the anti-pattern.

---

## 4 Role boundaries (do not merge)

```text
                    ┌──────────────────────────────────────────┐
                    │ HOST POLICY (small, dependency-inward)   │
                    │ identity · tenancy · catalog · audit     │
                    │ Bind · authorize() · dispatcher          │
                    └───────┬──────────────────────┬───────────┘
                            │ owns ports           │ executes grant
                            v                      v
                     adapters (outer)           Janice
                     sandbox provider           runtime only
                     face implementations       never grants
                     Atena  (advice)            never attests admit
                     Jev    (gray-band %)
```

| Name | Is | Calls | Never |
|------|----|-------|-------|
| **Host policy** | Microkernel: registry, Bind, broker, audit, dispatcher | Ports it owns | Face concrete types, Electron, Atena, Jev |
| **Bind** | CODE mechanism. Catalog row in, binding or refuse out | `authorize` only as the grant check the host already has | Start a `planned` or `blocked` row. Ask Atena or Jev whether to start. Attest admission |
| **Janice** | Runtime. Runs what a live grant allows | Dispatcher exports, sandbox adapter | `authorize`, mint caps, write admission, rank doubt |
| **FacePlugin** | Contract (interface + manifest row) | Only its declared imports, via the host | Widen its own caps, choose its sandbox tier, name Studio as if it were core |
| **Catalog** | Data. `DEFAULT_PLUGIN_MANIFESTS` is the sealed default set | Nothing | Be treated as the runtime digest |
| **Dispatcher** | Host → plugin calls | Bound exports | Plugin → broker pushes. Swallow a plugin fault into a host crash |
| **Sandbox** | Driven adapter implementing the isolation port | The technology (process, Wasm, container) | Be selected by the plugin, Atena, or Jev |
| **Atena** | Advisory SLM | Read what the host exposes for advice, off the hot path | `authorize`, Bind, grants, pin attest, spawn |
| **Jev** | Doubt-band ranker with a percentage | Host audit, after CODE fitness | `authorize`, Bind, mint caps, write admission or `patch.yml`, define fitness functions |
| **connectors** | Product language | — | Shipped APIs. Remains HOLD |

Bind is not a fourth persona. It is the function that makes Fowler’s “link at configuration time” deterministic and fail-closed. Janice may be the process in which Bind runs. That does not make Janice the grantor. If a document says “Janice binds” it means “the runtime invoked the Bind function,” not “the runtime decided authority.”

Phase S does not move because Jev is uneasy. A missing sandbox provider is a red fitness result (honest `T0` / in-process), which matches the Deep Harnes gap in [`SECURITY.md`](../SECURITY.md). The Python hub’s completed phase S is an adapter behind the same port, not a different authority story.

---

## 5 Checklist — FacePlugin, manifest, catalog

Use this list when editing a catalog row, a FacePlugin contract, or the default manifest set. It is aligned to the four Python Core seams (FacePlugin, `DEFAULT_PLUGIN_MANIFESTS`, dispatcher, sandbox) and to the broker rules already in this repo. A row that fails an item does not get a soft start.

### 5.1 FacePlugin contract

- [ ] The public API is written down (SemVer rule 1). The interface lives in the host package (Separated Interface).
- [ ] Exports the dispatcher may call are listed. Anything else is not callable.
- [ ] Imports (caps, host services, sandbox tier) are listed. Absence means no access (Wasm world rule).
- [ ] Data across the port is a host DTO. No Electron event, Cordis bag, ledger row, or framework page type on the signature.
- [ ] The face does not import `authorize`, Bind’s decider, Atena, or Jev.
- [ ] Provider range and consumer range are both stated when the face implements a host port and also calls one (OSGi split).
- [ ] `0.y.z` is marked unstable. It is not a default-catalog citizen unless the contract explicitly allows a pre-1.0 pin.
- [ ] Studio-only members are absent. They are proposed API, not stable FacePlugin.

### 5.2 One manifest row

- [ ] `id` is stable and is not a filesystem path or a display name.
- [ ] `version` matches SemVer `MAJOR.MINOR.PATCH` with no `v` prefix and no leading zeros.
- [ ] `schema_version` of the manifest document itself is present, so the row can be read after the next schema MINOR.
- [ ] `caps` are a ceiling. Effective authority is still `A_tarea ∩ A_plugin ∩ A_delegación ∩ A_política`.
- [ ] `activation` is a specific event. A catch-all equivalent to VS Code’s `*` is rejected for any non-host row.
- [ ] `sandbox_tier` is a requirement the **host** satisfies. The row cannot raise itself to a weaker tier than policy, and cannot claim a provider that is not configured.
- [ ] `status` of `planned` or `blocked` is refused by Bind. No dispatcher call.
- [ ] Risk `medium` or `high` does not start without human approval. Atena’s confidence is not that approval. Jev’s percentage is not that approval.
- [ ] No field is written by Atena or Jev. No `advice`, `score`, or `allow` key with authority semantics.
- [ ] Digest of the canonical row bytes is recorded next to the row (catalog digest input).

### 5.3 Catalog (`DEFAULT_PLUGIN_MANIFESTS`)

- [ ] The default set is closed at seal. Discovery cannot append a row that is not in the catalog or in an admitted ContractEvolution.
- [ ] Ids are unique.
- [ ] A catalog digest is published and is distinct from the runtime digest Bind writes after load.
- [ ] Mismatch refuses the bind (fail-closed) and emits a host audit. Jev is not consulted to “explain” the mismatch into an allow.
- [ ] Studio rows are not in the default set.
- [ ] The default set is a valid fixture: a dispatcher test can run on it with the fake sandbox adapter and no UI.
- [ ] Editing the default set is a reviewed contract change, same seriousness as editing [`f1-broker-deny-reasons.json`](../contracts/f1-broker-deny-reasons.json).

### 5.4 Bind, dispatcher, sandbox

- [ ] Bind is the only transition from a catalog row to a live binding.
- [ ] Unsatisfied import (cap, version range, sandbox provider) does not start and is reported as unsatisfied, not as an empty success.
- [ ] Identity stored on the binding is the canal, not a body field.
- [ ] The dispatcher calls the face. The face does not enqueue its own protected effects.
- [ ] A face exception or hang is contained by the sandbox port (or, if the provider is absent, the audit says `T0` and the host still does not treat the label “plugin” as isolation).
- [ ] One face failure does not unload the core or freeze admitted siblings.
- [ ] `authorize()` timeout or throw is deny, with the four asserts. The dispatcher has no second, softer path.

### 5.5 What “green” means

A change to a manifest or to FacePlugin is green only when the fitness functions in §2.6 that apply to it are green. Narrative review is not a substitute. Jev is not the reviewer of record.

---

## 6 Top 5 contract refactors (docs only, next 30 days)

No runtime, no JSON enum edit, no Studio implementation, no F1 reopen. Each item is a document under `docs/contracts/`. Order matters: later docs use names from earlier ones.

| # | When | Document | Done when |
|---|------|----------|-----------|
| 1 | First | **New** `CONTRACT-PLUGIN-HOST-PORTS.md` | One page: the six ports (catalog, Bind, FacePlugin, dispatcher, sandbox, `authorize`), who may import whom, Studio marked LATER, Atena/Jev drawn outside. Points at the naming law. Does not restate M1–M10 |
| 2 | Next | **New** `CONTRACT-FACEPLUGIN-MANIFEST.md` | Normative schema for one catalog row: fields in §5.2, consumer vs provider ranges, an example row that is documentation. States that `DEFAULT_PLUGIN_MANIFESTS` must validate against it. Forbids Studio keys and advisor authority keys |
| 3 | Parallel with 2, after 1’s names | **Amend** [`CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md) | Add a test-seam subsection (authorize tested through the port, zero advisor imports) and a catalog-digest ≠ runtime-digest clause. **Propose** deny-reason ids `catalog-runtime-mismatch`, `import-unsatisfied`, `sandbox-tier` in prose only |
| 4 | After 1 | **New** `CONTRACT-HOST-FITNESS.md` | The atomic functions in §2.6, with owners. The four Accelerate keys included only as adapted host fitness, with the citation caveat. Says Jev consumes residuals and does not author the functions |
| 5 | Last | **New** `CONTRACT-MANIFEST-EVOLUTION.md` | Coexistence of schema majors, deprecation in MINOR before removal, cap-diff rules, proposed-vs-stable (Studio stays proposed), ContractEvolution + HITL as the only runtime widen. Ties F1 M9 so a PATCH cannot change caps |

**Explicit non-action inside these 30 days:** do not edit [`f1-broker-deny-reasons.json`](../contracts/f1-broker-deny-reasons.json) in the same change as item 3. That file is loaded by `core/f1/effect_broker_contract.py`. Adding a reason is a versioned contract bump with the Python mirror, and it waits until item 3’s prose is accepted. Doing it now would be a runtime-adjacent edit dressed as a doc.

Item 1 is the only refactor that should land before the others, because items 2–5 will otherwise invent a second set of port names.

---

## 7 What not to copy

| Source | Leave behind |
|--------|----------------|
| OSGi | Split packages, `*` version ranges, resolver puzzles, equating “the bundle started” with “the bundle is allowed to touch the network.” Class-loader isolation is not a capability system |
| Eclipse | The workbench as the product, `plugin.xml` as an unbounded grab-bag, a global platform object used as authority, activating a plug-in in order to discover it |
| VS Code | APIs that feel synchronous while the host work is async, when the real rule is fail-closed. Proposed APIs shipped to a marketplace. `activationEvents: ["*"]` as a default |
| Wasm component model | Adopting WIT, `wac`, or a component binary as the Abaco manifest format. The lesson is the closed world (imports/exports), not the toolchain. Composition tools are not the dispatcher |
| Hexagonal / Clean | A folder rename (`domain/`, `adapters/`) without a dependency rule a test can fail. A “driven port” whose methods speak Electron, Cordis, or SQL |
| Microkernel | A second framework inside the host “so plugins feel native.” The host is the kernel; Cordis remains the Electron face’s mechanism |
| Evolutionary architecture / Accelerate | A fitness dashboard that replaces `authorize`. A claim that DORA measured plugin marketplaces. A big-bang “evolve the architecture” program |
| This repo’s Deep theater | `cordis.patch.yml`, preload allowlists, compact ratios `0.90/0.12/8192`, and `~/Library/Application Support/dsh-desktop/` as hub law |

---

## 8 Out of scope

- Rewriting Python Core, the dispatcher, the sandbox, or Deep Harnes.
- Implementing Studio FacePlugin or adding Studio rows to any catalog.
- A Jev client, an Atena import, or a change to `authorize()`.
- Editing `f1-broker-deny-reasons.json` or `core/f1/`.
- Reopening F1, F1.5, or F2.1.
- Merging this note to `main` without a human review.
- Connectors leaving HOLD.

---

## 9 Sources

Checked for this note. Quotes and mechanism claims in §2 follow these pages; the 1996 microkernel citation is the pattern’s bibliographic origin (no quotation from the book is used).

| Topic | Source |
|-------|--------|
| Ports and adapters | Alistair Cockburn, “The Hexagonal (Ports & Adapters) Architecture,” HaT Technical Report 2005.02, 2005-09-04. <https://alistair.cockburn.us/hexagonal-architecture> |
| Strong vs weak ports | Alistair Cockburn, *Hexagonal Architecture Explained* (updated edition of the 2005 pattern; driven port in domain language). <https://alistaircockburn.com/hexarch%20v1.1b%20DIFFS%2020250420-1012%20paper+epub.docx.pdf> |
| Dependency rule, testability | Robert C. Martin, “The Clean Architecture,” 13 August 2012. <https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html>. Book form: *Clean Architecture*, Prentice Hall, 2017 (not quoted here) |
| Plugin, configuration-time link | David Rice, Matt Foemmel, Martin Fowler, “Plugin,” *Patterns of Enterprise Application Architecture*, 5 March 2003. <https://martinfowler.com/eaaCatalog/plugin.html> |
| Interface owned by the client | Martin Fowler, “Separated Interface,” 5 March 2003. <https://martinfowler.com/eaaCatalog/separatedInterface.html> |
| Microkernel | Frank Buschmann, Regine Meunier, Hans Rohnert, Peter Sommerlad, Michael Stal, *Pattern-Oriented Software Architecture, Volume 1: A System of Patterns*, Wiley, 1996 |
| OSGi layers | OSGi Core Release 8, “Introduction.” <https://docs.osgi.org/specification/osgi.core/8.0.0/framework.introduction.html> |
| Consumer vs provider versions | OSGi Alliance, “Semantic Versioning,” technical white paper (version-part semantics and importer ranges). <https://docs.osgi.org/whitepaper/semantic-versioning/040-semantic-versions.html> |
| Eclipse extension contract | Azad Bolour, “Notes on the Eclipse Plug-in Architecture,” Eclipse Corner, 3 July 2003. <https://www.eclipse.org/articles/Article-Plug-in-architecture/plugin_architecture.html> |
| Extension point as socket | Eclipse PDE, “Extensions and Extension Points.” <https://help.eclipse.org/latest/topic/org.eclipse.pde.doc.user/concepts/extension.htm> |
| Lazy activation, exported API | Kim Moir, “Eclipse,” *The Architecture of Open Source Applications*, vol. 1. <https://aosabook.org/en/v1/eclipse.html> |
| Stable vs proposed API | VS Code wiki, “Extension API process.” <https://github.com/microsoft/vscode-wiki/blob/2dc037b1/Extension-API-process.md> |
| Providers, minimal surface, events | VS Code wiki, “Extension API guidelines.” <https://github.com/microsoft/vscode/wiki/Extension-API-guidelines> |
| Activation | VS Code, “Activation Events.” <https://code.visualstudio.com/api/references/activation-events> |
| Extension host | VS Code, “Extension Host.” <https://code.visualstudio.com/api/advanced-topics/extension-host> |
| WIT, components | Bytecode Alliance, “Component Model Concepts” and “WIT Reference.” <https://component-model.bytecodealliance.org/design/component-model-concepts.html>, <https://component-model.bytecodealliance.org/design/wit.html> |
| Closed world | Bytecode Alliance, “Worlds.” <https://component-model.bytecodealliance.org/design/worlds.html> |
| Composition does not invent imports | Bytecode Alliance, “Composing Components.” <https://component-model.bytecodealliance.org/composing-and-distributing/composing.html> |
| SemVer | Tom Preston-Werner, Semantic Versioning 2.0.0. <https://semver.org/spec/v2.0.0.html> |
| Fitness functions | Neal Ford, Rebecca Parsons, Patrick Kua, *Building Evolutionary Architectures*, O’Reilly, 2017. 2nd ed. with Pramod Sadalage, 2023. <https://nealford.com/books/buildingevolutionaryarchitectures.html>, <https://www.thoughtworks.com/content/dam/thoughtworks/documents/books/bk_building_evolutionary_architectures_second_edition_free_chapter.pdf> |
| Four delivery keys | Nicole Forsgren, Jez Humble, Gene Kim, *Accelerate*, IT Revolution, 2018. Public excerpt: <https://itrevolution.com/articles/measure-software-delivery-performance-four-key-metrics/> |

Internal law this note refuses to override:

- [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md)
- [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md)
- [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md)
- [`../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md)
- [`research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md`](research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md) (S1–S8; this note does not rewrite it)
