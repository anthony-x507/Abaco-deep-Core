# Frontier — permissions, capabilities, and attestation for plugin hosts (2026)

| Campo | Valor |
|-------|--------|
| **estado** | **RESEARCH** — docs only; no runtime, no `authorize()` edit, no merge to `main` by this note |
| **fecha** | 2026-09-22 |
| **teatro** | Plugin Frontiers / `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **audiencia** | Python Core Bind (Phase B) and Deep Harnes Phase S sandbox providers — reinforce, do not rewrite |
| **naming** | **Janice** executes. **Atena** advises (never grants). **Jev** scores doubt (never grants). **Bind** is deny-by-default `authorize()`. |
| **complementa** | [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md) — that paper owns T1–T12, S1–S8, and the Jev pulse. This note does not restate them. |
| **no toca** | Production runtime, `authorize()` bodies, Phase B/S implementations, F1 reopen |

---

## Resumen ejecutivo (ES)

Bind sigue siendo el único autorizador: deny-by-default, fallo cerrado, y ningún SLM en el camino de `authorize()`.
La frontera pública consultada (WASI 0.2, Capsicum, seL4, Deno, Chrome MV3, OPA, SPIFFE) coincide en lo mismo: no hay autoridad ambiental; el host entrega capacidades explícitas, atenuadas y revocables.
Un nombre de capability en un manifest no es un grant: la designación tiene que ser no falsificable y cada llamada tiene que chequear el valor concreto (ruta, host, monto).
Los preprints MiniScope (arXiv:2512.11147, 2025) y ScopeGate (arXiv:2606.28679, 2026) muestran que un modelo de lenguaje dentro del lazo de autorización no produce least-privilege; el encierro tiene que ser mecánico.
Atena aconseja y Jev puntúa la banda gris; ninguno otorga, atestigua admisión, ni se importa desde `authorize()`.
Janice solo ejecuta un grant vivo; la identidad del caller la atestigua el canal (selectores estilo SPIFFE, audiencia estilo RFC 8707), no el `plugin_id` del body.
Chrome MV3 y el Component Model fijan el techo de permisos en un paquete revisable: lo no declarado no se puede pedir, y el código ejecutable remoto no corre.
VS Code es el contraejemplo útil: un extension host sin capabilities y un flag de trust que pone el autor no sustituyen un sandbox.
En 30 días caben cinco refuerzos sobre el enum F1 que ya existe (`resource-not-in-grant`, `no-identity`, `budget-exceeded`, y hermanos): fallo cerrado definido, predicados de argumentos, techo de manifest, atestación de canal, y preopens atenuados en Phase S.
No adoptar: seL4 como host, OPA o SPIRE como grantor, Wasm como loader de Python Core, ni la confianza del modelo como allow.

---

## 0. How to read this note

The G47 paper already fixes the Abaco shape: governed plugins are more precise when mediation is real, Jev never grants, and Bind is the mechanical authorizer. This note answers a narrower question the paper leaves open: **which public permission and capability designs (2023–2026, plus the canonical systems they rest on) should tighten Bind and Janice, and which should be left alone.**

Every external claim below has a DOI, arXiv id, RFC, or official documentation URL. Internal Abaco law is cited by path. Nothing here is a license to put Atena or Jev inside `authorize()`.

```text
guest / plugin / tool call
        │
        ▼
Bind.authorize()          deterministic PDP
  inputs:  host-attested channel, pin, manifest ceiling,
           live grant, concrete arguments
  missing / throw / timeout / undeclared  →  deny
        │ allow (live grant only)
        ▼
Janice                    executor
  runs the effect on attenuated handles
  does not mint, widen, or attest

Atena, Jev                off this path
  may read audit later
  never a grant, never an attestor
