# FRONTIER — Plugin defense and supply-chain hardenings (2026)

| Campo | Valor |
|-------|--------|
| **estado** | **RESEARCH** — docs-only; no runtime; no merge automático |
| **fecha** | 2026-09-22 |
| **teatro** | Plugin Frontiers / tip-of-spear · `anthony-x507/Abaco-deep-Core` (ABACO DEEP HARNES ≤ v0.4.26) |
| **complementa** | [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md) — superficies S1–S8 ya definidas allí; este memo **no** las reescribe |
| **naming** | **Janice** ejecuta · **Atena** aconseja · **Jev** never grants · connectors **HOLD** |
| **candados** | Bind deny-by-default · Phase S ya sandboxea providers de alto riesgo (mejorar, no romper faces) |

### Resumen (ES)

Este memo amplía la defensa de plugins; no repite el paper de superficies S1–S8 ni el pulse de Jev.
La seguridad no frena la evolución: un deny o un kill alcanza un `plugin_id`, y los admitidos siguen.
Bind permanece deny-by-default; Janice ejecuta; Atena y Jev nunca otorgan grants ni atestiguan admisión.
Phase S ya aísla providers de alto riesgo: aquí se proponen mejoras de frontera, sin sustituir esa face.
Una tienda firmada no basta: Cyberhaven (diciembre 2024) publicó un update hostil con la identidad del editor.
El pin tiene que ser un digest inmutable; tags mutables fallaron en tj-actions (CVE-2025-30066) y el caché de CI en ultralytics.
El piso de admisión es un SBOM CISA 2026 (hash, productor, transitivas, firma del autor), no un congelamiento del catálogo.
Wasm (RLBox, WASI) aísla lógica; no sustituye un proceso cuando hay secretos en el mismo address space (Site Isolation).
La inyección indirecta hacia tools es datos≠control: el contenido no confiable no satisface `authorize()`.
El kill switch es por plugin y tiene camino de vuelta vía HITL; un certificado que apaga todo el ecosistema (Firefox, mayo 2019) es el anti-patrón.

---

## 0. What this memo is

The unified paper already says governed plugins **reshape** risk and lists S1–S8 with CODE mitigations (pin, admission seal, canal identity, host-only sensors, Atena/Jev outside `authorize()`). This memo answers a different question:

**Which public defensive patterns, from 2018–2026, should Abaco adopt next so plugins can keep evolving?**

Tip-of-spear rule used throughout: **security must not stop evolution.** Unauthorized effects fail closed. Admitted plugins keep a fast path. Every “no” has a review-time path back to “yes” (digest rotation, cap-diff with HITL, ring promotion). A control that freezes the admitted fleet is out of contract even if it is “safer.”

This memo does not contain exploit procedures, payloads, or proof-of-concept steps. Incident write-ups are cited for the **class of failure** and the **defensive pattern** only.

### 0.1 Candados (do not break)

| Lock | Meaning for this memo |
|------|------------------------|
| **Bind deny-by-default** | No live grant → no effect. `planned` / `blocked` must not start. Medium/high bind or cap widen → human approval. Atena/Jev never approve. |
| **Janice executes** | Runtime runs only with a live grant. Janice is not a grantor and does not attest admission. |
| **Atena / Jev never grant** | Advisors may rank doubt. They do not call `authorize()`, mint caps, write pins, or pull a kill. |
| **Phase S** | High-risk providers are already sandboxed. Proposals **add** boundary checks, budgets, and provenance. They do not replace or reopen that face. |
| **Doctrine delta** | Deny or unload of one actor does not freeze admitted plugins. Disabled set: no automatic rehab. |
| **connectors** | Product language stays **HOLD**. Nothing here opens a third-party marketplace. |

### 0.2 What the tree actually shows (honesty)

| Control | Known in this repo | Not claimed |
|---------|--------------------|-------------|
| **F1 broker** | `authorize()` is the only grantor; timeout/throw = deny; four asserts; identity = canal; M1–M10. | — |
| **Admission** | Session graph sealed from the control plane. Skills, docs, memory, tool-results cannot mutate it. Runtime `proposeAdmissionChange` is deny-by-default. | — |
| **F1.5** | MCP schema pin/witness fail-closed; memory provenance `effective = min(claim, channel)`. | Third-party MCP rows stay unwitnessed (`PINNED_MCP_SCHEMAS = {}`). |
| **Trust tiers** | T0–T4 table and capability floor in `reports/worker-tiers.md`. Unknown plugin / unknown capability deny. | Wiring of tiers into every sink is a reported follow-on, not assumed complete. |
| **Pack B cell** | Explicit `strangler-fork` after `authorize()` + `inspectGrant()`. | Not an Electron `utilityProcess`. |
| **Bind** | Portable doctrine (Python Core reference): deny-by-default; planned/blocked no start; medium/high HITL. | No separate live Bind service is claimed in this tree beyond F1 `authorize()`. |
| **Phase S** | Brief lock: high-risk providers are sandboxed. In-tree frontier docs name Phase S as pluggable isolation providers (subprocess / Wasm / container) behind the same broker. | Paper open question 6 still stands: in-process T0/T1 paths do **not** yet earn “blast radius = one plugin.” [`SECURITY.md`](../SECURITY.md) still lists a general plugin sandbox as future work. This memo does not close that question by assertion. |
| **App supply chain** | HMAC between nodes; file modes; secret redaction; renderer `contextIsolation`. | App is unsigned ([`SECURITY.md`](../SECURITY.md), ADR-003). A tampered redistribute of the host is outside plugin kill switches. |

