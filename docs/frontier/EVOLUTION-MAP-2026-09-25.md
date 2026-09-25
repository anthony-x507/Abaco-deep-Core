# Plugin Frontiers — Evolution Map SSOT (2026-09-25)

| Campo | Valor |
|-------|--------|
| **pack** | Plugin Frontiers |
| **fecha** | 2026-09-25 (America/New_York) |
| **author** | ABACO LEADER handoff |
| **teatro** | `anthony-x507/Abaco-deep-Core` — tip-of-spear Electron/broker |
| **hub espejo** | `anthony-x507/abaco-python-core` |
| **rol** | Cold-agent handoff: what worked, what did not, HOLD, next rules |
| **idioma** | Spanish prose + English invariant names (INV-*) |

> **Start here for any incoming agent.** This map alone is enough to understand closed work, anti-patterns, and GAPs. Then follow the read order in [Como proceder](#como-proceder-agente-entrante).

---

## Start here (estado actual)

| Item | Estado |
|------|--------|
| **Tip `main`** | `97c1943` — `feat(broker): Ola 3 D6 provenance stamp + Sigstore GAP + pin gate (#58)` (2026-09-24) |
| **F1 day-14 / broker product** | **CLOSED**. Release <= v0.4.26 historically CLEAR. **Do not reopen F1.** |
| **Ola 1–3 on deep-Core** | **CLOSED on `main`** (PRs #51–#58) |
| **Sister hub** | `anthony-x507/abaco-python-core` tip ~`3bbdcad` Ola 1–3.1 (#22–#27) — mirror; Master Plan v2 COMPLETE |
| **Sigstore** | **HOLD** (dated, NOT soft-PASS) — [`GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md`](GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md) |
| **Apple notarize / Desk F7** | **HOLD** (dated, NOT soft-PASS) — [`GAP-NOTARIZE-2026-09-23.md`](GAP-NOTARIZE-2026-09-23.md) |
| **Marketplace** | Open blocked until [`MARKETPLACE-OPEN-CHECKLIST.md`](MARKETPLACE-OPEN-CHECKLIST.md) go-criteria |
| **Third-party connectors** | Product **HOLD** |
| **Locks** | Janice = runtime; Atena advisory **never grants**; Jev **never grants**; plugin = **contrato** not folder; **tip-of-spear** (security must not stop evolution) |

---

## Timeline / arco de evolucion

Chronological path with relative links to existing docs. Do not rewrite closed research; read and inherit.

| # | Arco | PRs (deep) | Docs / markers |
|---|------|------------|----------------|
| 1 | Research G47 + paper (unified) | ~#39–#41 (+ #36–#38 G47 precursors) | [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md), [`research/README.md`](research/README.md) |
| 2 | Defense / permissions / clean host architecture | #42–#44 | [`FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md`](FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md), [`FRONTIER-PERMISSIONS-CAPABILITIES-2026.md`](FRONTIER-PERMISSIONS-CAPABILITIES-2026.md), [`FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md`](FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md) |
| 3 | Jev everyday / sweet-spot / incorporacion esencial | #47–#50 (+ #45 wire audit) | [`JEV-EVERYDAY-FIVE-MODES-2026.md`](JEV-EVERYDAY-FIVE-MODES-2026.md), [`JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md`](JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md), [`JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md`](JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md), [`JEV-INCORPORACION-ESENCIAL-PLAN-2026.md`](JEV-INCORPORACION-ESENCIAL-PLAN-2026.md), [`JEV-INCORPORACION-ESENCIAL-PROCEDIMIENTO-2026.md`](JEV-INCORPORACION-ESENCIAL-PROCEDIMIENTO-2026.md) |
| 4 | F1 / F1.5 / F2.1 contracts | product closed on tip (<= v0.4.26) | [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md) — **F1 CLOSED; do not reopen** |
| 5 | Sweet-spot stress A–E remediation | #46 Stress C on main; A3/D4 and B/E on python/deep as applicable | [`SWEET-SPOT-STRESS-C.md`](SWEET-SPOT-STRESS-C.md) |
| 6 | Ola 1 Bloques 1–3 + INV-12 gates | #51–#54 deep; #22–#25 python | [`OLA1-BLOQUE1-DURABLE-AUDIT.md`](OLA1-BLOQUE1-DURABLE-AUDIT.md), [`OLA1-BLOQUE2-TTL.md`](OLA1-BLOQUE2-TTL.md), [`OLA1-BLOQUE3.md`](OLA1-BLOQUE3.md) |
| 7 | Ola 2 A/B/C | #55–#57 deep; #26 python B | [`OLA2-BLOQUE-A.md`](OLA2-BLOQUE-A.md), [`OLA2-BLOQUE-B.md`](OLA2-BLOQUE-B.md), [`OLA2-BLOQUE-C.md`](OLA2-BLOQUE-C.md) |
| 8 | Ola 3 D6 provenance + Sigstore GAP + pin/marketplace gates | #58 deep; #27 python | [`OLA3-BLOQUE.md`](OLA3-BLOQUE.md), GAP-* + marketplace + pin gate |

---

## Que sirvio (KEEP)

| Invariant | PR(s) | One-line win |
|-----------|-------|--------------|
| **INV-DURABLE-AUDIT-FAIL-CLOSED** | #51 | After K durable append failures, `authorize()` denies new effects `audit-unavailable` (tip-of-spear UI exception); never empty-catch durable I/O |
| **INV-TTL-BOUNDED** | #52 | Finite positive `ttlMs`; clamp oversize; reject immortal / null-on-medium-high at mint; deny `ttl-unbounded` |
| **INV-NO-WIDEN** | #53 | `sessionCaps ⊆` pin; widen needs HITL + `pinRevision`; digest change clears overlays |
| **INV-DOWNGRADE-HITL** | #53 | Market / capability downgrade requires HITL; no silent attenuation of trust |
| **INV-GRANT-MAP-CAP** | #53 | Bound open grant map; pressure fails closed instead of unbounded growth |
| **INV-12 CI gates** | #54 | Named INV-12 contracts + desktop-ci ola1 gates as merge blockers |
| **INV-AUDIT-CHAIN** | #55 | Durable `effects.jsonl` `prev_hash` + lock + serial CI; verify fail-closed; preserves durable-audit breaker |
| **INV-ISOLATION-CLASS** | #56 | Market UtilityProcess or strangler-fork, else **deny** (no same-process main default) |
| **Update-feed digest pin** | #57 | Refuse-launch when broker pins != binary / feed stamp; tag-only never allows |
| **D6 stamp-only + pin rotation + marketplace checklist** | #58 | Subject = artifact digest + builder id; stamp-only (`sigstoreClaim` false); pin rotation = release gate; marketplace go-criteria documented |
| **Sweet-spot C digest+SBOM** | #46 | Admission requires digest pin + SBOM; tag-match alone never admits |
| **Janice / Atena naming law** | #35 | Janice = runtime; Atena = advisory never grants; Jev never grants |
| **Fail-closed cuadruple doctrine** | F1 + Ola 1–3 | deny · 0 side-effect · audit · counter/breaker — tip-of-spear (security must not stop evolution of admitted UI) |

---

## Que NO sirvio / rechazado

Explicit anti-patterns. Treat as **forbidden / failed approaches**:

| Anti-pattern | Why rejected |
|--------------|--------------|
| Soft-PASS on notarize or Sigstore while GAP open | Hides risk; dated GAP files exist — use HOLD, never soft-PASS |
| Empty `.catch` on durable audit append | Pass 8 finding → Ola 1.1 / #51; mute breaks fail-closed |
| Unbounded / immortal task-grant TTL | Pass 7 → Ola 1.2 / #52; near-immortal grants |
| Market / Cordis default same-process main | → Ola 2.B deny (#56); must UtilityProcess or strangler-fork |
| Atena or Jev inside `authorize()` / mint / pin rotate | Advisors never grant; never live in hot-path authorize |
| Claiming `sigstoreClaim: true` under stamp-only mode | Code refuses; GAP-SIGSTORE remains HOLD |
| Runtime silent pin rotate API | Forbidden; release-gate only ([`PIN-ROTATION-RELEASE-GATE.md`](PIN-ROTATION-RELEASE-GATE.md)) |
| Stacking merge order mistakes | #56 was stacked on #55 — merge 2.A before 2.B |
| ASCII `≠` in python contract docs breaking CI | Fixed to `!=`; prefer ASCII in contract CI-gated prose |
| Reopening F1 day-14 / broker after CLOSED | Product closed; extract law, do not reopen teatro |
| Draft audit PRs #21 / #22 | **SKIP** for Frontier evolution (independent E2E audit docs of 0.4.22; not Ola path) |

---

## GAPs HOLD

Dated HOLD — **NOT soft-PASS**. Reopen only when evidence exists.

| GAP / gate | File | Reopen checklist (brief) |
|------------|------|---------------------------|
| Sigstore stamp-only | [`GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md`](GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md) | Real Sigstore/OIDC (or equiv CI identity) wired; then drop stamp-only and allow `sigstoreClaim` only with real attestation |
| Apple notarize / Desk F7 | [`GAP-NOTARIZE-2026-09-23.md`](GAP-NOTARIZE-2026-09-23.md) | Desk F7 frees (GH artifact quota) **and** Apple notary / Developer ID available; never invent secrets |
| Marketplace open | [`MARKETPLACE-OPEN-CHECKLIST.md`](MARKETPLACE-OPEN-CHECKLIST.md) | All go-criteria green (INV-12, isolation, digest+SBOM, Sigstore-or-GAP, update-feed pin, pin rotation gate, D6 stamp); notarize HOLD still blocks full open until resolved or accepted |
| Pin rotation | [`PIN-ROTATION-RELEASE-GATE.md`](PIN-ROTATION-RELEASE-GATE.md) | Digest edits via `sign-manifest.mjs` + commit review + CI constant check; **no** runtime rotate API |

---

## Mapa de repos

| Repo | Rol |
|------|-----|
| [`anthony-x507/Abaco-deep-Core`](https://github.com/anthony-x507/Abaco-deep-Core) | Teatro tip-of-spear Electron/broker F1–Ola3 |
| [`anthony-x507/abaco-python-core`](https://github.com/anthony-x507/abaco-python-core) | Hub portable Bind/Face/INV mirror |
| [`anthony-x507/Abaco-desk-app-UI`](https://github.com/anthony-x507/Abaco-desk-app-UI) | Desk UI; F7 notarize HOLD |

**Ley vs teatro:** extract portable law; do not copy Cordis/DSH trees into Python. Canonical index: [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md).

---

## Como proceder (agente entrante)

**Read order:**

1. This map — [`EVOLUTION-MAP-2026-09-25.md`](EVOLUTION-MAP-2026-09-25.md)
2. [`README.md`](README.md)
3. [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md)
4. Ola bloques: [`OLA1-BLOQUE1-DURABLE-AUDIT.md`](OLA1-BLOQUE1-DURABLE-AUDIT.md) → [`OLA1-BLOQUE2-TTL.md`](OLA1-BLOQUE2-TTL.md) → [`OLA1-BLOQUE3.md`](OLA1-BLOQUE3.md) → [`OLA2-BLOQUE-A.md`](OLA2-BLOQUE-A.md) → [`OLA2-BLOQUE-B.md`](OLA2-BLOQUE-B.md) → [`OLA2-BLOQUE-C.md`](OLA2-BLOQUE-C.md) → [`OLA3-BLOQUE.md`](OLA3-BLOQUE.md)
5. GAP-* → [`MARKETPLACE-OPEN-CHECKLIST.md`](MARKETPLACE-OPEN-CHECKLIST.md) → [`PIN-ROTATION-RELEASE-GATE.md`](PIN-ROTATION-RELEASE-GATE.md)

**Rules:**

- Do **not** reopen F1.
- Do **not** fake Sigstore or notarize.
- Next work **only** when Anthony/Leader names a concrete gap vs tip.
- **Report-and-continue** doctrine: surface blockers; do not soft-PASS; tip-of-spear (security must not stop evolution).

---

## Indice de PRs (deep-Core)

### Frontier / Ola path (MERGED) — #39–#58

| PR | State | One-line |
|----|-------|----------|
| #39 | MERGED | research: traditional software vulnerabilities deep dive |
| #40 | MERGED | research: Jev rules for cleaner Frontiers pulse |
| #41 | MERGED | paper: plugins vs traditional + Jev pulse (unified) |
| #42 | MERGED | research: plugin defense & supply-chain hardenings |
| #43 | MERGED | research: permissions & capabilities for plugin hosts |
| #44 | MERGED | research: clean architecture for plugin hosts |
| #45 | MERGED | research: TypeSafe/Jev advanced integration audit |
| #46 | MERGED | Stress C: artifact digest pin and SBOM HOLD on Harnes admission |
| #47 | MERGED | docs: five everyday Jev modes |
| #48 | MERGED | docs: Jev everyday sweet-spot formula and error margins |
| #49 | MERGED | research: Jev everyday potentialities — tip of the spear |
| #50 | MERGED | docs: Jev Incorporacion Esencial — plan + procedimiento |
| #51 | MERGED | Ola 1.3 durable audit fail-closed (INV-DURABLE-AUDIT-FAIL-CLOSED) |
| #52 | MERGED | Ola 1.2.2 bounded task-grant TTL (INV-TTL-BOUNDED) |
| #53 | MERGED | Ola 1 Bloque 3 sessionCaps, downgrade HITL, grant-map |
| #54 | MERGED | Ola 1 INV-12 contracts + desktop-ci ola1 gates |
| #55 | MERGED | Ola 2.A effects.jsonl prev_hash + verify fail-closed |
| #56 | MERGED | Ola 2.B market isolation (INV-ISOLATION-CLASS) |
| #57 | MERGED | Ola 2.C update-feed digest pin + notarize GAP |
| #58 | MERGED | Ola 3 D6 provenance stamp + Sigstore GAP + pin/marketplace gates |

### Precursors / product (context)

| PR | State | Note |
|----|-------|------|
| #35 | MERGED | Janice/Atena naming law pack |
| #36–#38 | MERGED | G47 pulse PILOT + compare docs |
| #31–#34 | MERGED | F1 day-14 / broker / bump to v0.4.26 — **CLOSED product** |
| #17–#20 | MERGED | F1.5 memory packager / MCP schema pin / releases — product surface, not Ola |

### SKIP / do not treat as Frontier evolution

| PR | State | Note |
|----|-------|------|
| #21 | OPEN (draft audit) | Independent E2E audit of 0.4.22 (Agent B) — **SKIP** |
| #22 | OPEN (draft audit) | Independent E2E audit of 0.4.22 (Agent A) — **SKIP** |

---

## Sister mirror — abaco-python-core (brief)

Not exhaustive. Master Plan v2 COMPLETE; tip ~`3bbdcad`.

| Band | PRs | Role |
|------|-----|------|
| Docs / Face / Phase | #8–#16 | Jev Bind adhesion, FacePlugin freeze, factory, sandbox, ASCII CI hygiene |
| Sweet-spot remediations | #20–#21 | B/E attenuate/revoke/unload/canary; A3 approval TTL + D4 host pulse GAPs |
| Ola 1 | #22–#25 | Bloque 1 observation seal; Bloque 2 TTL/lab escape; Bloque 3 HITL/grant-map; INV-12 CI |
| Ola 2.B | #26 | Face isolation digests + market INV row |
| Ola 3.1 | #27 | Bind artifact subjects (provenance mirror) |

Portable inheritance: [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md).

---

## Doc meta

| Campo | Valor |
|-------|--------|
| **fecha** | 2026-09-25 |
| **author** | ABACO LEADER handoff |
| **pack** | Plugin Frontiers |
| **scope** | Docs only — no broker runtime edits in this PR |
| **success** | Cold agent can answer: what worked / what did not / HOLD / next rules from this file alone |