```

Visible Python in **this** repository is the F1 deny-reason mirror (`core/f1/effect_broker_contract.py`, `docs/contracts/f1-broker-deny-reasons.json`). Phase B Bind and Phase S providers on the Python Core tip are treated as already present and out of edit scope. Recommendations below say how to **reinforce** them in a later implementation PR.

---

## 1. What the public frontier agrees on

### 1.1 Ambient authority is the defect

Saltzer and Schroeder’s least privilege (Proceedings of the IEEE, 1975, [doi:10.1109/PROC.1975.9939](https://doi.org/10.1109/PROC.1975.9939)) says every program should run with the smallest set of privileges needed for the job, so that an accident damages less and fewer programs must be audited. Hardy’s confused deputy (ACM SIGOPS OSR, 1988, [doi:10.1145/54289.871709](https://doi.org/10.1145/54289.871709)) is the failure mode that follows when a privileged helper holds its own authority and the caller’s authority in one ambient namespace and cannot tell which one a name refers to.

Four deployed systems refuse that shape:

| System | What “no ambient” means in the primary source |
|--------|-----------------------------------------------|
| **WASI** | A component starts with no access to the outside world. Filesystem, network, clocks, random, and environment are separate imports. The host instantiates only the imports it grants. The contract is statically inspectable in the binary. ([wasi.dev/security](https://wasi.dev/security), [Capabilities.md](https://github.com/WebAssembly/WASI/blob/main/docs/Capabilities.md)) |
| **Capsicum** | `cap_enter` drops access to global namespaces. Rights live on limited file descriptors the parent already opened and attenuated. (Watson, Anderson, Laurie, Kennaway, USENIX Security 2010, [paper](https://www.usenix.org/conference/usenixsecurity10/capsicum-practical-capabilities-unix)) |
| **seL4** | A capability is an unforgeable token. User code changes a resource only by invoking the capability that points at it. The root task receives the initial set; it does not conjure new authority from a string. ([seL4 capabilities tutorial](https://docs.sel4.systems/Tutorials/capabilities.html); Klein et al., SOSP 2009, [doi:10.1145/1629575.1629596](https://doi.org/10.1145/1629575.1629596)) |
| **Deno** | The runtime sandbox denies filesystem, network, environment, and subprocess until an explicit `--allow-*`. `--deny-*` overrides the matching allow. `-A` turns the sandbox off. ([Security and permissions](https://docs.deno.com/runtime/fundamentals/security/), [Permissions reference](https://docs.deno.com/runtime/reference/permissions/)) |

**Abaco reading.** Bind’s deny-by-default is this principle, not a style choice. Janice must not be able to reach host FS, net, env, or spawn except through a live grant. A plugin that can `open()` a path because the process can is still ambient, whatever the manifest says.

### 1.2 A manifest string is not a capability

WASI distinguishes **link-time** capabilities (imports satisfied when the component is instantiated) from **runtime** capabilities (handles you pass around). Multiple live files require handles, because a single link-time import cannot name them apart ([Capabilities.md](https://github.com/WebAssembly/WASI/blob/main/docs/Capabilities.md)). seL4 stores capabilities in kernel CSlots; copying can restrict rights, and deletion revokes ([tutorial](https://docs.sel4.systems/Tutorials/capabilities.html)). The 2014 TOCS account of seL4 includes a proof of access-control enforcement, not only functional correctness (Klein et al., [doi:10.1145/2560537](https://doi.org/10.1145/2560537)).

Hardy’s remedy is the same idea at application level: the deputy must **designate** the capability it means to use. A filename in an ambient namespace does not designate.

**Abaco reading.** `fs.read` in a manifest is a ceiling label. The grant Bind mints is a host object bound to channel, plugin digest, effect, and resource. The body cannot present a string and have it accepted as that object. F1 already says identity is the channel. This note adds the public reason: designation and authority travel together, or the deputy stays confused.

### 1.3 Exposing a tool is not authorizing a call

Zuvic, *Capability Gates Are Not Authorization* (arXiv preprint, 2026, [arXiv:2606.28679](https://arxiv.org/abs/2606.28679)), audits LangChain/LangGraph, LlamaIndex, and the Stripe Agent Toolkit at pinned public commits. All three gate which tools are exposed. None, by default, re-authorizes each model-emitted call **with concrete argument values** before execution, fail-closed. The paper’s ScopeGate control is a deterministic five-stage PDP/PEP: scope, authorization, money ceiling, idempotency, default deny. The preprint is explicit that it does not claim the first least-privilege design, and that prompt injection was already known. The claim used here is the narrower one: **a capability gate plus a schema-valid argument object is not an authorization decision.**

Zhu et al., *MiniScope* (arXiv preprint, 2025, [arXiv:2512.11147](https://arxiv.org/abs/2512.11147)), make the complementary point: least privilege for tool-calling agents has to be **mechanical**. Putting an LLM in the confinement loop, with a natural-language instruction to “be least privilege,” does not yield a guarantee. Their enforcement is a permission hierarchy plus user confirmation, not a second model that allow/denies.

Chrome’s split matches both papers in a shipping API:

- Required permissions and `host_permissions` are install-time ceilings ([Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)).
- `optional_permissions` / `optional_host_permissions` can be granted only if predeclared, and only from a user gesture via `permissions.request`. An undeclared permission cannot be requested ([chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)).
- `activeTab` is a temporary grant for the invoked tab. It dies on navigation away or close, and exists so extensions do not need standing `<all_urls>` ([activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)).

**Abaco reading.** The F1 reason `effect-not-in-grant` is the capability gate. The F1 reason `resource-not-in-grant` is the per-call value check (path prefix, host, amount, spawn argv). Both are CODE. Atena may explain a deny after the fact. Atena does not decide the amount was “probably fine.”

### 1.4 Undefined must not mean allow

OPA/Rego rules that do not match are **undefined**, not false. Deny-by-default is an explicit `default allow := false`, so a missing field or a forgotten rule still returns false ([Policy Language](https://www.openpolicyagent.org/docs/policy-language), [default keyword](https://openpolicyagent.org/docs/policy-reference/keywords/default)).

Wasmtime’s fuel store starts at **0** until the embedder calls `set_fuel`; with fuel enabled and no grant of fuel, execution traps. Epoch interruption traps immediately if no deadline was configured ([Config](https://docs.wasmtime.dev/api/wasmtime/struct.Config.html), [Store](https://docs.rs/wasmtime/latest/wasmtime/struct.Store.html)).

Deno’s `--deny-*` flags take precedence over `--allow-*` ([Permissions](https://docs.deno.com/runtime/reference/permissions/)).

**Abaco reading.** Bind already says throw and timeout are deny, and the four asserts require `decision === deny`, `side_effect === false`, an audit event, and `denyCount++` (`docs/contracts/f1-broker-deny-reasons.json`). The OPA footgun to copy as a test, not as an engine: a missing predicate, an empty grant set, or an exception in a predicate must evaluate to the same deny record. There is no third state called “policy did not say.”

### 1.5 The host attests identity; the guest does not

SPIFFE defines an SVID as a document a workload uses to present an identity that a trust-domain authority has signed. SPIRE registration binds a SPIFFE ID to **selectors the agent can verify** (process, Kubernetes, cloud), not to a name the workload types into a request ([SPIFFE ID and SVID](https://spiffe.io/docs/latest/spiffe-specs/spiffe-id/), [Registering workloads](https://spiffe.io/docs/latest/deploying/registering/)). The SPIFFE spec warns that arbitrary extra fields in an SVID are unsafe to consume as a security decision unless issuer and consumer share the meaning ([same spec](https://spiffe.io/docs/latest/spiffe-specs/spiffe-id/)).

MCP authorization (spec revision 2025-06-18) is **transport-level** OAuth for HTTP. Clients must send a resource indicator (RFC 8707) so a token is bound to the MCP server’s audience; servers must reject tokens whose audience is not themselves ([MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)). That stops a token minted for server A from being replayed at server B. It does not, in that specification, authorize a particular tool argument.

**Abaco reading.** Keep using these as patterns, not as products (see §4):

- Caller identity is a host-verified channel (the SPIRE selector analogue). `plugin_id` in the body is not a selector.
- A grant’s audience is the tuple (channel, plugin digest, effect, resource prefix). Presenting it for another plugin or another prefix is deny (`no-identity` or `resource-not-in-grant`), the same job RFC 8707 does for tokens.
- A live MCP session is not a Bind grant. Transport auth answers “who may speak to this server.” Bind answers “may this call run.”

### 1.6 The executor is not the policy decision point

OPA is a policy engine. SPIRE’s server authorization calls OPA and then applies its own allow predicates (`allow`, `allow_if_local`, `allow_if_admin`, …). The Rego document does not itself perform the privileged operation ([SPIRE authorization policy engine](https://github.com/spiffe/spire/blob/main/doc/authorization_policy_engine.md)). seL4’s kernel checks capability invocation; the user thread does not. WASI’s host decides the imports; the guest only calls what was linked ([Bytecode Alliance, WASI 0.2](https://bytecodealliance.org/articles/WASI-0.2), [WIT worlds](https://component-model.bytecodealliance.org/design/worlds.html): “if a component does not have an import for a secret store, then it cannot access that secret store, even if the store is running in the same process”).

**Abaco reading.** Bind is the PDP. Janice is the PEP that executes an allow. This is already naming law. The frontier sources are why a later “smarter authorize” that imports Atena or Jev is a category error: the advisor would become a second PDP whose output is not a capability and whose failure mode is undefined (see §1.4).

### 1.7 A memory sandbox is not an effect sandbox

Johnson et al., *WaVe* (IEEE S&P 2023, [doi:10.1109/SP46215.2023.10179357](https://doi.org/10.1109/SP46215.2023.10179357)), show that verified Wasm memory safety stops at the sandbox boundary. WASI hostcalls are outside that contract. Their verified runtime exists because ad-hoc hostcall wrappers have been where isolation breaks. Ramesh et al., *WALI* (arXiv preprint, 2023, [arXiv:2312.03858](https://arxiv.org/abs/2312.03858)), argue the opposite layering on purpose: a thin syscall surface, with capability policy (WASI) implemented **above** it so policy stays replaceable. Both papers agree the policy boundary and the memory boundary are different mechanisms.

Edirimannage et al. (arXiv preprint, 2024, [arXiv:2411.07479](https://arxiv.org/abs/2411.07479)) analyze 52,880 VS Code extensions and report that the extension host process is not sandboxed, while the renderer is. Official docs describe a different control: Workspace Trust and Restricted Mode, with the extension declaring `capabilities.untrustedWorkspaces.supported` as `true`, `false`, or `limited` ([Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)). `extensionKind` chooses UI vs workspace host, local or remote ([Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)). That is placement and a trust bit, not a capability lattice. The paper treats a voluntary `supported: true` as something a malicious extension can set. Use that as the negative example. Do not copy it.

**Abaco reading.** Phase S is what makes “blast radius = one plugin” a true sentence. Jev cannot substitute for it (already said in the G47 paper). WaVe is why a Phase S provider’s **hostcall wrappers** are in the TCB: a guest that cannot corrupt Wasm memory can still be handed the host filesystem by a sloppy import. WALI is why Bind stays above the sandbox syscall surface rather than being smeared into every provider.

### 1.8 Reviewed bytes, virtualized imports, finite budgets

Manifest V3 requires extension logic to ship inside the package. Remotely hosted executable code (JavaScript, Wasm) is a Chrome Web Store violation, with narrow documented exceptions (user scripts, debugger) ([What is MV3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3), [remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [MV3 additional requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)). Data files may be remote. Logic may not.

WASI-Virt (Bytecode Alliance) composes a virtualization component that can allow, deny, remap, or fully encapsulate clocks, env, filesystem preopens, HTTP, sockets, and stdio. Encapsulation is the CLI default ([wasi-virt](https://github.com/bytecodealliance/wasi-virt)).

**Abaco reading.** Pin plus “no URL entrypoint” is the MV3 rule. Phase S preopens and host allowlists are the WASI-Virt rule, scaled to what a Python provider can actually enforce. Fuel/epoch is the budget rule already named `budget-exceeded`.

### 1.9 Audit the decision, not the secret

OPA decision logs record `decision_id`, policy path, input, result, bundle revision, and timestamp. A separate mask policy erases or redacts fields (passwords, and similar) before upload, and the event lists what was erased ([Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs)).

**Abaco reading.** F1 already requires an audit event on deny. Extend the same record on allow: grant id, manifest/pin revision, effect, resource **hash or prefix**, decision. Do not log raw secrets, transcripts, or tool-result bodies. Atena and Jev, if they run at all, consume that record later. They are not fields of the decision.

---

## 2. Synthesis table

Effort is the cost of a **reinforcement** on Python Core Bind / Deep Harnes Phase S, assuming the existing F1 enum and naming law. “Pattern only” means copy the rule, not the product.

| Idea | Fuente | Aplicabilidad Abaco Bind / Janice | Esfuerzo | Riesgo si no |
|-----|--------|-----------------------------------|----------|--------------|
| No ambient authority. Host grants explicit, scoped capabilities. Deny overrides a broader allow. | [WASI security](https://wasi.dev/security); [Deno permissions](https://docs.deno.com/runtime/reference/permissions/); [Capsicum](https://www.usenix.org/conference/usenixsecurity10/capsicum-practical-capabilities-unix); Saltzer & Schroeder [doi:10.1109/PROC.1975.9939](https://doi.org/10.1109/PROC.1975.9939) | Bind stays deny-by-default. Janice receives attenuated handles only. A shipped profile has no allow-all switch. | Small: assert it in Phase S provider config and Bind tests | Undeclared `fs`/`net`/`spawn` runs with process power. Plugin labels become false precision. |
| Capability = unforgeable designation + rights, not a string the guest utters. | [seL4 capabilities](https://docs.sel4.systems/Tutorials/capabilities.html); Klein et al. [doi:10.1145/1629575.1629596](https://doi.org/10.1145/1629575.1629596), access-control proof [doi:10.1145/2560537](https://doi.org/10.1145/2560537); Hardy [doi:10.1145/54289.871709](https://doi.org/10.1145/54289.871709) | Grant object is minted by Bind, stored host-side, invoked by id. Body `plugin_id` does not mint it. | Medium: grant record + lookup, no new authorizer | Confused deputy: plugin B’s name is accepted as plugin A’s authority. |
| Link-time import set is a statically visible ceiling. Runtime handles name distinct resources. | [WASI Capabilities.md](https://github.com/WebAssembly/WASI/blob/main/docs/Capabilities.md); [WIT worlds](https://component-model.bytecodealliance.org/design/worlds.html); [WASI 0.2 launch](https://bytecodealliance.org/articles/WASI-0.2) | Manifest caps are the ceiling. Task grant ⊆ ceiling ∩ policy ∩ delegation. One `fs.read` label is not “every path.” | Medium: cap-diff at admission | Version bump silently widens authority (S4 in the G47 paper). |
| Attenuate by composition: preopens, remaps, deny lists. Encapsulation is the default where the provider can do it. | [wasi-virt](https://github.com/bytecodealliance/wasi-virt); Capsicum rights-then-`cap_enter` | Phase S: parent opens and limits; provider drops ambient. Deep Harnes in-process cells do not get to claim this until the provider exists. | Medium inside 30 days for a subprocess profile; not a Wasm rewrite | “Sandboxed” plugin still resolves host paths. |
| Install-time ceiling, runtime subset, user gesture for anything broader, short TTL. | [Chrome declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions); [chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions); [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) | Undeclared effect is hard deny (`effect-not-in-grant`). Medium/high widen stays HITL. Prefer task-scoped grants over standing host-wide caps. | Medium, mostly policy data + tests | Standing `<all_urls>` equivalent on every admitted plugin. |
| Executable bytes live in the reviewed package. Remote data is not remote code. | [MV3 overview](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3); [remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code); [store policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) | URL entrypoints and fetched Wasm/JS/Python that becomes the plugin body are deny at admission. Pin stays the witness. | Small, admission rule | Supply-chain logic that review never saw. |
| Missing rule, throw, timeout, empty fuel = defined deny. | [OPA default](https://openpolicyagent.org/docs/policy-reference/keywords/default); [Wasmtime fuel/epoch](https://docs.wasmtime.dev/api/wasmtime/struct.Config.html) | Four asserts already specified. Add tests: exception in a predicate, absent grant, unset budget → deny, `side_effect: false`. | Small | Fail-open the first time a predicate throws. |
| Per-call authorization of argument **values**, separate from tool exposure. Idempotency and numeric ceilings are CODE. | Zuvic [arXiv:2606.28679](https://arxiv.org/abs/2606.28679) (preprint; not a journal version) | Bind checks path prefix, host, amount, argv against the live grant before Janice. Reason: `resource-not-in-grant`. Schema-valid JSON is not enough. | Medium, one predicate family per existing `effect_kinds` | Model- or attacker-supplied path/amount is executed because the tool name was allowed. |
| Least privilege is computed and confirmed by CODE + human. An SLM in the loop is not a proof. | Zhu et al. [arXiv:2512.11147](https://arxiv.org/abs/2512.11147) (preprint) | **Pattern only.** Keep HITL for medium/high and ContractEvolution. Do not ask Atena or Jev to emit the minimal grant. | None in the authorizer (the work is refusing the design) | “Advisory confidence” becomes an allow. |
| Host-attested selectors. Extra claims in the credential are not authority. | [SPIFFE SVID](https://spiffe.io/docs/latest/spiffe-specs/spiffe-id/); [SPIRE registration](https://spiffe.io/docs/latest/deploying/registering/) | Channel + pin digest are the selectors. Skills, docs, memory, tool-results remain data (already law). | Medium: require those fields on the grant | Guest-asserted identity; data plane widens control. |
| Audience-bind every credential. Transport auth ≠ tool auth. | [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707); [MCP authorization 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) | Grant audience is (channel, plugin, effect, resource prefix). An MCP bearer token does not skip Bind. | Medium, checked in the same predicate pass | Cross-plugin or cross-server replay of a still-valid token. |
| Decision log: id, policy/pin revision, input shape, result. Mask secrets before persist. | [OPA decision logs](https://www.openpolicyagent.org/docs/management-decision-logs) | Allow and deny both audit. Log prefixes and hashes. Jev/Atena are consumers, not columns that grant. | Small–medium | Incident response cannot replay why an allow happened; or the log becomes a secret store. |
| Memory isolation and hostcall policy are different TCBs. A trust flag the author sets is not a sandbox. | WaVe [doi:10.1109/SP46215.2023.10179357](https://doi.org/10.1109/SP46215.2023.10179357); WALI [arXiv:2312.03858](https://arxiv.org/abs/2312.03858); Edirimannage et al. [arXiv:2411.07479](https://arxiv.org/abs/2411.07479); [VS Code Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust) | Phase S wrappers are reviewed as TCB. Do not add a `trusted: true` manifest bit that skips Bind. Do not claim per-plugin blast on in-process Deep cells. | Honesty now; Phase S profile in the 30-day list | False precision, and a plugin-controlled bypass of Restricted-Mode style gates. |
| PDP and executor stay apart. | [SPIRE policy engine](https://github.com/spiffe/spire/blob/main/doc/authorization_policy_engine.md); naming law [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) | Zero imports of Atena/Jev from `authorize()`, pin verify, admission mutate. Janice does not attest. | Small CI check, already required by naming review | Hot-path SLM; Janice-as-grantor (`janice-is-runtime`). |

---

## 3. Top 5 implementable in 30 days

These five fit one implementation window on Python Core Bind and Deep Harnes Phase S **without** a new authorizer, a Wasm loader, or an SLM. They reuse the deny reasons already in `docs/contracts/f1-broker-deny-reasons.json`: `no-identity`, `effect-not-in-grant`, `resource-not-in-grant`, `trust-ceiling`, `ttl-expired`, `budget-exceeded`, `grant-revoked`, `policy`, `data-as-control`.

This document does not implement them. A later PR may. That later PR still does not import Atena or Jev into `authorize()`.

Naming-law reasons `atena-cannot-grant` and `janice-is-runtime` are specified in [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) and are **absent** from the shared JSON enum. Adding them is a contract change for that later PR, not this one.

### 1. Defined fail-closed — days 1–4

**Source.** OPA `default allow := false`. Wasmtime fuel starts at 0. F1 four asserts.

**Where.** Tests around the existing Bind/broker contract. Python Core Phase B and the Deep broker, same semantics.

- [ ] Absent grant, empty capability set, unknown effect → deny `effect-not-in-grant` or `policy`, `side_effect: false`, audit, `denyCount++`.
- [ ] Predicate throws, or the authorizer exceeds its deadline → same deny. No “soft allow.”
- [ ] Unset resource budget on a Phase S store → trap / deny `budget-exceeded` before the guest runs. Do not default the budget to unlimited.
- [ ] `planned` / `blocked` plugins do not start (already doctrine; keep the test).
- [ ] Search the authorizer import graph: zero modules named Atena or Jev.

**Done when.** A red test exists for each bullet and passes against the contract mirror plus the live authorizer in a follow-up PR.

### 2. Manifest ceiling and cap-diff — days 3–10

**Source.** WASI worlds (imports are the ceiling). Chrome: undeclared permissions cannot be requested; optional grants are a subset, from a user gesture.

**Where.** Admission on Python Core and Deep. Review-time check, not an LLM.

- [ ] Loader refuses an effect that is not in the manifest ceiling (`effect-not-in-grant`).
- [ ] A task grant that is not a subset of ceiling ∩ delegation ∩ policy is deny `trust-ceiling`.
- [ ] CI diffs manifest caps against the last admitted pin. Added caps or widened resource prefixes fail the check unless a HITL widen record is in the change (ContractEvolution pattern already in F1).
- [ ] Entry that is a URL, or a digest that does not match the pin, does not load (MV3 remote-code rule, mapped onto the existing pin).
- [ ] Medium/high start and any widen still require a human. Atena text may sit in the review packet. It is not the approval bit.

**Done when.** A fixture plugin with one new cap and no HITL record is rejected, and a fixture whose entry is `https://…` is rejected.

