# G47 research series — Plugin Frontiers / tip-of-spear

| Campo | Valor |
|-------|--------|
| **estado** | Docs-only research drafts; **no** unified paper; **no** auto-merge |
| **fecha** | 2026-09-22 |
| **teatro** | Abaco Frontiers / tip-of-spear |
| **paper unificado** | Lo compila **Leader** después — **no** escribir el paper aquí |
| **naming** | **Jev** ≠ **Janice** ≠ **Atena** — Jev never grants |
| **hermanos** | A / B / C parallel — do not collide files |

## Index

| Slot | Draft | Status | One-line |
|------|-------|--------|----------|
<<<<<<< HEAD
| **A** | `01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md` (parallel; sibling) | reserved — do not overwrite from B/C | Traditional monolith vulns deep-dive |
| **B** | [`02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md`](02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md) | on main (PR #38) | What traditional vulns shrink under Janice/broker/caps/Bind; new surfaces + CODE mitigations; tip-of-spear vs monolith |
| **C** | [`03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md`](03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md) | **this PR** | Jev rules → cleaner Frontiers pulse (CODE-first, doubt-band %, never grants, Bind checklist, anti-patterns, pilot gates) |
=======
| **A** | [`01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md`](01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md) | **LIVE** | Traditional monolith vulns: taxonomy T1–T12, chains, blast radius, remediation cost, FeatureBag bridge |
| **B** | [`02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md`](02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md) | **LIVE** (merged #38) | What traditional vulns shrink under Janice/broker/caps/Bind; new surfaces + CODE mitigations; tip-of-spear vs monolith |
| **C** | `03-*` (parallel; sibling agent) | **reserved / pending** — do not overwrite from A/B | Jev rules / cleaner / Frontiers pulse |
>>>>>>> 16d16ee (docs(frontier): traditional software vulnerabilities research draft A)

## Policy

1. Edit **only** your slot’s file(s) + this README row for your letter.  
2. Do **not** edit merged `docs/frontier/JEV_*.md` / `JANICE_ATENA_NAMING_LAW.md` from research PRs unless that is the assigned deliverable.  
3. Citas a paths internos cuando se usen fuentes del repo.  
4. No implementación runtime / plugins nuevos / merge a `main` sin review.  
5. No inventar grants de Jev ni colapsar Jev/Janice/Atena.  
6. Honesty lock for B: plugins ≠ magically safer; claim precision / fail-isolation / attribution when governed.

## Fuentes ya merged (leer, no reescribir en este folder)

| Doc | Rol |
|-----|-----|
| [`../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](../JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) | Pulse feasibility PILOT |
| [`../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](../JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) | Plugin vs monolith compare |
| [`../JANICE_ATENA_NAMING_LAW.md`](../JANICE_ATENA_NAMING_LAW.md) | Naming lock |
| [`../PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](../PLUGIN_FRONTIERS_CONTRACT_INDEX.md) | Ley vs teatro F1–F2.1 |
| [`../../SECURITY.md`](../../SECURITY.md) | Modelo seguridad tip |
| [`../../TECH-plugin-loading.md`](../../TECH-plugin-loading.md) | Carga de plugins UI (borde B) |
