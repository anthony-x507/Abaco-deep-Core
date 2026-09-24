# Ola 3 -- supply chain + publisher (D6 stamp + gates)

| Field | Value |
|-------|--------|
| **repos** | `anthony-x507/Abaco-deep-Core` |
| **package** | `desktop/.../packages/abaco-effect-broker` |
| **marker** | `OLA3-BLOQUE-SUPPLY-CHAIN-D6` |
| **closes** | Stress C / PASSES D6 minimo; publisher stamp-or-GAP; P5 pin gate; market checklist |
| **out of scope** | Fake Sigstore signatures; Soft-PASS notarize/F7; Cloud Agents |
| **doctrine** | Tip-of-spear; Jev never grants; no soft-PASS |

## 3.1 D6 minimum provenance stamp

Subject = **artifact digest** + **configured builder identity**.

- Module: `d6-provenance-stamp.mjs`
- `stampProvenance` / `decideD6Provenance` / `sealD6Provenance`
- Mismatch of digest or builder id => refuse
- Stamp is a local binding; **stamp != full Sigstore claim** (ASCII: stamp is not a full Sigstore claim)
- Wired into `authorize()` via `gateAuthorizeD6Provenance` (unconfigured = allow for dev; sealed refuse = deny)

## 3.2 Sigstore / in-toto OR dated GAP

No Sigstore keys/OIDC on this path. Dated GAP:

`docs/frontier/GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md` -- status **HOLD**, not soft-PASS.

Code never claims "Sigstore-attested" for stamp-only. `claimSignedBySigstore: true` under stamp-only => `sigstore-claim-forbidden`.

## 3.3 Pin rotation = release gate + CI

- Doc: `PIN-ROTATION-RELEASE-GATE.md`
- Procedure: `scripts/sign-manifest.mjs`
- CI: `tests/pin-rotation-gate.test.mjs` fails on empty / TODO / digest drift

## 3.4 Marketplace open checklist

`MARKETPLACE-OPEN-CHECKLIST.md` -- go/no-go covering INV-12, UtilityProcess, digest/SBOM, Sigstore|GAP, update pin, D6, pin rotation.

## Tests / CI

- `packages/abaco-effect-broker/tests/d6-provenance-stamp.test.mjs`
- `packages/abaco-effect-broker/tests/pin-rotation-gate.test.mjs`
- Desktop CI Contract step includes both files

## Doctrine

- Tip-of-spear; Jev / Atena never grant a pin widen or provenance claim.
- Prefer fail-closed over soft widen.
- Do not weaken MANIFEST_CAPS / digest+SBOM / Bind / update-feed gates from Ola 1-2.
- Do not claim Sigstore or notarize PASS while their GAPs are open.


This path is NOT a Sigstore signature and is stamp-only.