### 3. Per-call value predicates — days 8–18

**Source.** arXiv:2606.28679 (capability gate ≠ argument authorization). F1 already has `resource-not-in-grant` and effect kinds `fs.read`, `fs.write`, `net.fetch`, `proc.spawn`, `tool.call`, `host.fetch`.

**Where.** Bind, before Janice. Deterministic predicates. No model call.

- [ ] `fs.read` / `fs.write`: path must fall under a prefix carried by the live grant. `..`, symlink escape, and absolute paths outside the prefix → `resource-not-in-grant`.
- [ ] `net.fetch` / `host.fetch`: host (and scheme, port) must be in the grant’s host list. DNS rebinding is out of scope for this slice; the check is on the requested URL the broker sees.
- [ ] `proc.spawn`: executable id must be the granted binary id (the Deep voice path already authorizes `bin:mlx_whisper` and `bin:ffmpeg` before execute). Free-form argv that smuggles another binary → deny.
- [ ] Numeric ceilings (bytes, amount, fanout) live on the grant. Over ceiling → `budget-exceeded` or `resource-not-in-grant`, documented per field.
- [ ] Idempotency key, when the effect is not safe to repeat, is stored on the grant. Replay of a completed key does not run a second side effect.
- [ ] Schema-valid arguments that fail a predicate are still deny. The tool remaining in the exposed set is not an allow.

