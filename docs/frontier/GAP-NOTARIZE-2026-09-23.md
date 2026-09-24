# GAP — Apple notarize (Desk F7 HOLD)

| Campo | Valor |
|-------|--------|
| **date** | 2026-09-23 (America/New_York) |
| **status** | **HOLD** |
| **repos** | Desk packaging (`anthony-x507/Abaco-desk-app-UI`); documented also in deep-Core |
| **closes when** | Desk F7 frees (GH artifact quota) **and** Apple notary credentials available |
| **related** | Ola 2 Bloque 2.C.2; ADR-003 unsigned-build; PASSES-6-10 Pass 9 |

## Statement

Notarize is **not** done. This is an explicit dated **GAP**, **NOT soft-PASS**.

## Reason

- Desk **F7 HOLD**: GitHub Actions artifact quota blocks packaging / notarize CI paths.
- Apple notary credentials / Developer ID not available on this executor path.
- No invented secrets; `identity` stays null until a real Developer ID (see Desk `PACKAGING-DMG.md`).

## What is NOT claimed

- Notarize **PASS** — never claimed while this GAP is open.
- Gatekeeper bypass as a security control — unsigned redistribute remains documented risk (ADR-003).

## Mitigations already in CODE (adjacent, not a substitute for notarize)

- Plugin digest pins + SBOM admission (Sweet-spot C / #46).
- Ola 2.C.1 update-feed digest pin + refuse-launch when broker pins != binary stamp
  (`update-feed-digest-pin.mjs`).

## Reopen checklist

1. Desk F7 artifact quota cleared.
2. Apple notary credentials present in the packaging environment.
3. Run real notarytool / staple path; replace this GAP with PASS evidence (ticket + CI logs).
4. Do not delete this file until PASS is recorded with date.
