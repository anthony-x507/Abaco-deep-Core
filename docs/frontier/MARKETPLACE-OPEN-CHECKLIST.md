# Marketplace open checklist (Ola 3 / 3.4)

| Field | Value |
|-------|--------|
| **purpose** | Go / no-go for opening marketplace beyond closed pilot |
| **repos** | deep-Core + python-core + Desk (as noted) |
| **doctrine** | Tip-of-spear; Jev never grants; no soft-PASS |

## Go criteria (all required)

| # | Gate | Evidence | Status |
|---|------|----------|--------|
| 1 | **INV-12** contracts green in CI (deep + python where applicable) | `CONTRACT-INV-12.md` + inv-12 tests | check at open time |
| 2 | **UtilityProcess** (or fail-closed deny) for market / Cordis plugins -- not same-process main default | Ola 2.B isolation-class | check at open time |
| 3 | **Digest pin + SBOM** admission (Sweet-spot C) | `supply-chain-admission.mjs` + stress C | check at open time |
| 4 | **Sigstore OR dated GAP** stamp-only (never fake signatures) | `GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md` + D6 stamp | GAP HOLD today |
| 5 | **Update-feed digest pin** refuse-launch when broker pins != binary stamp | Ola 2.C | check at open time |
| 6 | **Pin rotation** release gate + CI digest constant check | `PIN-ROTATION-RELEASE-GATE.md` | check at open time |
| 7 | **D6 stamp** subject = artifact digest + configured builder id | `d6-provenance-stamp.mjs` | check at open time |

## Explicit HOLD (blocks open until resolved or GAP accepted)

| Item | Notes |
|------|-------|
| Apple notarize (Desk F7) | Dated GAP `GAP-NOTARIZE-2026-09-23.md` -- NOT soft-PASS |
| Full Sigstore / in-toto | Dated GAP `GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md` -- stamp-only until keys |
| Third-party connectors language | Product HOLD until above gates stay green |

## No-go if any of

- INV-12 test red
- Market default isolation is in-process without lab flag
- Digest/SBOM path admits without pin
- Code claims "Sigstore-attested" while stamp-only GAP is open
- Pin constants empty / TODO / drift from disk
- Soft-PASS language on notarize or Sigstore

## Sign-off

Open marketplace only when every Go row is PASS (or accepted dated GAP) and every No-go row is clear. Record date + PR SHA in the release notes.


This path is NOT a Sigstore signature and is stamp-only.