**Done when.** One table-driven test per effect kind above: in-prefix allow, out-of-prefix deny, and “tool was exposed but path was `/etc/…`” deny. Janice is not invoked on the deny rows.

### 4. Host-attested channel on the grant — days 12–20

**Source.** SPIFFE/SPIRE selectors. RFC 8707 audience. F1 `no-identity` and “identity = channel.”

**Where.** Grant mint path. Not a SPIRE deployment.

- [ ] Mint requires a host channel id and a plugin digest that matches the pin. Missing either → `no-identity`.
- [ ] Body `plugin_id` that disagrees with the channel is ignored as authority and audited. It must not select the grant.
- [ ] Grant stores an audience tuple. A call whose effect or resource prefix is outside that tuple → `resource-not-in-grant`.
- [ ] `attestor` / `source` values `atena`, `jev`, and `janice` cannot mint (naming law). When the enum grows, those denies are `atena-cannot-grant` and `janice-is-runtime`. Until then, `policy` plus an audit field is acceptable if the reason string is stable.
- [ ] Skills, docs, memory, transcripts, and tool-results cannot add selectors (`data-as-control`).
- [ ] An MCP (or other) bearer token is checked as transport identity only. It is not passed through as a Bind allow.

**Done when.** A test sends a matching body `plugin_id` on the wrong channel and is denied, and a test presents plugin A’s grant to plugin B’s effect and is denied.

