# CONTRACT F1.5 — memory 3-phase packager provenance

| Campo | Valor |
|-------|--------|
| **fecha** | 2026-09-17 |
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **padre** | F1 admission immutable (PR #15, `cb125df`) · Pack A MemoryStore quarantine (PR #7) · F2-W5 threat-model (profile/log/note) · F2-W3 provenance |
| **estado** | F1.5 gate — procedencia del packager de memoria 3 fases, **sin bajar candado** |
| **hermano** | `CONTRACT-F1.5-MCP-SCHEMA-PIN.md` (PR #16, in flight). Este contrato **no** toca pines MCP. |

## Meta

Empaquetar un hecho de memoria en una de las **tres fases** (`profile` / `log` / `note`) exige procedencia fail-closed. Una fase untrusted **no puede escalar a control**. La cuarentena de Pack A **no se debilita**. Atena **nunca** otorga. Janice = runtime.

`effective = min(claim, channel)` sobre el ordinal F2 congelado (misma regla que F1-P2 / W3 / threat-model). El canal es el que el harness verifica; el caller no se auto-eleva.

## In / out

| In | Out |
|----|-----|
| `lib/packager.js` + `MemoryStore.package()` aditivo | Debilitar Pack A (`set` / `promote` / `reviewerCanPromote`) |
| Procedencia por fase + hash de integridad | Version bump / Release |
| Deny de escalada note→profile sin attestor host\|user | Rehab de brand / onboarding / sync / device / experimental |
| Deny de `target: control` / admission / preload / patch.yml | Tocar `~/Library/Application Support/dsh-desktop/` |
| Atena never grants; Janice = runtime | Archivos del pin MCP (PR #16) |
| Tests G1–G9 + Pack A 18/18 intacto | Bajar candado compact 0.90 / 0.12 / 8192 |

## Tres fases (cómo se escribe / envejece la Capa 2)

Ortogonal a las 3 **capas de contexto** (ventana / durable / spill).

| Fase | Persistencia | Facetas canónicas | Techo Pack A |
|------|--------------|-------------------|--------------|
| **profile** | ∞, injectable | `preferences_user`, `constraints_do_not`, `output_format`, `identity` | user/host → admitted; plugin-data/untrusted → **quarantined** |
| **log** | durable fechado | `decisions`, `facts`, `artifacts`, `projects_state` | igual: quarantine no se salta |
| **note** | TTL / sesión | `tasks`, `open_questions` | igual; escalar a profile exige attestor host\|user |

## Host session rules

1. **Deny-by-default.** Fase desconocida, sin content, sin claim/channel → deny, `side_effect: false`.
2. **Pack A sigue siendo el candado de escritura.** `set` / `promote` no cambian. El packager consulta `initialStateFor` / `trustOf` / `reviewerCanPromote`. Nunca admite plugin-data/untrusted como profile-admitted.
3. **Atena NEVER grants.** `attestor: 'atena'` → `atena-cannot-grant`.
4. **Janice = runtime only.** `attestor: 'janice'` → `janice-is-runtime`. No otorga escalada ni admit.
5. **Untrusted no escala a control.** `proposeControl` y `target: control|admission|preload|patch.yml` → `memory-cannot-enter-control`.
6. **Masquerade.** `claim` > `channel` no puede `admit: true`. Un `trust` del caller que supere `effective` → `phase-masquerade`.
7. **Escalada de fase.** note→log→profile exige attestor host\|user. Democión no.

## Gates

| # | Gate | PASS when |
|---|------|-----------|
| G1 | Phases | `MEMORY_PHASES = {profile, log, note}` frozen; `phaseOf` total; unknown → undefined |
| G2 | Provenance | `effective = min(claim, channel)`; hash estable; tamper → `verifyPackage` false |
| G3 | Pack A | tool/plugin → quarantined; user/agent → admitted; `admit:true` untrusted → deny |
| G4 | Masquerade | claim user + channel plugin-data no admite; trust caller > effective → deny |
| G5 | Escalation | note→profile sin host\|user → `phase-escalation`; con host → allow |
| G6 | Control | `proposeControl` / target control → `memory-cannot-enter-control`; 0 side-effect |
| G7 | Naming | Janice = runtime; Atena cannot grant; `store.js` sigue sin Janice/Atena |
| G8 | Store | `package()` aditivo; deny auditado + 0 persist; `set` directo intacto |
| G9 | Candados | compact 0.90/0.12/8192; disabled set intacto; 0 archivos MCP pin / patch.yml / preset |

## Naming

- **Janice** = plugin runtime (executor). Never a grantor of phase escalation or admit.
- **Atena** = advisor. Never a grantor.

## Out of scope (unchanged)

- Spill cap / Principle C/D / vault (track `feat/memory-3phase-spill-cd`)
- MCP schema pin / witness (PR #16)
- New preload keys, `build/dsh-desktop.patch.yml` edits
- Rehab of disabled plugins
- Version bump / Release / notarize
