# Ola 1 / Bloque 1 — Durable audit fail-closed (item 1.3)

| Campo | Valor |
|-------|--------|
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **package** | `desktop/.../packages/abaco-effect-broker` |
| **closes** | Pass 8 finding: durable `effects.jsonl` append silently muted (`pushAudit` empty `.catch`) |
| **invariant** | **INV-DURABLE-AUDIT-FAIL-CLOSED** |
| **out of scope** | Bloque 2/3 (sessionCaps, grant Map cap, market downgrade) — later PRs |

## INV-DURABLE-AUDIT-FAIL-CLOSED

> After **K** consecutive durable append failures, `authorize()` denies **new** effects with reason `audit-unavailable` (tip-of-spear). Do **not** freeze the already-admitted UI fleet blindly. Keep the in-memory audit / provenance chain. Surface an operator alert/counter. Never empty-catch durable I/O. Advisors (Jev/Atena) never live in `authorize()`.

### Behaviour

1. Every `pushAudit(ev)` still appends to the **in-memory** audit log (provenance forwarding elsewhere is unchanged).
2. Durable sink = JSONL under `$DSH_HOME|$HOME/abaco-deep-core-audit-f1/effects.jsonl` (never `dsh-desktop` Application Support).
3. Append / mkdir failures increment consecutive failure counters. Success resets the consecutive streak and clears the unavailable flag.
4. When consecutive failures reach K (`DURABLE_AUDIT_FAIL_THRESHOLD`, default **5**), the durable-audit breaker opens and the operator alert counter ticks once per opening.
5. While unavailable, `authorize()`:
   - **denies** new effects with `reason: 'audit-unavailable'` (no side-effect);
   - **exception (tip-of-spear):** `ui.slot` for an already-admitted plugin may still allow — UI fleet keeps painting;
   - does **not** mass-unload / mass-revoke.
6. Operator surface: `getBrokerStats().durableAudit` / `getDurableAuditStatus()`.
7. Tests may inject a stub via `setDurableAppendForTests(fn)`.

### Tests

- `packages/abaco-effect-broker/tests/durable-audit-fail-closed.test.mjs`
  - stub FS error → deny after K failures
  - admitted `ui.slot` not frozen
  - recovery on durable success
  - existing grants stay inspectable
  - no advisor calls in `authorize` body; no empty `.catch` on durable append

### Related

- Plan: `PLAN-CERRAR-CICLO-REACTIVO.md` Ola 1 Bloque 1 §1.3
- Finding: `PASSES-6-10.md` Pass 8 #3 / N5 / invariant #12