### 5. Attenuated Phase S profile — days 15–30

**Source.** Capsicum (rights-limit, then drop the global namespace). Deno scoped allow plus deny-overrides-allow. WASI preopens and wasi-virt encapsulation. Wasmtime fuel/epoch as the budget shape, not as a mandate to embed Wasmtime.

**Where.** Phase S sandbox providers (Python Core tip and Deep Harnes cell/subprocess). Do not retarget the Python loader at the Component Model in this window (HOLD remains).

- [ ] Provider config lists preopened roots and allowed hosts. Default lists are empty.
- [ ] A deny entry wins over a broader allow (Deno rule). There is no profile flag equivalent to `deno -A` on a shipped or third-party plugin.
- [ ] The privileged parent opens and limits; the guest receives handles or a jailed root. The guest does not get the host ambient `open`.
- [ ] Wall-clock and output-byte budgets are set before start. Unset means do not start (`budget-exceeded`), not “run forever.”
- [ ] Provider crash or hang is contained to that plugin (existing isolation law). It does not mint a wider grant on restart.
- [ ] Document, in the provider’s own README or contract, that in-process Deep plugins **without** this profile are still process-scoped. Do not describe them as Capsicum- or WASI-isolated.

**Done when.** A provider test shows a guest denied on a path outside the preopen, a deny-entry overriding an allow, and a missing budget refusing start. No Wasm engine is added.

