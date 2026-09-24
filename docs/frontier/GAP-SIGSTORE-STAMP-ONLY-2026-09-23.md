# GAP -- Sigstore / in-toto (stamp-only until keys)

| Field | Value |
|-------|--------|
| **date** | 2026-09-23 (America/New_York) |
| **status** | **HOLD** |
| **repos** | `anthony-x507/Abaco-deep-Core` |
| **closes when** | Sigstore / OIDC signing credentials (or equivalent CI identity) available and wired |
| **related** | Ola 3 item 3.2; D6 stamp in `d6-provenance-stamp.mjs`; PASSES publisher |

## Statement

Full Sigstore / in-toto attestation is **not** done. This is an explicit dated
**GAP**, **NOT soft-PASS**.

Until keys exist, the broker uses a **stamp-only** D6 provenance binding:

- subject = artifact digest + configured builder identity
- stamp = local sha256 binding over that subject
- mode = `stamp-only`
- `sigstoreClaim` is always `false`

## What is NOT claimed

- "Sigstore-attested" -- never claimed while this GAP is open.
- in-toto attestation envelope verification -- not implemented.
- Soft-PASS of publisher trust -- forbidden.

Code that sets `claimSignedBySigstore: true` under stamp-only is **refused**
(`sigstore-claim-forbidden`).

## Mitigations already in CODE (adjacent, not a substitute for Sigstore)

- D6 stamp subject bind (`d6-provenance-stamp.mjs`) -- digest + builder id.
- Supply-chain admission digest pin + SBOM (`supply-chain-admission.mjs`).
- Update-feed digest pin refuse-launch (Ola 2.C).
- Review-time pin rotation via `scripts/sign-manifest.mjs` (no runtime rotate API).

## Reopen checklist

1. Sigstore / OIDC (or long-lived publisher) credentials present in CI.
2. Wire verify of a real attestation whose subject digest matches `PINNED_ARTIFACT`.
3. Builder id must still match `CONFIGURED_BUILDER_IDS`.
4. Replace this GAP with PASS evidence (ticket + CI logs + date).
5. Do not delete this file until PASS is recorded with date.


This path is NOT a Sigstore signature and is stamp-only.