---

## 1. Public frontier (defense patterns)

Five families. Each maps forward to §2. Sources are listed again in §6.

### 1.1 Isolation ladder: process, Wasm, container

Public systems do not pick one sandbox. They stack a **broker process** with a **containment technology** matched to the blast.

| Pattern | What it actually contains | What it does not | Abaco-shaped use |
|---------|---------------------------|------------------|------------------|
| **Process-per-trust-domain** | Chrome Site Isolation puts each site in its own sandboxed renderer. The browser process is the privileged broker and filters cross-site data. Deployed because a compromised renderer, or a same-process disclosure such as Spectre, can read co-resident secrets. [Reis et al., USENIX Security 2019](https://www.usenix.org/system/files/sec19-reis.pdf). | It does not make the broker small by itself. The broker becomes the new TCB. | Janice + F1 already *are* the broker. Phase S’s high-risk provider face is the right place for a process boundary. Do not move admitted T0 presentation plugins into that cost. Do not leave secrets and untrusted code in one address space and call the label a sandbox. |
| **Wasm as software fault isolation** | RLBox compiles a library to Wasm (then native) so memory and control flow stay inside the module, and uses tainted types so values **crossing back** are checked. In Firefox 95 this sandboxed Graphite, Hunspell, Ogg, Expat, and Woff2 without a process per library. [Narayan et al., USENIX Security 2020](https://www.usenix.org/conference/usenixsecurity20/presentation/narayan); [Mozilla Hacks, 2021-12](https://hacks.mozilla.org/2021/12/webassembly-and-back-again-fine-grained-sandboxing-in-firefox-95/). | A sandbox that trusts returned pointers, lengths, or “status” objects is a confused deputy. RLBox’s point is the **boundary**, not the bytecode. | Good 90-day bet for **logic and parsers** that today share a process. Wasm/CAPMAS product work stays HOLD until a plan exists; this memo only names the pattern. |
| **WASI capabilities** | Wasmtime: Wasm must import every host function; the call stack is not guest-accessible; WASI filesystem access is capability handles, not ambient paths. [Wasmtime security](https://docs.wasmtime.dev/security.html). | Interface isolation is not an OS boundary. A bug in the runtime process still has that process’s privileges. Wasm does not, by itself, stop same-process side channels. | Map imports 1:1 onto manifest caps. Undeclared import = Bind deny. Returned values are **data**, same rule as tool-results. |
| **Containers** | NIST SP 800-190 treats image provenance, least privilege, secret handling, and network segmentation as the container control set — not “we used Docker.” [NIST SP 800-190](https://csrc.nist.gov/pubs/sp/800/190/final). | A container with the host socket, a broad mount, or the host network is a folder with extra steps. | Top of the ladder only (sensitive tier). Not the default for admitted plugins. Phase S already covers high-risk providers; a container profile is an **additional provider contract**, not a face replacement. |

**Ordering Abaco should keep:** broker (done) → Phase S for high-risk providers (keep) → boundary validation on what those providers return (30 days, docs/contract) → Wasm for co-resident parsers and process separation where secrets share an address space (90 days, additive). A Security Pulse does not substitute for any rung. That is already paper anti-pattern 10; this memo does not reopen it.

### 1.2 Supply chain: SBOM, provenance, signing, pin

| Practice | Public bar | Lesson that matters here |
|----------|------------|--------------------------|
| **SSDF** | NIST SP 800-218 v1.1 groups practices into Prepare (PO), Protect (PS), Produce (PW), and Respond (RV). Relevant tasks: **PS.2** verify release integrity; **PS.3.2** collect and share provenance; **PW.4** reuse well-secured components; **PW.9** secure defaults; **PO.5** separate build environments; **RV.1–RV.3** find, prioritize, and root-cause vulnerabilities. [NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final). | Abaco’s “respond” path is unload/revoke of one plugin, not a fleet freeze. Provenance is a CODE input to admission, not a Jev feature. |
| **SBOM minimum elements** | NTIA 2021 set the first baseline. CISA and partners **replaced** it on 2026-07-29. The 2026 elements add, among others, component hash, hash algorithm, license, tool name, generation context, and an **SBOM author signature**. Coverage is all components including transitive dependencies, with no minimum depth. Unknown must be explicit. Formats named in practice: SPDX and CycloneDX. [CISA 2026 SBOM minimum elements](https://www.cisa.gov/resources-tools/resources/2026-minimum-elements-software-bill-materials-sbom). | An SBOM that arrives after install does not stop a load. Admission should require hash + producer + dependency relationship **before** Janice starts the plugin. Missing hash is “unknown,” which under Bind is not a soft allow. |
| **SLSA provenance** | Provenance is an in-toto statement (`predicateType` `https://slsa.dev/provenance/v1`) that a builder produced artifacts from a `buildDefinition`. Verification checks the envelope, that `subject` matches the artifact digest, and that `builder.id` is in a configured root of trust. The build track (v1.1-rc2 levels page): L1 provenance exists; L2 a hosted platform signs it; L3 the platform isolates runs and keeps the signing material out of the tenant build. [SLSA provenance v1.1](https://slsa.dev/spec/v1.1/provenance); [attestation model](https://slsa.dev/spec/v1.1/attestation-model); [build levels](https://slsa.dev/spec/v1.1-rc2/levels). | Pin the **digest** (subject), not a floating tag. Record `builder.id`. A provenance file the plugin authors about itself is an S8 lie. |
| **in-toto** | SLSA attestations use the in-toto statement layout so the predicate (provenance, SBOM, or another) is separate from the signature. The signature says who attested; the predicate says what is claimed. [SLSA attestation model](https://slsa.dev/spec/v1.1/attestation-model); [in-toto](https://in-toto.io/). | Cap-diff and SBOM can be two predicates over the same subject. A signature alone does not say whether caps widened. |
| **Sigstore** | Keyless signing: a short-lived certificate ties an identity (for example an OIDC workflow) to a signature, and the transparency log (Rekor) makes the issuance append-only and monitorable. SLSA’s verifier profile accepts a Sigstore identity pattern plus `builder.id`. [Sigstore docs](https://docs.sigstore.dev/); [SLSA verifying artifacts](https://slsa.dev/spec/v1.1/verifying-artifacts). | 90-day bet, not a 30-day gate. Verification of an unchanged digest can be automatic so admitted publishers keep shipping. Cap widen stays HITL. A transparency log does **not** revoke; revocation is a separate kill list (§1.5). |

### 1.3 What public incidents changed about “signed and listed”

These are classes of failure. No indicators, payloads, or reproduction steps.

| Incident | Class | Defensive pattern |
|----------|-------|-------------------|
| **event-stream (npm, 2018)** | Maintainer handoff. A new publisher added a dependency that targeted a specific downstream wallet app. npm removed the malicious versions. [npm blog, archived](https://web.archive.org/web/20191031163820/https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident). | Ownership change and **new dependency edges** are review events. Transitive SBOM, not the top-level name. |
| **XZ Utils 5.6.0 / 5.6.1 (CVE-2024-3094)** | Malicious code in upstream release tarballs of a trusted compression library, discovered by Andres Freund; CISA advised moving back to an uncompromised version such as 5.4.6. [CISA alert, 2024-03-29](https://www.cisa.gov/news-events/alerts/2024/03/29/reported-supply-chain-compromise-affecting-xz-utils-data-compression-library-cve-2024-3094). | Trust in the project name is not trust in the tarball. Prefer reproducible or attested build outputs over “the git tag looks familiar.” Response is version pin-back of **that** component. |
| **ultralytics on PyPI (2024-12)** | GitHub Actions cache abuse, then a leftover PyPI API token. PyPI’s own analysis: Trusted Publishing plus Sigstore attestations showed the first wave came from the existing workflow, and the second wave had **no** matching publish attestation. Affected versions were removed. No PyPI vulnerability was required. [PyPI blog, 2024-12-11](https://blog.pypi.org/posts/2024-12-11-ultralytics-attack-analysis/). | Keep one publisher identity. Revoke legacy tokens when a stronger path exists. Absence of provenance is a signal, not a footnote. |
| **tj-actions/changed-files (CVE-2025-30066) and reviewdog/action-setup (CVE-2025-30154)** | Mutable version tags were repointed during 2025-03-12 to 2025-03-15. Workflows that trusted the tag ran the untrusted commit. CISA’s action for consumers: find repos that used the action in that window, rotate exposed secrets, move to the patched release. [CISA alert, 2025-03-18](https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction). | **Pin third-party actions and plugins by immutable digest.** A tag is a name. Names move. |
| **Cyberhaven Chrome extension (2024-12-25)** | A developer was phished into granting a malicious OAuth app rights on the Chrome Web Store account. The attacker published version 24.10.4 of the **legitimate** extension id. Auto-update delivered it. Cyberhaven detected it the same day and removed it within about an hour, then shipped a clean 24.10.5. Public reporting ties this to a wider set of extension-publisher compromises in late 2024. [SecurityWeek, 2024-12-31](https://www.securityweek.com/cyberhaven-chrome-extension-hack-linked-to-widening-supply-chain-campaign/); [Sekoia, 2024-12](https://www.sekoia.com/blog/targeted-supply-chain-attack-against-chrome-browser-extensions). | Store identity + signature did not stop a publisher-session publish. Needed: hardware-backed publisher auth, **permission/cap diff on every bump**, staged rollout, and a kill of that version that does not wait for the next full app release. |
| **VS Code Marketplace** | Microsoft signs extensions in the Marketplace repository and verifies that signature at install. Malware removal is supposed to block the package in the product and force uninstall of existing copies. Publisher signing for Microsoft-owned extensions, and tooling for third parties, is an explicit further step. [Microsoft, Marketplace trust](https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace). Separately, ReversingLabs showed that **removed** extension names can be registered again by another publisher, and that malicious extensions continued to appear through 2025. [ReversingLabs, name reuse](https://www.reversinglabs.com/blog/malware-vs-code-extension-names). | Repository signature answers “this blob came through the store,” not “this publisher is still the one you admitted.” Abaco admission keys off `plugin_id` **and** digest. Name equality is not identity. connectors stay HOLD so this marketplace problem is not invited early. |
| **Firefox add-on outage (2019-05-03/04)** | An intermediate certificate used to sign nearly all add-ons expired. Firefox then refused to load those add-ons for millions of users. Mozilla disabled new signing while repairing and shipped fixed releases (66.0.4 / 66.0.5 and ESR). [Mozilla Add-ons blog, 2019-05-04](https://blog.mozilla.org/addons/2019/05/04/update-regarding-add-ons-in-firefox/); [MozillaWiki technical report](https://wiki.mozilla.org/Add-ons/Expired-Certificate-Technical-Report). | A single trust anchor that fails **closed for everyone** stops evolution. Signing must be per artifact, and expiry or revocation must be able to target one id. Admitted plugins whose digest still verifies keep running. |

### 1.4 Agent-tool prompt injection

Indirect prompt injection is untrusted content (a page, a document, a tool result, a retrieved note) that the model treats as instructions, including which tool to call and with what arguments. Greshake et al. showed this against real LLM-integrated applications: retrieved prompts can steer functionality and API calls without the attacker sitting in the chat box. [Greshake et al., arXiv:2302.12173](https://arxiv.org/html/2302.12173v2), later AISec 2023. OWASP GenAI ranks prompt injection as **LLM01:2025**, with an indirect-injection scenario where hidden page instructions cause the model to exfiltrate via a tool-shaped action. [OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/). The OWASP prevention cheat sheet’s architectural pattern is a split: a privileged component holds tools and does not read raw untrusted content; a quarantined component may read it and returns only structured data. Pattern filters on the untrusted text are not the control. [OWASP LLM prompt-injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

Abaco already has the right **shape**, and it must stay CODE:

- Tool-results, skills, docs, and memory are not the control plane (admission seal; F1 M5/M6 `skill-cannot-register-tool`, `data-as-control`).
- External tool schemas are pinned; drift or an unwitnessed `mcp__*` name is deny (F1.5).
- Atena does not sit in `authorize()` or schema verify. Jev does not either.

What is still missing is an explicit rule for **arguments**: a tool call whose parameters were filled from an untrusted channel cannot widen authority and cannot satisfy a medium/high Bind by itself. The model may propose. Bind or `authorize()` decides. Human approval remains the path for medium/high. That is evolution (the tool can still ship) without letting retrieved text become a grant.

### 1.5 Kill switches that do not freeze the fleet

| Public mechanism | Behavior | Abaco translation |
|------------------|----------|-------------------|
| Chrome `ExtensionSettings` `installation_mode: removed` | Users cannot install that extension; if it is already present, Chrome removes it. Other extensions are untouched. [Chrome enterprise](https://support.google.com/chrome/a/answer/9867568). | Host kill list keyed by `plugin_id` + digest. Revoke grants, unload that id. Admitted ids keep their fast path. |
| Firefox `ExtensionSettings` `blocked` | Blocks install and removes an already installed extension. A default `"*": blocked` with explicit allow overrides is the enterprise allowlist. [Firefox policy](https://firefox-admin-docs.mozilla.org/reference/policies/extensionsettings/). | Default for **new** third-party ids can be restrictive (already the tier doctrine) without blocking admitted first-party ids. Do not ship `"*": blocked` against the admitted set. |
| VS Code `AllowedExtensions` | Allow by publisher, extension, version, or platform. Already installed extensions that fall off the list are **disabled**, not necessarily deleted. A syntax error in the policy means the policy is not applied. [VS Code enterprise extensions](https://code.visualstudio.com/docs/enterprise/extensions). | Fail closed on a **malformed** kill entry (ignore that entry, audit it). Do not fail open the whole list, and do not disable the broker because one row is bad. |
| Marketplace removal | Microsoft’s stated control: removed malware is blocked in VS Code and existing installs are forced off. [Microsoft Marketplace trust](https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace). | A signed **kill advisory** (separate from the provenance signature) names digest + id. Janice enforces it. Jev does not author it. |
| Firefox 2019 certificate expiry | Global close. See §1.3. | Negative requirement: no single expiring intermediate may unload every admitted plugin. |

Kill is CODE. It reuses revoke + unload. It does not write `patch.yml`, does not rotate pins, and does not rehab the disabled set. Restoring a killed id is ContractEvolution or an operator admit with HITL — the same widen path the paper already requires.

---

## 2. Threat → Abaco-shaped mitigation → priority

Priorities: **P0** can be specified and gated in a 30-day docs/contract slice without breaking faces. **P1** is a 90-day bet (design + a thin spike, still not a marketplace). **P2** is real but waits on P0/P1 or on a product decision (connectors, full Wasm runtime).

| # | Threat (class) | Abaco-shaped mitigation | Priority | Why this does not stop evolution |
|---|----------------|-------------------------|----------|----------------------------------|
| D1 | Malicious or widened update of an admitted plugin | Immutable digest pin. Cap-diff: unchanged caps stay on the fast path; any widen is HITL (Bind medium/high; F1 M9). | **P0** | Shipping a compatible bump stays one review of a digest, not a redesign. |
| D2 | Known-bad digest still loaded | Per-plugin kill: revoke + unload that id/digest only. No auto-rehab. | **P0** | Every other admitted plugin keeps running. Restore is HITL, not a global flag. |
| D3 | Sandboxed provider returns control data | Phase S return boundary: outputs are untrusted data. They cannot mint grants, pins, or admission. Host checks lengths and types (RLBox lesson). | **P0** | The high-risk face stays. Admitted callers keep their grants. |
| D4 | Unknown transitive contents | SBOM at admit time: producer, hash, dependency edges, generation context, author signature (CISA 2026). Unknown hash → not a soft allow. | **P0** | First-party plugins generate this in CI. It is an artifact, not a freeze. |
| D5 | Indirect prompt injection into tools | Untrusted channel cannot satisfy `authorize()`. Schema pin remains. Medium/high new tool effects stay Bind HITL. | **P0** | Tools keep working for user-originated calls. Retrieved text stays data. |
| D6 | Publisher-session or CI publish of a trusted id | Verify `builder.id` and a Sigstore (or equivalent) identity on the attestation. Legacy token and tag-based publish do not admit. | **P1** | Unchanged identity + unchanged caps verify automatically. |
| D7 | In-process blast on paths Phase S does not cover | Additive ladder: Wasm+WASI for parsers/logic; process boundary where secrets and untrusted code co-reside; container profile only at the top tier. | **P1** | T0 presentation plugins stay in-process. Phase S high-risk face is not rewritten. |
| D8 | Bad digest reaches the whole fleet at once | Rings: canary → admitted. Kill advisory can stop a ring without a product-wide quarantine. | **P1** | Admitidos outside the canary are unaffected by a bad canary bump. |
| D9 | Unsigned host redistribute | Developer ID / notarization remains the app-level control in [`SECURITY.md`](../SECURITY.md). | **P2** | Orthogonal to plugin admission. Do not block plugin evolution on Apple notarization. |
| D10 | Third-party marketplace | Stay on connectors **HOLD** until D1–D5 exist as gates. | **P2** | Not opening the marketplace is what keeps evolution of admitted plugins cheap. |

---

## 3. Matrix

Current-control cells say what this tree and the candados actually support. “Phase S face” means the brief’s high-risk provider sandbox, which this memo does not redesign.

| Threat | Vector | Current Abaco control (Bind / S if known) | Gap | Next control |
|--------|--------|-------------------------------------------|-----|----------------|
| Widened or swapped update | Mutable version, auto-update, cap bump | Admission seal; F1 M9 `compose-mutate-forbidden`; Bind: medium/high widen = HITL; pins rotate at review, not by silent API | No required artifact digest compared to what Janice loaded; no cap-diff object for reviewers | **D1** digest pin + cap-diff; mismatch is a CODE trip before execute (paper S6, made operational) |
| Publisher account publishes a hostile build | OAuth / store session / stolen publish token (Cyberhaven class) | Admission only from control plane; runtime propose is deny-by-default | No publisher-identity attestation; unsigned app redistribute is a separate host gap | **D2** kill by id+digest now; **D6** builder identity later. Do not treat “listed under our name” as a grant |
| Tag or branch repoint | CI action or plugin feed referenced by name (tj-actions class) | MCP schema pin is by canonical schema hash, not by git tag | Plugin and CI dependencies can still float | Pin third-party inputs by digest in admission and in our own workflows |
| Build poisoned, source looks fine | CI cache, extra tarball bits, leftover publish token (ultralytics, xz class) | F1.5 witnesses tool schemas; it does not witness build provenance | No SLSA provenance, no “attestation absent = deny” rule | **D4** SBOM generation context = build; **D6** require provenance `subject` = artifact digest |
| Transitive dependency turns hostile | New edge inside an admitted plugin (event-stream class) | Manifest caps cap the plugin, not each dependency | No transitive SBOM at admit | **D4** CISA 2026 coverage: all dependencies, no depth cutoff; new edge with new caps = HITL |
| Name reused after removal | Typosquat or re-registered display name (VS Code class) | Discovery allowlist doctrine; connectors HOLD; unknown plugin → tier deny | Identity can still be confused with a human-readable name | Admit on `plugin_id` + digest only. Name match is not admission |
| In-process compromise beside secrets | Shared address space, crash, or same-process disclosure | Phase S face for high-risk providers; Pack B `strangler-fork` after authorize; Electron renderer `contextIsolation`; tiers T0–T4 | Paper Q6: T0/T1 in-process paths do not earn “blast = one plugin.” [`SECURITY.md`](../SECURITY.md) plugin sandbox still listed as future. Strangler-fork ≠ OS process | **D3** now (boundary). **D7** later (Wasm or process) only where Phase S does not already cover the provider. Do not wrap T0 UI by default |
| Wasm or provider import too strong | Guest calls a host function that is ambient authority | Bind deny-by-default on undeclared effects; caps ∩ canal | Wasm/CAPMAS HOLD; no written import↔cap map; no rule that sandbox output is data | **D3**: imports = caps; returns cannot mint grants. WASI-style handles, not ambient paths, if a Wasm provider is added |
| Container or process with ambient mount | Host socket, broad filesystem, host network | Phase S face assumed for high-risk; no public mount contract in this tree | A provider can be “sandboxed” and still hold host authority | Provider contract: no host socket, no secret mount, egress only to declared destinations. Additive to the face, not a rewrite |
| Confused deputy at the sandbox edge | Sandbox returns a path, URL, or tool name the host then trusts | F1 identity = canal (M8); M6 data-as-control | Phase S return path is not specified as untrusted | **D3** host taint on Phase S outputs |
| Shared bus flood or poison | One plugin starves or corrupts others | Broker four asserts; ledger doctrine | No per-plugin budget documented as enforced | Budget + kill **that publisher** (D2). Do not trip a global breaker |
| Indirect prompt injection | Page, file, memory, or tool-result steers a tool call | datos≠control; M5/M6; MCP schema pin; Atena/Jev outside authorize | No explicit rule for **arguments** filled from an untrusted channel | **D5**: untrusted content never satisfies `authorize()`; medium/high Bind stays HITL |
| Plugin self-report | “healthy” / fake deny counts | Host-only sensor doctrine (paper S8) | Easy to “ask the plugin” when adding pulse sensors | Kill and CODE trips read host audit only. Jev never sees plugin free text as authority |
| Catalog ≠ bytes running | Stale pin, partial hot swap | Admission immutable; dual-digest doctrine in the paper | Open as an ops gap (paper Q3/Q6) | CODE trip when catalog digest ≠ runtime digest for that `plugin_id` |
| Advisor becomes the grantor | Atena or Jev on the hot path, or pulse quarantine as policy | Candado; import-graph expectation; pilot is alert/journal | The temptation scales as soon as tools feel slow | Keep the four asserts. No new grant API. Pulse does not gain `grant.*` |
| Signature with no revocation | Stolen key or bad digest still verifies | Disabled set has no auto-rehab | A passing signature is not a kill. Sigstore’s log is append-only | **D2** separate kill advisory. Verify-ok ∧ not-killed = run; verify-ok ∧ killed = unload that id |
| Global trust-anchor failure | One expired intermediate disables every extension (Firefox 2019) | Per-plugin disabled set exists | A future single signing cert could repeat the outage | Per-artifact signatures. Expiry of one issuer must not unload the admitted set |
| Unsigned host binary | Redistributed modified app | Node HMAC, file modes, renderer isolation. Signing/notarization explicitly not done | Plugin controls do not see a patched host | **D9** P2. Out of this plugin slice; do not pretend SBOM of plugins covers it |

---

## 4. Top 5 hardenings (30 days) and 3 bets (90 days)

All five are **specification and gating** work. This PR does not implement them. None of them reopen F1, replace Phase S, or put Atena/Jev in `authorize()`.

### 4.1 Thirty days

1. **Digest pin and cap-diff (D1).** Admission records the artifact digest Janice is allowed to load. A bump whose caps are a subset of the admitted caps promotes the digest at review and keeps the fast path. A bump that adds a capability, a host import, an egress destination, or a spawn right is Bind medium/high: human approval, or deny. Public basis: SLSA subject digest, tj-actions mutable tags, F1 M9.
2. **Per-plugin kill switch (D2).** A host-held list of `(plugin_id, digest)` → revoke live grants and unload that id only. Malformed rows are ignored and audited (VS Code lesson). No row may target `*`. No auto-rehab. Restore = HITL. Public basis: Chrome `removed`, Firefox `blocked`, Marketplace forced uninstall, and the Firefox 2019 counterexample.
3. **Phase S return boundary (D3).** Write the contract the high-risk sandbox already needs and does not yet spell out: bytes coming back are untrusted data; they do not carry grants, plugin ids, or pin updates; the host validates sizes and types before any sink. Do not change the provider face to do it. Public basis: RLBox tainted boundary; F1 M6.
4. **SBOM minimum at admit (D4).** For each plugin artifact, require a machine-readable SBOM (SPDX or CycloneDX) with at least: component producer, component hash, hash algorithm, dependency relationships (transitive), generation context, timestamp, and SBOM author signature. Unknown hash is explicit and does not soft-allow. First-party CI can emit this without blocking admitted runtime. Public basis: CISA 2026 minimum elements; NIST SSDF PS.3.2.
5. **Tool-argument rule for indirect injection (D5).** Document and test the intended invariant: content classified untrusted (retrieval, tool-result, memory, skill text) cannot be the reason an `authorize()` returns allow, and cannot clear a medium/high Bind. Schema pin stays as it is. User-originated calls on already-admitted tools keep the fast path. Public basis: Greshake et al.; OWASP LLM01 and the privileged/quarantined split; existing datos≠control.

### 4.2 Ninety-day bets

1. **Builder identity, not just a hash (D6).** Verify a SLSA provenance predicate whose subject is the pinned digest and whose `builder.id` matches a configured root of trust, preferably a Sigstore identity so publishers do not manage long-lived keys. Unchanged caps + known builder → automatic. Cap widen → still HITL. Absence of provenance → deny for anything that is not already an admitted first-party digest. Public basis: SLSA L2/L3 intent, Sigstore, PyPI ultralytics attestation gap.
2. **Additive isolation ladder (D7).** Where a path is still in-process **and** holds both untrusted bytes and secrets, add a provider: Wasm with an import allowlist equal to caps for parsers and logic; a real process boundary when same-address-space disclosure matters; a container profile (no host socket, no secret mount, declared egress) only at the top tier. Phase S’s current high-risk face stays. T0 presentation stays put. Wasm/CAPMAS remains HOLD as a product until this bet is accepted; the bet is the plan, not a silent runtime. Public basis: Site Isolation, RLBox, Wasmtime/WASI, NIST SP 800-190.
3. **Rings plus a signed kill advisory (D8).** New digests enter a canary ring. Promotion to the admitted ring is review, not a timer inside the plugin. A kill advisory (distinct predicate from provenance) can drop one digest from a ring. Jev may rank post-admit novelty only after CODE has accepted the artifact; it does not choose the ring and does not sign the advisory. Public basis: Cyberhaven auto-update blast, Chrome/Firefox per-id removal, Firefox 2019 global-close avoidance.

### 4.3 Explicit non-goals

- No global quarantine, no “security mode” that stops admitted plugins.
- No Jev or Atena grant, pin, kill, or admission attest.
- No replacement of the Phase S high-risk provider face.
- No connectors / third-party marketplace in this window.
- No exploit reproductions, payload samples, or offensive PoCs in follow-on docs.
- No claim that an SBOM, a signature, or a Wasm module makes plugins “safe.”

---

## 5. How to read this next to the paper

| Question | Read |
|----------|------|
| Why plugins at all, and what are S1–S8? | [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md) |
| May Jev allow an effect? | No. Paper part III and [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) |
| What should we harden in the next 30 / 90 days? | §4 of this memo |
| Does Phase S already cover every plugin? | No. It covers high-risk providers. In-process T0/T1 remains the open blast question (paper Q6). |
| Does this memo authorize implementation? | No. A later PR may implement one P0 row. It must not mix a marketplace opening into that PR. |

---

## 6. Public sources

Standards and agency guidance:

- NIST, *Secure Software Development Framework (SSDF) Version 1.1*, SP 800-218, 2022-02-03. <https://csrc.nist.gov/pubs/sp/800/218/final>
- NIST, *Application Container Security Guide*, SP 800-190. <https://csrc.nist.gov/pubs/sp/800/190/final>
- CISA, NSA, FBI, and partners, *2026 Minimum Elements for a Software Bill of Materials (SBOM)*, 2026-07-29. <https://www.cisa.gov/resources-tools/resources/2026-minimum-elements-software-bill-materials-sbom> (replaces NTIA 2021)
- SLSA provenance v1.1. <https://slsa.dev/spec/v1.1/provenance>
- SLSA attestation model (in-toto statement, DSSE envelope). <https://slsa.dev/spec/v1.1/attestation-model>
- SLSA build track levels (v1.1-rc2 levels page). <https://slsa.dev/spec/v1.1-rc2/levels>
- SLSA verifying artifacts (including a Sigstore root-of-trust example). <https://slsa.dev/spec/v1.1/verifying-artifacts>
- in-toto. <https://in-toto.io/>
- Sigstore documentation. <https://docs.sigstore.dev/>

Isolation research and engine docs:

- Reis, Moshchuk, and Oskov, “Site Isolation: Process Separation for Web Sites within the Browser,” USENIX Security 2019. <https://www.usenix.org/system/files/sec19-reis.pdf>
- Narayan et al., “Retrofitting Fine Grain Isolation in the Firefox Renderer,” USENIX Security 2020 (RLBox). <https://www.usenix.org/conference/usenixsecurity20/presentation/narayan>
- Mozilla Hacks, “WebAssembly and Back Again: Fine-Grained Sandboxing in Firefox 95,” 2021-12-06. <https://hacks.mozilla.org/2021/12/webassembly-and-back-again-fine-grained-sandboxing-in-firefox-95/>
- Wasmtime, “Security.” <https://docs.wasmtime.dev/security.html>

Extension, registry, and kill-switch incidents (defense lessons only):

- npm, “Details about the event-stream incident” (2018), archived. <https://web.archive.org/web/20191031163820/https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident>
- CISA, “Reported Supply Chain Compromise Affecting XZ Utils,” CVE-2024-3094, 2024-03-29. <https://www.cisa.gov/news-events/alerts/2024/03/29/reported-supply-chain-compromise-affecting-xz-utils-data-compression-library-cve-2024-3094>
- PyPI blog, ultralytics attack analysis, 2024-12-11. <https://blog.pypi.org/posts/2024-12-11-ultralytics-attack-analysis/>
- CISA, tj-actions/changed-files CVE-2025-30066 and reviewdog/action-setup CVE-2025-30154, 2025-03-18. <https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction>
- SecurityWeek, Cyberhaven extension campaign, 2024-12-31. <https://www.securityweek.com/cyberhaven-chrome-extension-hack-linked-to-widening-supply-chain-campaign/>
- Sekoia, targeted Chrome extension supply-chain attack, 2024-12. <https://www.sekoia.com/blog/targeted-supply-chain-attack-against-chrome-browser-extensions>
- Microsoft, “Security and Trust in Visual Studio Marketplace.” <https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace>
- ReversingLabs, VS Code extension name reuse. <https://www.reversinglabs.com/blog/malware-vs-code-extension-names>
- Mozilla Add-ons blog, add-on outage, 2019-05-04. <https://blog.mozilla.org/addons/2019/05/04/update-regarding-add-ons-in-firefox/>
- MozillaWiki, expired-certificate technical report. <https://wiki.mozilla.org/Add-ons/Expired-Certificate-Technical-Report>
- Chrome enterprise, ExtensionSettings (`removed` and related modes). <https://support.google.com/chrome/a/answer/9867568>
- Firefox administrator reference, ExtensionSettings. <https://firefox-admin-docs.mozilla.org/reference/policies/extensionsettings/>
- VS Code, manage extensions in enterprise (`AllowedExtensions`). <https://code.visualstudio.com/docs/enterprise/extensions>

Agent-tool injection (taxonomy and prevention, not procedures):

- Greshake et al., “Not what you’ve signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection,” arXiv:2302.12173. <https://arxiv.org/html/2302.12173v2>
- OWASP, LLM01:2025 Prompt Injection. <https://genai.owasp.org/llmrisk/llm01-prompt-injection/>
- OWASP Cheat Sheet, LLM Prompt Injection Prevention. <https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html>

Internal (context, not public citations):

- [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md)
- [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md)
- [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md)
- [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md)
- [`../SECURITY.md`](../SECURITY.md)
- [`../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`](../contracts/CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md)
- [`../contracts/CONTRACT-F1.5-MCP-SCHEMA-PIN.md`](../contracts/CONTRACT-F1.5-MCP-SCHEMA-PIN.md)

---

## Changelog

| Fecha | Cambio |
|-------|--------|
| 2026-09-22 | Research memo: public isolation and supply-chain patterns mapped to Bind + Phase S; 30-day hardenings and 90-day bets. Docs only. |