### Order and non-goals for the 30 days

Do 1 before 3: value predicates that throw must already fail closed. Do 2 before trusting any new cap in 5. Do not start a Component Model port, an OPA deployment, or a SPIRE cluster in this window.

---

## 4. What not to adopt, and why

| Proposal | Why not |
|----------|---------|
| **seL4 as the Abaco host, or a verified microkernel port** | The SOSP 2009 and TOCS 2014 results are about a ~9k-line kernel with a proof assumption set (compiler, assembly, hardware in the original proof; later work extends some of that). Abaco’s TCB is an application host. Copy **unforgeable invocation and revocation**. Do not copy the kernel. |
| **WALI (arXiv:2312.03858) as the plugin ABI** | The paper’s point is layering: thin syscalls, policy above them. Python Core already has a course-10 loader and Bind. Replacing that ABI with a Wasm syscall shim is a new product, and it fights the HOLD on Wasm. |
| **WaVe-style mechanical verification of the runtime in this window** | Right target for a WASI runtime vendor. Wrong size for a 30-day Bind reinforcement. The transferable requirement is narrower: hostcall wrappers are TCB and get tests (item 5). |
| **Wasm Component Model as the Python Core loader** | Already HOLD in [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md). Worlds and preopens are the pattern for manifests and Phase S. The loader stays the Python course-10 stack. |
| **OPA as `authorize()`** | The useful fragment is `default allow := false` plus a decision record. Adopting Rego adds a second language in the grant path, and the undefined-vs-false footgun is exactly what Bind must not grow. SPIRE itself treats OPA as a policy document the server interprets; it does not let Rego perform the privileged call. |
| **SPIRE, SVIDs, or the Delegated Identity API as the plugin identity plane** | Selectors-attested-by-the-host is the pattern (item 4). A local desktop / single-process host does not need a SPIRE agent. The Delegated Identity API lets an authorized delegate fetch SVIDs for workloads the agent does not attest directly ([spire agent doc](https://github.com/spiffe/spire/blob/main/doc/spire_agent.md)). That is Janice-or-Atena-as-attestor. Do not build it. |
| **MCP OAuth as a substitute for Bind** | The 2025-06-18 spec authorizes the HTTP transport and binds token audience (RFC 8707). It does not evaluate tool arguments. Treating a session as a grant reintroduces the confused deputy ScopeGate measures. |
| **VS Code extension-host + Workspace Trust as the security model** | Official controls are process placement and a developer-declared trust flag ([extension host](https://code.visualstudio.com/api/advanced-topics/extension-host), [workspace trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)). arXiv:2411.07479 is the field report that this is not a capability sandbox. Do not add `untrustedWorkspaces.supported`-style self-classification that skips mediation. |
| **Chrome `declarativeNetRequest` as the mediation model** | MV3 replaced a blocking webRequest proxy for browser performance and privacy ([MV3 overview](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)). Abaco’s problem is host effects, not ad filtering. Take the permission ceiling and the remote-code ban. Leave the network-rules engine. |
| **MiniScope’s ILP scope solver as Bind** | The preprint’s guarantee is “mechanical, not an LLM.” The solver, OAuth hierarchy mining, and mobile-style prompts are a research stack. Abaco already has intersection grants and HITL. Do not replace them with an integer program, and do not implement the paper’s “second LLM writes the policy” baseline. |
| **Atena or Jev inside `authorize()`, or an SLM that emits grants** | Contradicts naming law and both 2025–2026 preprints above. Confidence, gray-band percent, and narrative advice are not capabilities. They may read audit. They may not set `decision`. |
| **`deno -A` / `--allow-all` as the developer default that ships** | Deno documents `-A` as turning the sandbox off ([security](https://docs.deno.com/runtime/fundamentals/security/)). A dev convenience that becomes the third-party profile is ambient authority with extra steps. |
| **Plugin-authored “I am healthy / I am trusted” bits** | Same failure as a voluntary Workspace Trust flag, and the same failure as S8 in the G47 paper (self-reporting liars). Sensors stay host-side. |

---

## 5. What this does not change

- `authorize()` remains the only grantor. No import of Atena or Jev is added.
- Janice remains the executor of a live grant. It does not attest admission or mint caps.
- F1 is not reopened. The deny-reason JSON is not edited here.
- Phase B Bind and Phase S providers are not rewritten here.
- Connectors stay HOLD. Wasm/CAPMAS stay HOLD.
- The G47 pulse (cadence, FeatureBag, gray-band percent, L0–L5) stays in [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md). This note does not retune it.
- Honesty carried over: without a real Phase S profile, Deep Harnes in-process plugins do not inherit Capsicum or WASI blast-radius claims.

---

## 6. Sources

Primary external sources only. Preprints are marked as preprints.

| Id | Citation |
|----|----------|
| Saltzer & Schroeder 1975 | J. H. Saltzer, M. D. Schroeder, “The Protection of Information in Computer Systems,” *Proceedings of the IEEE* 63(9), 1975. [doi:10.1109/PROC.1975.9939](https://doi.org/10.1109/PROC.1975.9939). Least privilege, §I.A.f in the authors’ text. |
| Hardy 1988 | N. Hardy, “The Confused Deputy (or why capabilities might have been invented),” *ACM SIGOPS Operating Systems Review* 22(4), 1988. [doi:10.1145/54289.871709](https://doi.org/10.1145/54289.871709). |
| Capsicum 2010 | R. N. M. Watson, J. Anderson, B. Laurie, K. Kennaway, “Capsicum: Practical Capabilities for UNIX,” USENIX Security 2010. <https://www.usenix.org/conference/usenixsecurity10/capsicum-practical-capabilities-unix>. |
| seL4 SOSP 2009 | G. Klein et al., “seL4: Formal Verification of an OS Kernel,” SOSP 2009. [doi:10.1145/1629575.1629596](https://doi.org/10.1145/1629575.1629596). |
| seL4 TOCS 2014 | G. Klein et al., “Comprehensive Formal Verification of an OS Microkernel,” *ACM TOCS* 32(1), 2014. [doi:10.1145/2560537](https://doi.org/10.1145/2560537). Includes the access-control enforcement proof. |
| seL4 manual (tutorial) | seL4 docs, “Capabilities.” <https://docs.sel4.systems/Tutorials/capabilities.html>. |
| WASI security | <https://wasi.dev/security>. |
| WASI capabilities | WebAssembly WASI, `docs/Capabilities.md`. <https://github.com/WebAssembly/WASI/blob/main/docs/Capabilities.md>. |
| WASI 0.2 | Bytecode Alliance, “WASI 0.2 Launched.” <https://bytecodealliance.org/articles/WASI-0.2>. Release record: <https://github.com/bytecodealliance/wasi.dev/blob/main/docs/releases/wasi-p2.md>. |
| WIT worlds | <https://component-model.bytecodealliance.org/design/worlds.html>. |
| wasi-virt | <https://github.com/bytecodealliance/wasi-virt>. |
| WaVe 2023 | E. Johnson et al., “WaVe: a verifiably secure WebAssembly sandboxing runtime,” IEEE S&P 2023. [doi:10.1109/SP46215.2023.10179357](https://doi.org/10.1109/SP46215.2023.10179357). |
| WALI 2023 | A. Ramesh, T. Huang, B. L. Titzer, A. Rowe, “Empowering WebAssembly with Thin Kernel Interfaces.” Preprint. [arXiv:2312.03858](https://arxiv.org/abs/2312.03858). |
| Deno | <https://docs.deno.com/runtime/fundamentals/security/>, <https://docs.deno.com/runtime/reference/permissions/>. |
| Chrome MV3 | <https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3>, <https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions>, <https://developer.chrome.com/docs/extensions/reference/api/permissions>, <https://developer.chrome.com/docs/extensions/develop/concepts/activeTab>, <https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code>, <https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements>. |
| VS Code | <https://code.visualstudio.com/api/extension-guides/workspace-trust>, <https://code.visualstudio.com/api/advanced-topics/extension-host>. |
| VS Code ecosystem study | S. Edirimannage et al., “Developers Are Victims Too: A Comprehensive Analysis of The VS Code Extension Ecosystem.” Preprint. [arXiv:2411.07479](https://arxiv.org/abs/2411.07479). |
| OPA | <https://www.openpolicyagent.org/docs/policy-language>, <https://www.openpolicyagent.org/docs/policy-reference/keywords/default>, <https://www.openpolicyagent.org/docs/management-decision-logs>. |
| SPIFFE / SPIRE | <https://spiffe.io/docs/latest/spiffe-specs/spiffe-id/>, <https://spiffe.io/docs/latest/deploying/registering/>, <https://github.com/spiffe/spire/blob/main/doc/authorization_policy_engine.md>, <https://github.com/spiffe/spire/blob/main/doc/spire_agent.md>. |
| RFC 8707 | “Resource Indicators for OAuth 2.0,” RFC 8707. <https://www.rfc-editor.org/rfc/rfc8707>. |
| MCP authorization | Model Context Protocol specification, revision 2025-06-18, authorization. <https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>. |
| Wasmtime budgets | <https://docs.wasmtime.dev/api/wasmtime/struct.Config.html>, <https://docs.rs/wasmtime/latest/wasmtime/struct.Store.html>. |
| MiniScope 2025 | J. Zhu et al., “MiniScope: A Least Privilege Framework for Authorizing Tool Calling Agents.” Preprint. [arXiv:2512.11147](https://arxiv.org/abs/2512.11147). |
| ScopeGate 2026 | D. M. Zuvic, “Capability Gates Are Not Authorization: Confused-Deputy Failures in LLM Agent Frameworks.” Preprint. [arXiv:2606.28679](https://arxiv.org/abs/2606.28679). |

Internal (not restated): [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md), [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md), [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md), [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md), `docs/contracts/f1-broker-deny-reasons.json`.

---

## Changelog

| Fecha | Cambio |
|-------|--------|
| 2026-09-22 | Initial research note. Public frontier → Bind/Janice reinforcements. No runtime. |
